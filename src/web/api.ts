import { resolve } from 'node:path';
import { loadConfig, saveConfig, PROVIDER_DEFAULTS, PROVIDER_TIERS, PROVIDER_MODELS, TIER_LABELS, LOCAL_FREE_PROVIDERS, COMPACT_PROMPT_PROVIDERS, getDefaultProviderFromEnv } from '../config/keys.js';
import type { ProviderType, HysaConfig } from '../config/keys.js';
import { getProjectInfo } from '../context/builder.js';
import { readFile, shouldIgnore } from '../files/reader.js';
import { writeFileWithBackup, previewEdit } from '../files/writer.js';
import { getGitInfo } from '../utils/git.js';
import { createClient, createSingleClient, categorizeError } from '../ai/client.js';
import type { Message } from '../ai/types.js';
import { buildSystemPrompt, resolvePromptMode } from '../prompts/system.js';
import { classifyTask } from '../ai/task-classifier.js';
import type { TaskKind } from '../ai/task-classifier.js';
import { generatePlan, shouldPlanFor } from '../ai/planner.js';
import { clonePlan, markStepRunning, markStepDone, markStepFailed, inferStepFromToolCall, buildFinalReport } from '../ai/planner.js';
import type { ExecutionPlan, PlanReport } from '../ai/planner.js';
import { hasVisionCapability, isModelVisionCapable, isProviderVisionCapable, getVisionCapableProviders } from '../ai/provider-capabilities.js';
import { providerModelHasActiveCredentials, shouldInjectProjectContext } from '../ai/provider-policy.js';
import { clearNinerouterDiscoveryCache, hydrateNinerouterConfig } from '../ai/ninerouter.js';
import { rankFiles } from '../context/ranker.js';
import { decideProjectMode } from '../context/project-router.js';
import { getYolo, setYolo, getProviderHealth } from '../utils/session.js';
import { toHealthSummary, getLastError, getLastFallbackUsed, getFallbackEvents, getLastSuccessfulProvider, getLastSuccessfulModel, getAllHealth, isProviderOnCooldown, recordRequestLatency, recordRecoverySuccess } from '../ai/model-health.js';
import { detectSecrets } from '../utils/secrets.js';
import { translateCommand, shellInfo } from '../utils/shell.js';
import { searchWeb, formatSearchResults, getSearchDiagnostics, isCapabilityQuestion, getCapabilityResponse } from '../tools/web-search.js';
import { shouldSearchEntity } from '../tools/entity-detector.js';
import { estimateTokens, truncateMessages } from '../context/tokens.js';
import { selectContext, formatSelectedContext } from '../brain/context-selector.js';
import { classifyCommand } from '../utils/commands.js';

const LOG = '[HYSA Chat]';
let apiRequestCounter = 0;

// ── Language detection ──────────────────────────────────

const ARABIC_PATTERN = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

function isArabic(text: string): boolean {
  if (!text) return false;
  let arabicCount = 0;
  for (const char of text) {
    if (ARABIC_PATTERN.test(char)) arabicCount++;
  }
  return arabicCount > 0;
}

function getResponseLanguage(text: string): 'arabic' | 'english' {
  return isArabic(text) ? 'arabic' : 'english';
}

function injectLanguageInstruction(messages: { role: string; content: string | any[] }[]): void {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'user') continue;
    if (typeof msg.content === 'string') {
      const isAr = isArabic(msg.content);
      if (isAr) {
        msg.content += '\n\nRespond in Arabic. Use natural Arabic. Do not switch to English.';
      }
    }
    break;
  }
}

// ── Simple question detection ──────────────────────────

function isSimpleQuestion(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  if (trimmed.length > 60) return false;
  const actionWords = /\b(read|edit|write|update|change|modify|create|add|fix|debug|run|exec|find|search|scan|symbol|import|show|open|check|look|list|tell|describe|apply|remove|delete|rename|move|copy|refactor|explain|summarize|analyze|inspect|improve|implement|build|compile|deploy|test|investigate|review|audit)\b/i;
  if (actionWords.test(trimmed)) return false;
  return true;
}

// ── Project intent detection ─────────────────────────────

const PROJECT_INTENT_PATTERNS = [
  /(?:explain|describe|summarize|show|tell)\s+(?:me\s+)?(?:about\s+)?(?:the\s+)?(?:project|codebase|repo|app|structure|architecture)/i,
  /(?:find|look\s+for|search\s+for|detect|identify|spot)\s+(?:a\s+)?(?:small\s+)?(?:bug|issue|problem|improvement|vulnerability|mistake)/i,
  /(?:improve|enhance|optimize|refactor|clean\s+up)\s+(?:this|the|my)\s+(?:code|project|app|repo|file|implementation)/i,
  /(?:inspect|analyze|audit|scan|review)\s+(?:the\s+)?(?:repo|project|codebase|files|code|app|source)/i,
  /(?:fix|correct|resolve|solve)\s+(?:this|the|my)\s+(?:code|bug|issue|problem|error|implementation)/i,
  /(?:what|how)\s+(?:changed|is\s+the\s+structure|does\s+this\s+project|are\s+the\s+files|is\s+in\s+the)\s+(?:in|of|the)/i,
  /(?:generate|create|write|add)\s+(?:tests?|unit\s+tests?|test\s+cases?|specs?)/i,
  /(?:do\s+not|don'?t)\s+(?:edit|change|modify|alter)\s+(?:files|anything)/i,
  /what\s+(?:does|is)\s+(?:this|the)\s+(?:project|code|repo|app)\s+(?:do|about)/i,
  /(?:analyze|check|look\s+at)\s+(?:my|the|this)\s+(?:code|project|repo)/i,
  /tell\s+me\s+(?:about|what)\s+(?:this\s+)?(?:project|codebase|repo)\s+(?:does|is|contains)/i,
];

const PROJECT_SKIP_PATTERNS = [
  /^(?:hi|hello|hey|yo|sup|salam|مرحبا|اهلا|شكرا|thanks?)\b/i,
  /^(?:who|what|where|when|why|how)\s+(?:is|are|was|were|created|invented|discovered)\s+/i,
  /^(?:tell\s+me\s+about|who\s+is|what\s+is)\s+(?!the\s+project|this\s+project|the\s+code|the\s+repo)/i,
  /^(?:history\s+of|meaning\s+of|definition\s+of)/i,
  /^(?:من\s+هو|ما\s+هي|ما\s+هو|اين|متى|كيف|لماذا)\s/i,
];

function detectProjectIntent(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  if (PROJECT_SKIP_PATTERNS.some(p => p.test(trimmed))) return false;
  if (PROJECT_INTENT_PATTERNS.some(p => p.test(trimmed))) return true;
  return false;
}

// ── Timing helpers ────────────────────────────────────────

interface TimingSpan {
  name: string;
  start: number;
}

class TimingTracker {
  private spans: TimingSpan[] = [];
  private completed: { name: string; ms: number }[] = [];

  start(name: string): void {
    this.spans.push({ name, start: performance.now() });
  }

  stop(name: string): void {
    const idx = this.spans.findIndex(s => s.name === name);
    if (idx !== -1) {
      const span = this.spans.splice(idx, 1)[0];
      this.completed.push({ name, ms: Math.round(performance.now() - span.start) });
    }
  }

  report(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const c of this.completed) {
      result[c.name] = c.ms;
    }
    return result;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Timed out after ${ms / 1000}s`)), ms)),
  ]);
}
const workingDir = resolve('.');

interface AttachmentPayload {
  name: string;
  ext: string;
  size: number;
  kind: 'text' | 'image' | 'pdf' | 'docx';
  textContent?: string;
  dataUrl?: string;
}

// Known vision-capable models per provider (for supportsVision check)
function supportsVision(provider: string, model: string): boolean {
  return hasVisionCapability(provider, model);
}

// Preferred ordered list of vision fallback models (max 3 attempted).
// FREE models first, paid models last. Direct Gemini (free with API key) before OpenRouter.
const VISION_FALLBACK_ORDER: { provider: ProviderType; model: string; requiresKey: boolean; requiresHealthCheck?: boolean }[] = [
  { provider: 'gemini', model: 'gemini-2.5-flash', requiresKey: true },
  { provider: 'gemini', model: 'gemini-1.5-flash', requiresKey: true },
  { provider: 'openrouter', model: 'google/gemini-2.5-flash:free', requiresKey: true },
  { provider: 'openrouter', model: 'qwen/qwen2.5-vl-72b-instruct:free', requiresKey: true },
  { provider: 'openrouter', model: 'google/gemini-2.5-flash', requiresKey: true },
  { provider: 'openrouter', model: 'qwen/qwen-vl-plus', requiresKey: true },
];

// 9Router vision model cache (lazy, per-process)
let cachedNinerouterVisionModels: { model: string; label: string }[] | null = null;

async function discoverNinerouterVisionModels(config: HysaConfig): Promise<{ model: string; label: string }[]> {
  if (cachedNinerouterVisionModels) return cachedNinerouterVisionModels;
  const discovery = await hydrateNinerouterConfig(config, { includeVision: true, timeoutMs: 5000 });
  if (!discovery?.available) {
    if (discovery?.reason) console.log('[vision] 9Router discovery failed:', discovery.reason);
    return [];
  }
  const models = (config.ninerouterVisionModels || [])
    .filter(model => model !== 'auto' && model !== 'openai/auto')
    .map(model => ({
      model,
      label: `9Router / ${model}`,
    }));
  cachedNinerouterVisionModels = models;
  console.log('[vision] 9Router discovered', models.length, 'vision model(s):', models.map(m => m.model).join(', '));
  return models;
}

export function clearNinerouterVisionCache(): void {
  cachedNinerouterVisionModels = null;
  clearNinerouterDiscoveryCache();
}

async function ensureNinerouterVisionCache(config: HysaConfig): Promise<void> {
  if (cachedNinerouterVisionModels === null) {
    await discoverNinerouterVisionModels(config);
  }
}

// Warm the 9Router vision cache if 9Router is configured (runs once at module load)
const initConfig = loadConfig();
if (initConfig?.ninerouterBaseUrl || process.env.NINEROUTER_URL) {
  ensureNinerouterVisionCache(initConfig!).catch(() => {});
}

function hasImageAttachments(attachments?: AttachmentPayload[]): boolean {
  if (!attachments || attachments.length === 0) return false;
  return attachments.some(a => a.kind === 'image' && a.dataUrl);
}

async function getVisionFallbackCandidates(config: HysaConfig): Promise<{ provider: ProviderType; model: string; label: string }[]> {
  const candidates: { provider: ProviderType; model: string; label: string }[] = [];
  const currentProv = config.currentProvider;
  await hydrateNinerouterConfig(config, { includeVision: true });

  function hasKeyFor(provider: string): boolean {
    if (provider === 'ninerouter') return !!config.ninerouterBaseUrl || config.ninerouterDiscovered === true;
    if (provider === currentProv) return true;
    const key = config.apiKeys[provider as keyof typeof config.apiKeys];
    return !!key;
  }

  function canUseCandidate(provider: ProviderType, model: string): boolean {
    if (provider === 'ninerouter' && (model === 'auto' || model === 'openai/auto')) {
      console.log('[vision] skipped 9Router auto for vision; use HYSA_9ROUTER_VISION_MODEL or /v1/models/image-to-text discovery');
      return false;
    }
    if (provider === 'ninerouter' && !config.ninerouterBaseUrl) {
      console.log('[vision] skipped 9Router (base URL not configured):', model);
      return false;
    }
    if (!providerModelHasActiveCredentials(provider, model, config)) {
      console.log('[vision] skipped (no active credentials/connections):', provider, '/', model);
      return false;
    }
    return true;
  }

  console.log('[vision] building vision fallback candidates (currentProvider:', currentProv, ')');

  // If user explicitly configured a vision model (e.g. "openrouter/google/gemini-2.5-flash:free"),
  // use it as the highest-priority vision candidate
  if (config.visionModel) {
    const slashIdx = config.visionModel.indexOf('/');
    if (slashIdx > 0) {
      const visionProv = config.visionModel.slice(0, slashIdx) as ProviderType;
      const visionMod = config.visionModel.slice(slashIdx + 1);
      console.log('[vision] configured vision model detected:', visionProv, '/', visionMod);
      if (hasKeyFor(visionProv) && hasVisionCapability(visionProv, visionMod) && canUseCandidate(visionProv, visionMod)) {
        const label = `${PROVIDER_DEFAULTS[visionProv]?.label || visionProv} / ${visionMod}`;
        console.log('[vision] config.visionModel found and used:', visionProv, '/', visionMod);
        candidates.push({ provider: visionProv, model: visionMod, label });
      } else if (!hasKeyFor(visionProv)) {
        console.log('[vision] skipped visionModel (no key):', visionProv, '/', visionMod);
      } else if (!hasVisionCapability(visionProv, visionMod)) {
        console.log('[vision] skipped visionModel (not vision-capable):', visionProv, '/', visionMod);
      }
    } else {
      console.log('[vision] invalid visionModel format (no provider/model separator):', config.visionModel);
    }
  }

  // Check HYSA_9ROUTER_VISION_MODEL (e.g., "gemini/gemini-2.5-flash" or "ninerouter/gemini/gemini-2.5-flash")
  const nrVisionModel = config.ninerouterVisionModel || process.env.HYSA_9ROUTER_VISION_MODEL;
  if (nrVisionModel && candidates.length < 3) {
    const nrMod = nrVisionModel.replace(/^ninerouter\//, '');
    if (nrMod) {
      const label = `9Router / ${nrMod}`;
      console.log('[vision] HYSA_9ROUTER_VISION_MODEL found:', nrMod);
      if ((hasVisionCapability('ninerouter', nrMod) || config.ninerouterVisionModels?.includes(nrMod)) && canUseCandidate('ninerouter' as ProviderType, nrMod)) {
        candidates.push({ provider: 'ninerouter' as ProviderType, model: nrMod, label });
        console.log('[vision] added HYSA_9ROUTER_VISION_MODEL:', label);
      } else {
        console.log('[vision] HYSA_9ROUTER_VISION_MODEL not vision-capable:', nrMod);
      }
    }
  }

  const discovered9RouterVision = await discoverNinerouterVisionModels(config);
  for (const discovered of discovered9RouterVision) {
    if (candidates.length >= 3) break;
    if (candidates.some(c => c.provider === 'ninerouter' && c.model === discovered.model)) continue;
    if (!canUseCandidate('ninerouter', discovered.model)) continue;
    candidates.push({ provider: 'ninerouter', model: discovered.model, label: discovered.label });
    console.log('[vision] added discovered 9Router vision model:', discovered.label);
  }

  // Try preferred vision fallback order
  for (const fb of VISION_FALLBACK_ORDER) {
    if (candidates.length >= 3) break;

    // Skip 9Router if HYSA_9ROUTER_VISION_MODEL already added it
    if (fb.provider === 'ninerouter' && candidates.some(c => c.provider === 'ninerouter')) continue;

    if (fb.requiresKey && !hasKeyFor(fb.provider)) {
      console.log('[vision] skipped (no key):', fb.provider, '/', fb.model);
      continue;
    }
    if (!hasVisionCapability(fb.provider, fb.model)) {
      console.log('[vision] rejected text-only model:', fb.provider, '/', fb.model);
      continue;
    }
    if (!canUseCandidate(fb.provider, fb.model)) {
      continue;
    }
    if (isProviderOnCooldown(fb.provider)) {
      console.log('[vision] provider skipped (cooldown):', fb.provider);
      continue;
    }

    // For 9Router/auto, only add if health-check cache is populated
    if (fb.requiresHealthCheck) {
      if (cachedNinerouterVisionModels !== null) {
        // Health-checked successfully (cache populated by async discovery)
        const label = `${PROVIDER_DEFAULTS[fb.provider]?.label || fb.provider} / ${fb.model}`;
        console.log('[vision] candidate added (health-checked):', label);
        candidates.push({ provider: fb.provider, model: fb.model, label });
      } else {
        // No health check cache yet — still add as last resort, but log warning
        console.log('[vision] 9Router not yet health-checked, adding as fallback candidate');
        const label = `${PROVIDER_DEFAULTS[fb.provider]?.label || fb.provider} / ${fb.model}`;
        candidates.push({ provider: fb.provider, model: fb.model, label });
      }
    } else {
      const label = `${PROVIDER_DEFAULTS[fb.provider]?.label || fb.provider} / ${fb.model}`;
      console.log('[vision] candidate added:', label);
      candidates.push({ provider: fb.provider, model: fb.model, label });
    }
  }

  // If still need more candidates, try any vision-capable provider from the registry
  if (candidates.length < 3) {
    const allVision = getVisionCapableProviders();
    console.log('[vision] need more candidates, checking', allVision.length, 'vision-capable providers from registry');
    for (const vp of allVision) {
      if (candidates.length >= 3) break;
      if (candidates.some(c => c.provider === vp.provider && c.model === vp.model)) continue;
      if (!hasKeyFor(vp.provider)) {
        console.log('[vision] skipped (no key):', vp.provider, '/', vp.model);
        continue;
      }
      if (!canUseCandidate(vp.provider as ProviderType, vp.model)) {
        continue;
      }
      if (isProviderOnCooldown(vp.provider)) {
        console.log('[vision] provider skipped (cooldown):', vp.provider);
        continue;
      }
      const label = `${PROVIDER_DEFAULTS[vp.provider as ProviderType]?.label || vp.provider} / ${vp.model}`;
      console.log('[vision] candidate added from registry:', label);
      candidates.push({ provider: vp.provider as ProviderType, model: vp.model, label });
    }
  }

  console.log('[vision] final candidates:', candidates.length);
  for (const c of candidates) {
    console.log('[vision]   -', c.provider, '/', c.model);
  }
  return candidates;
}

function getVisionFallbackErrorMessage(
  lang: 'arabic' | 'english',
  failures: { label: string; reason: string; error?: string }[],
  debug: boolean,
): string {
  const reasons = failures.map(f => f.reason);
  const allTimeout = reasons.every(r => r === 'timed out');
  const allRateLimit = reasons.every(r => r === 'rate-limited' || r === 'quota exceeded');
  const allInvalidKey = reasons.every(r => r === 'invalid key');
  const allUnavailable = reasons.every(r => r === 'unavailable');
  const allCredentialError = reasons.some(r => r === 'no active credentials' || r.includes('credential'));

  let actualReason: string;
  if (failures.length === 0) actualReason = 'no configured vision model';
  else if (allTimeout) actualReason = 'all vision models timed out — network or provider too slow';
  else if (allRateLimit) actualReason = 'rate-limited or quota exceeded on all vision models';
  else if (allInvalidKey) actualReason = 'invalid API key for all configured vision models';
  else if (allUnavailable) actualReason = 'all vision models are unavailable';
  else if (allCredentialError) actualReason = '9Router selected a provider without active credentials';
  else actualReason = 'all vision model attempts failed';

  let hint: string;
  if (allCredentialError) {
    hint = '\n\nTip: 9Router / auto is configured to use a provider (e.g., OpenAI) that has no active credentials. Configure a Gemini vision provider (HYSA_VISION_MODEL=gemini/gemini-2.5-flash) or create a 9Router vision combo with HYSA_9ROUTER_VISION_MODEL.';
  } else {
    hint = '\n\nTip: Set HYSA_VISION_MODEL to a vision-capable model, or ensure your API keys for Gemini/OpenRouter are configured.';
  }

  if (lang === 'arabic') {
    let msg = 'لم أستطع تحليل الصورة الآن.';
    if (failures.length === 0) {
      msg += ' لا توجد نماذج رؤية مفعّلة. فعّل Gemini أو OpenRouter Vision أو غيّر إلى مزود يدعم الرؤية.';
    } else if (allInvalidKey) {
      msg += ' مفتاح API لخدمات الرؤية غير صحيح. تحقق من مفاتيح API في الإعدادات.';
    } else if (allRateLimit) {
      msg += ' جميع نماذج الرؤية المتاحة وصلت إلى الحد اليومي أو معدّل الاستخدام. جرّب بعد قليل أو جرّب مزود رؤية آخر.';
    } else if (allTimeout) {
      msg += ' لم تستجب نماذج الرؤية خلال المهلة الزمنية. قد تكون الشبكة بطيئة أو المزود غير متاح. جرّب بعد قليل.';
    } else if (allUnavailable) {
      msg += ' نماذج الرؤية المتاحة غير متوفرة حاليًا. جرّب بعد قليل.';
    } else {
      msg += ' جميع محاولات نماذج الرؤية فشلت. جرّب ضبط HYSA_VISION_MODEL=gemini/gemini-2.5-flash أو تأكد من مفتاح API.';
    }
    if (failures.length > 0) {
      msg += '\n\nالمحاولات:\n' + failures.map(f => '• ' + f.label + ' — ' + f.reason).join('\n');
    }
    if (debug && failures.length > 0) {
      msg += '\n\n(العطل: ' + actualReason + ')';
      msg += '\n\nتفاصيل الأخطاء:\n' + failures.map(f => '• ' + f.label + ' — ' + f.reason + (f.error ? '\n  ↳ ' + f.error : '')).join('\n');
    }
    return msg;
  }

  let msg = 'I couldn\'t analyze the image.';
  if (failures.length === 0) {
    msg += ' No vision-capable models are configured. Configure Gemini, OpenRouter Vision, or switch to a vision-capable provider.';
  } else if (allInvalidKey) {
    msg += ' The API key for the vision services is invalid. Check your API keys in settings.';
  } else if (allRateLimit) {
    msg += ' All available vision models are rate-limited or quota-exhausted. Try again later or try a different vision provider.';
  } else if (allTimeout) {
    msg += ' The vision models did not respond within the timeout. The network may be slow or the provider unavailable. Try again shortly.';
  } else if (allUnavailable) {
    msg += ' The available vision models are currently unavailable. Try again later.';
  } else {
    msg += ' All vision model attempts failed. Try setting HYSA_VISION_MODEL=gemini/gemini-2.5-flash or check your API keys.';
  }
  if (failures.length > 0) {
    msg += '\n\nTried:\n' + failures.map(f => '• ' + f.label + ' — ' + f.reason).join('\n');
  }
  if (debug && failures.length > 0) {
    msg += '\n\n(Actual reason: ' + actualReason + ')';
    msg += '\n\nDetailed errors:\n' + failures.map(f => '• ' + f.label + ' — ' + f.reason + (f.error ? '\n  ↳ ' + f.error : '')).join('\n');
  }
  return msg;
}

// ── Friendly error messages (language-matched) ────────

const ERROR_MESSAGES: Record<string, { arabic: string; english: string }> = {
  rate_limit: {
    arabic: 'لم أستطع إكمال الطلب الآن لأن المزود الحالي وصل إلى حد الاستخدام أو غير متاح. جرّب بعد قليل أو غيّر المزود من الإعدادات.',
    english: 'I couldn\'t complete the request because the current provider is rate-limited or unavailable. Try again shortly or switch providers.',
  },
  invalid_key: {
    arabic: 'لم أستطع الاتصال بالمزود لأن مفتاح API غير صحيح. تحقق من المفتاح في الإعدادات أو جرّب مزود آخر.',
    english: 'I couldn\'t connect because the API key is invalid. Check your key in settings or try a different provider.',
  },
  timeout: {
    arabic: 'لم يحصل رد من المزود خلال الوقت المحدد. المزود قد يكون بطيئًا أو غير متاح. جرّب بعد قليل أو استخدم مزود آخر.',
    english: 'The provider did not respond in time. It may be slow or unavailable. Try again shortly or use a different provider.',
  },
  network: {
    arabic: 'تعذر الاتصال بالمزود بسبب مشكلة في الشبكة. تحقق من اتصال الإنترنت وجرّب مرة أخرى.',
    english: 'Could not reach the provider due to a network issue. Check your internet connection and try again.',
  },
  unavailable: {
    arabic: 'المزود الحالي غير متاح حاليًا. جرّب بعد قليل أو غيّر المزود من الإعدادات.',
    english: 'The current provider is not available right now. Try again shortly or switch providers.',
  },
  credential_error: {
    arabic: 'المزود الحالي ليس لديه بيانات اعتماد صالحة للمهمة المطلوبة. جرّب مزودًا آخر أو تحقق من الإعدادات.',
    english: 'The current provider does not have valid credentials for the requested task. Try a different provider or check the configuration.',
  },
  generic: {
    arabic: 'حدث خطأ غير متوقع. جرّب بعد قليل أو غيّر المزود.',
    english: 'An unexpected error occurred. Try again shortly or switch providers.',
  },
};

function categorizeErrorMessage(msg: string): string {
  const lower = msg.toLowerCase();
  if (lower.includes('no active credentials') || lower.includes('active credential') || lower.includes('no credentials')) return 'credential_error';
  if (lower.includes('rate') || lower.includes('limit') || lower.includes('quota') || lower.includes('429') || lower.includes('overloaded')) return 'rate_limit';
  if (lower.includes('401') || lower.includes('403') || lower.includes('invalid') && lower.includes('key') || lower.includes('auth')) return 'invalid_key';
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('timedout')) return 'timeout';
  if (lower.includes('network') || lower.includes('econnrefused') || lower.includes('enotfound') || lower.includes('fetch failed') || lower.includes('dns')) return 'network';
  if (lower.includes('unavailable') || lower.includes('not available') || lower.includes('503') || lower.includes('502') || lower.includes('offline') || lower.includes('fallback')) return 'unavailable';
  return 'generic';
}

function getFriendlyErrorMessage(
  langs: 'arabic' | 'english',
  errorMsg: string,
  debug: boolean,
  provider?: string,
): string {
  const cat = categorizeErrorMessage(errorMsg);
  const messages = ERROR_MESSAGES[cat] || ERROR_MESSAGES.generic;
  let msg = langs === 'arabic' ? messages.arabic : messages.english;

  if (debug) {
    const lines: string[] = [msg];
    if (provider) lines.push(`Provider: ${provider}`);
    lines.push(`Reason: ${cat}`);
    const snippet = errorMsg.slice(0, 120);
    if (snippet) lines.push(`Detail: ${snippet}`);
    msg = lines.join('\n');
  }

  return msg;
}

function buildVisionMessages(
  messages: { role: string; content: string }[],
  attachments: AttachmentPayload[],
): any[] {
  const result: any[] = [];
  
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    
    if (msg.role === 'user' && i === messages.length - 1) {
      const parts: any[] = [];
      
      if (msg.content) {
        parts.push({ type: 'text', text: msg.content });
      }
      
      for (const att of attachments) {
        if (att.kind === 'image' && att.dataUrl) {
          parts.push({ type: 'image_url', image_url: { url: att.dataUrl } });
        }
      }
      
      if (parts.length > 0) {
        result.push({ role: 'user', content: parts });
      } else {
        result.push(msg);
      }
    } else {
      result.push(msg);
    }
  }
  
  return result;
}

/**
 * Hard validation: throw if text-only provider receives image payload.
 * This prevents DeepSeek receiving image_url errors before they happen.
 */
function assertNoImagePayload(messages: { role: string; content: string | any[] }[], provider: string, model: string): void {
  if (supportsVision(provider, model)) return;
  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      const hasImage = msg.content.some((p: any) => p.type === 'image_url');
      if (hasImage) {
        console.log('[provider] HARD REJECT: text-only provider', provider, '/', model, 'received image payload');
        throw new Error(`Provider/model mismatch detected: ${provider}/${model} is text-only but received image payload. Cannot send vision content to a text-only model.`);
      }
    }
  }
}

function sanitizeMessagesForTextModel(
  messages: { role: string; content: string | any[] }[],
  provider: string,
  model: string,
): number {
  if (supportsVision(provider, model)) return 0;
  let stripped = 0;
  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      const textParts: string[] = [];
      for (const part of msg.content) {
        if (part.type === 'text') {
          textParts.push(part.text || '');
        } else if (part.type === 'image_url') {
          textParts.push('[Image attached]');
          stripped++;
        }
      }
      msg.content = textParts.join('\n').trim();
      if (!msg.content) {
        msg.content = '[Image attached]';
      }
    }
  }
  // Safety check: ensure no image_url parts remain after sanitization
  for (const msg of messages) {
    if (Array.isArray(msg.content)) {
      const hasRemainingImages = msg.content.some((p: any) => p.type === 'image_url');
      if (hasRemainingImages) {
        console.log('[sanitize] warning: remaining image_url parts found after sanitization, stripping again');
        const textParts: string[] = [];
        for (const part of msg.content) {
          if (part.type === 'text') {
            textParts.push(part.text || '');
          } else if (part.type === 'image_url') {
            textParts.push('[Image attached]');
            stripped++;
          }
        }
        msg.content = textParts.join('\n').trim();
        if (!msg.content) {
          msg.content = '[Image attached]';
        }
      }
    }
  }
  return stripped;
}

function validateProviderConsistency(provider: string, model: string, taskKind?: string): boolean {
  console.log('[provider] selected provider:', provider);
  console.log('[provider] routed model:', model);
  console.log('[provider] payload type:', taskKind || 'unknown');
  console.log('[provider] capability type:', hasVisionCapability(provider, model) ? 'vision' : 'text-only');
  
  if (taskKind === 'image_vision' && !hasVisionCapability(provider, model)) {
    console.log('[provider] MISMATCH: text-only model selected for vision task');
    console.log('[provider] actual upstream provider:', provider);
    console.log('[provider] MISMATCH: this will cause errors like DeepSeek receiving image_url');
    return false;
  }
  
  // Hard validation: if provider-model pair shows selectedModel != actual upstream capability
  if (hasVisionCapability(provider, model) && taskKind !== 'image_vision' && taskKind !== undefined) {
    // This is OK — vision-capable models can handle text
  }
  
  return true;
}

interface ChatRequest {
  messages: { role: string; content: string }[];
  attachments?: AttachmentPayload[];
}

interface SaveFileRequest {
  path: string;
  content: string;
}

interface RunCommandRequest {
  command: string;
}

interface ChatResult {
  message: string;
  toolCalls: { type: string; params: Record<string, string> }[];
  plan?: ExecutionPlan;
  planReport?: PlanReport;
  error?: string;
  hint?: string;
  fallbackEvents?: string[];
  provider?: string;
  model?: string;
  timing?: Record<string, number>;
  visionDebug?: {
    taskKind: string;
    requiredCapability: string;
    selectedProvider: string;
    selectedModel: string;
    providerSupportsVision: boolean;
    imageCount: number;
    failures: { label: string; reason: string; error?: string }[];
  };
}

export function getStatus(): {
  provider: string; model: string; tier: string;
  visionCapable: boolean;
  visionModel: string | null;
  textModel: string | null;
  git: { branch: string | null; hasChanges: boolean } | null;
} {
  const config = loadConfig();
  if (!config) {
    return { provider: 'not configured', model: '', tier: '', visionCapable: false, visionModel: null, textModel: null, git: null };
  }
  const prov = (getDefaultProviderFromEnv() || config.currentProvider) as ProviderType;
  const label = PROVIDER_DEFAULTS[prov]?.label || prov;
  const tier = PROVIDER_TIERS[prov];
  const tierLabel = tier ? TIER_LABELS[tier]?.label || '' : '';
  const gitInfo = getGitInfo(workingDir);
  return {
    provider: label,
    model: config.currentModel,
    tier: tierLabel,
    visionCapable: supportsVision(prov, config.currentModel),
    visionModel: config.visionModel || null,
    textModel: config.textModel || null,
    git: gitInfo.isRepo ? { branch: gitInfo.branch, hasChanges: gitInfo.hasChanges } : null,
  };
}

export function getConfig(): HysaConfig | null {
  return loadConfig();
}

export function updateConfig(partial: Partial<HysaConfig>): HysaConfig {
  const current = loadConfig() || {
    currentProvider: 'openrouter' as ProviderType,
    currentModel: PROVIDER_DEFAULTS.openrouter.model,
    apiKeys: {},
    ollamaBaseUrl: 'http://localhost:11434',
  };
  const merged = { ...current, ...partial };
  saveConfig(merged);
  return merged;
}

export function getProjectTree(): { tree: string; files: string[]; fileCount: number } {
  const info = getProjectInfo(workingDir);
  return {
    tree: info.tree,
    files: info.importantFiles,
    fileCount: info.fileCount,
  };
}

export function getFileContent(filePath: string): { content: string | null; error?: string } {
  const fullPath = resolve(workingDir, filePath);
  if (shouldIgnore(fullPath, workingDir)) {
    return { content: null, error: 'File is ignored (e.g. .env, node_modules)' };
  }
  const content = readFile(fullPath);
  if (content === null) {
    return { content: null, error: 'File not found or cannot be read' };
  }
  return { content };
}

export function saveFile(path: string, content: string): { success: boolean; error?: string; diff?: string } {
  const fullPath = resolve(workingDir, path);
  if (shouldIgnore(fullPath, workingDir)) {
    return { success: false, error: 'Cannot save: file is ignored or protected' };
  }
  const secrets = detectSecrets(content);
  if (secrets) {
    return { success: false, error: 'File contains potential secrets. Save blocked for safety.' };
  }
  const diff = previewEdit(fullPath, content);
  writeFileWithBackup(fullPath, content);
  return { success: true, diff: diff || undefined };
}

const LOCAL_HINTS: Record<string, { name: string; command: string }> = {
  ollama: { name: 'Ollama', command: 'ollama serve' },
  local_openai: { name: 'LM Studio', command: 'Start LM Studio and enable the local server (http://localhost:1234/v1)' },
  hysa_ai: { name: 'HYSA AI', command: 'hysa-ai serve' },
};

function getLocalProviderHint(msg: string, provider: string): string | undefined {
  const lower = msg.toLowerCase();
  if (provider === 'ollama' || lower.includes('ollama')) {
    return 'Ollama is not running locally. Start it with: ollama serve';
  }
  if (provider === 'local_openai' || lower.includes('lm studio') || lower.includes('local_openai')) {
    return 'LM Studio is not running. Start LM Studio → Local Inference Server → Start';
  }
  if (provider === 'hysa_ai' || lower.includes('hysa ai')) {
    return 'HYSA AI is not running. Start it with: hysa-ai serve';
  }
  return undefined;
}

export async function handleChatStream(
  req: ChatRequest,
  writeEvent: (event: string) => void,
): Promise<void> {
  const config = loadConfig();
  if (!config) {
    writeEvent(`data: ${JSON.stringify({ type: 'token', text: 'No configuration found. Run: hysa chat' })}\n\n`);
    writeEvent(`data: ${JSON.stringify({ type: 'done', fullText: 'No configuration found. Run: hysa chat', toolCalls: [] })}\n\n`);
    return;
  }

  const prov = config.currentProvider;

  if (!req.messages || !Array.isArray(req.messages) || req.messages.length === 0) {
    writeEvent(`data: ${JSON.stringify({ type: 'token', text: 'No messages provided.' })}\n\n`);
    writeEvent(`data: ${JSON.stringify({ type: 'done', fullText: 'No messages provided.', toolCalls: [] })}\n\n`);
    return;
  }

  const reqId = ++apiRequestCounter;
  console.log(LOG, `[req:${reqId}] handleChatStream called, messages=${req.messages.length}, attachments=${req.attachments?.length || 0}`);
  const textModelLabel = `${PROVIDER_DEFAULTS[prov]?.label || prov} / ${config.currentModel}`;
  if (config.debug) {
    console.log(LOG, `[req:${reqId}] Provider: ${PROVIDER_DEFAULTS[prov]?.label || prov}, Model: ${config.currentModel}`);
    console.log(LOG, `[req:${reqId}] Tier: ${PROVIDER_TIERS[prov]}, Keys: openrouter=${!!config.apiKeys.openrouter}, gemini=${!!config.apiKeys.gemini}, deepseek=${!!config.apiKeys.deepseek}, opencode_zen=${!!config.apiKeys.opencode_zen}, groq=${!!config.apiKeys.groq}, anthropic_proxy=${!!config.apiKeys.anthropic_proxy}, openai_router=${!!config.apiKeys.openai_router}`);
    console.log(LOG, `[debug] text/code provider: ${textModelLabel}`);
    if (config.visionModel) console.log(LOG, `[debug] vision provider: ${config.visionModel} (from HYSA_VISION_MODEL)`);
  }
  try {
    const hasImages = hasImageAttachments(req.attachments);
    const visionAvailable = supportsVision(prov, config.currentModel);

    // ── Vision fallback: if images present but current provider not vision-capable ──
    if (hasImages && !visionAvailable) {
      const visionTimer = Date.now();
      const imageCount = req.attachments?.filter(a => a.kind === 'image').length || 0;
      console.log(LOG, `[req:${reqId}] Vision pipeline: taskKind=image_vision, requiredCapability=vision, text/code provider: ${textModelLabel}, providerSupportsVision=${visionAvailable}, imageCount=${imageCount}`);
      if (config.debug) {
        console.log(LOG, `[debug] text model: ${config.textModel || config.currentModel}${config.visionModel ? `, vision model: ${config.visionModel}` : ', no explicit vision model configured'}`);
      }

      if (req.attachments) {
        for (const att of req.attachments) {
          if (att.kind === 'image') {
            console.log(LOG, `[req:${reqId}] image attachment: ${att.name}, ${att.size}B, hasDataUrl ${!!att.dataUrl}`);
          }
        }
      }

      const visionCandidates = await getVisionFallbackCandidates(config);
      const failures: { label: string; reason: string; error?: string }[] = [];
      if (visionCandidates.length > 0) {
        console.log(LOG, `[req:${reqId}] Current provider ${prov} not vision-capable, trying ${visionCandidates.length} vision-capable fallback(s)`);
        for (const vc of visionCandidates) {
          console.log(LOG, `[req:${reqId}]   Fallback candidate: ${vc.label}`);
        }

        const visionMsgs = buildVisionMessages(req.messages, req.attachments!);
        const fbProjectInfo = getProjectInfo(workingDir);
        const fbSysPrompt = buildSystemPrompt({
          type: fbProjectInfo.type,
          entryPoints: fbProjectInfo.entryPoints,
          configFiles: fbProjectInfo.configFiles,
          fileCount: fbProjectInfo.fileCount,
          tree: fbProjectInfo.tree.length < 3000 ? fbProjectInfo.tree : fbProjectInfo.tree.slice(0, 3000) + '\n... (truncated)',
        }, config.agentMode || 'chat', false, prov, config.promptMode || 'auto', config.userName);

        const fbMessages: any[] = visionMsgs.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));
        injectLanguageInstruction(fbMessages);

        for (const c of visionCandidates) {
          console.log('[vision] using provider', c.provider, 'for vision messages');
          const timeoutMs = 30000;
          const attemptStart = Date.now();
          try {
            console.log(LOG, `[req:${reqId}] Trying vision provider: selectedProvider=${c.provider}, selectedModel=${c.model} (timeout: ${timeoutMs / 1000}s)`);
            validateProviderConsistency(c.provider, c.model, 'image_vision');
            assertNoImagePayload(fbMessages as any, c.provider, c.model);
            const client = createSingleClient(c.provider, c.model, config.apiKeys, config.ollamaBaseUrl, config.localOpenAiBaseUrl, config.localOpenAiModel, config);
            if (client.sendMessageStream) {
              const response = await withTimeout(
                client.sendMessageStream(fbMessages, fbSysPrompt, (event) => {
                  if (event.type === 'token') {
                    writeEvent(`data: ${JSON.stringify({ type: 'token', text: event.text })}\n\n`);
                  }
                }),
                timeoutMs,
              );
              const duration = Date.now() - attemptStart;
              console.log(LOG, `[req:${reqId}] ✅ Vision fallback succeeded with selectedProvider=${c.provider}, selectedModel=${c.model} in ${(duration / 1000).toFixed(1)}s`);
              writeEvent(`data: ${JSON.stringify({ type: 'done', fullText: response.message, toolCalls: response.toolCalls, timing: { visionTotal: Date.now() - visionTimer }, provider: PROVIDER_DEFAULTS[c.provider]?.label || c.provider, model: c.model })}\n\n`);
              return;
            } else {
              const result = await withTimeout(client.sendMessage(fbMessages, fbSysPrompt), timeoutMs);
              const duration = Date.now() - attemptStart;
              if (result.message) {
                console.log(LOG, `[req:${reqId}] ✅ Vision fallback succeeded with selectedProvider=${c.provider}, selectedModel=${c.model} in ${(duration / 1000).toFixed(1)}s`);
                writeEvent(`data: ${JSON.stringify({ type: 'token', text: result.message })}\n\n`);
                writeEvent(`data: ${JSON.stringify({ type: 'done', fullText: result.message, toolCalls: result.toolCalls, timing: { visionTotal: Date.now() - visionTimer }, provider: PROVIDER_DEFAULTS[c.provider]?.label || c.provider, model: c.model })}\n\n`);
                return;
              }
            }
          } catch (err: unknown) {
            const e = err as Error;
            const duration = Date.now() - attemptStart;
            const errMsg = e.message || '';
            const cat = categorizeError(errMsg);
            let reasonStr: string;
            if (cat === 'rate_limit') reasonStr = 'rate-limited';
            else if (cat === 'quota') reasonStr = 'quota exceeded';
            else if (cat === 'timeout') reasonStr = 'timed out';
            else if (cat === 'invalid_key') reasonStr = 'invalid key';
            else if (cat === 'model_unavailable') reasonStr = 'unavailable';
            else if (cat === 'network') reasonStr = 'network error';
            else if (errMsg.toLowerCase().includes('no active credentials') || errMsg.toLowerCase().includes('active credential')) reasonStr = 'no active credentials';
            else reasonStr = 'failed';
            failures.push({ label: c.label, reason: reasonStr, error: errMsg.slice(0, 200) });
            console.log(LOG, `[req:${reqId}] ❌ Vision fallback failed: selectedProvider=${c.provider}, selectedModel=${c.model}, reason=${reasonStr}, error=${errMsg.slice(0, 200)} (${(duration / 1000).toFixed(1)}s)`);
          }
        }
      }

      // All vision fallbacks failed — friendly message in user's language
      const userLastMsg = req.messages.filter(m => m.role === 'user').pop()?.content || '';
      const lang = getResponseLanguage(userLastMsg);
      const errorText = getVisionFallbackErrorMessage(lang, failures, !!config.debug);
      console.log(LOG, `[req:${reqId}] All ${failures.length} vision fallback(s) failed after ${((Date.now() - visionTimer) / 1000).toFixed(1)}s`);
      writeEvent(`data: ${JSON.stringify({ type: 'token', text: errorText })}\n\n`);
      writeEvent(`data: ${JSON.stringify({ type: 'done', fullText: errorText, toolCalls: [] })}\n\n`);
      return;
    }

    // Inject attachment text content as context before the user's question
    if (req.attachments && req.attachments.length > 0) {
      console.log(LOG, `Attachments: ${req.attachments.length} file(s)`);
      for (const att of req.attachments) {
        const hasText = !!att.textContent && att.textContent.length > 0;
        const hasDataUrl = !!att.dataUrl;
        console.log(LOG, `  ${att.name} (${att.kind}, ${att.size}B, hasText: ${hasText}${att.kind === 'image' ? `, hasDataUrl: ${hasDataUrl}` : ''})`);
        if (hasText && att.kind !== 'image') {
          const contextMsg = {
            role: 'user' as const,
            content: `Attached document content:\nFilename: ${att.name}\nType: ${att.kind.toUpperCase()}\nExtracted text:\n\`\`\`\n${att.textContent}\n\`\`\`\nUse this extracted text to answer the user's question. Do not say you cannot read the ${att.kind.toUpperCase()}.`,
          };
          const insertAt = Math.max(0, req.messages.length - 1);
          req.messages.splice(insertAt, 0, contextMsg);
          console.log(LOG, `  Injected context before user's message`);
        }
      }
    }

    const lastMessage = req.messages[req.messages.length - 1];

    // Format messages for vision if image attachments exist
    let visionMessages = req.messages;
    if (hasImages && visionAvailable) {
      visionMessages = buildVisionMessages(req.messages, req.attachments!);
    }

    const client = createClient(config);
    if (!client.sendMessageStream) {
      // Fall back to non-streaming
      const result = await handleChat(req);
      const msg = result.error || result.message || '';
      if (result.error) {
        writeEvent(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`);
      } else {
        writeEvent(`data: ${JSON.stringify({ type: 'token', text: msg })}\n\n`);
        writeEvent(`data: ${JSON.stringify({ type: 'done', fullText: msg, toolCalls: result.toolCalls || [], provider: result.provider, model: result.model, fallbackEvents: result.fallbackEvents })}\n\n`);
      }
      return;
    }

    const projectInfo = getProjectInfo(workingDir);
    const isLocal = LOCAL_FREE_PROVIDERS.includes(config.currentProvider);
    const lightActive = config.lightMode !== false && isLocal;

    const messages: any[] = visionMessages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
    injectLanguageInstruction(messages);
    const imgStripped = sanitizeMessagesForTextModel(messages, prov, config.currentModel);
    if (imgStripped > 0) {
      console.log(LOG, `[req:${reqId}] Sanitized ${imgStripped} image part(s) for text-only model ${config.currentModel}`);
    }

    const streamLastUserRaw = req.messages.filter(m => m.role === 'user').pop()?.content || '';
    const streamLastContent = typeof streamLastUserRaw === 'string' ? streamLastUserRaw : '';

    // ── Timing / task classification ─────────────────
    const timer = new TimingTracker();
    timer.start('total');
    timer.start('classification');
    const taskKind = classifyTask(visionMessages as any, req.attachments);
    const projectDecision = decideProjectMode(streamLastContent, true, taskKind);
    const isProjectQuery = detectProjectIntent(streamLastContent);
    const useProjectCtx = projectDecision.projectMode || shouldInjectProjectContext(streamLastContent, taskKind) || isProjectQuery;
    const simpleMode = !projectDecision.projectMode && (isSimpleQuestion(streamLastContent) || taskKind === 'simple_chat');
    timer.stop('classification');

    console.log(LOG, `[req:${reqId}] task=${taskKind} projectMode=${projectDecision.projectMode} reason=${projectDecision.reason} simple=${simpleMode}`);

    // ── Agentic plan for complex tasks ─────────────
    const plan = generatePlan(streamLastContent, taskKind);
    if (plan) {
      writeEvent(`data: ${JSON.stringify({ type: 'plan', plan })}\n\n`);
    }

    // ── Capability question detection ────────────────
    const capLastMsg = messages[messages.length - 1];
    const capContent = typeof capLastMsg?.content === 'string' ? capLastMsg.content : '';
    if (capContent && isCapabilityQuestion(capContent)) {
      const wsDiag = getSearchDiagnostics();
      const response = getCapabilityResponse(capContent, wsDiag.isReliable);
      console.log(LOG, `[req:${reqId}] Capability question, returning direct response`);
      writeEvent(`data: ${JSON.stringify({ type: 'token', text: response })}\n\n`);
      writeEvent(`data: ${JSON.stringify({ type: 'done', fullText: response, toolCalls: [] })}\n\n`);
      return;
    }

    const resolvedMode = resolvePromptMode(config.promptMode || 'auto', config.currentProvider, simpleMode);

    let perQueryPrompt = buildSystemPrompt({
      type: projectInfo.type,
      entryPoints: useProjectCtx ? projectInfo.entryPoints : [],
      configFiles: useProjectCtx ? projectInfo.configFiles : [],
      fileCount: projectInfo.fileCount,
      tree: useProjectCtx && projectInfo.tree.length < 3000 ? projectInfo.tree : '',
    }, config.agentMode || 'chat', lightActive, config.currentProvider, resolvedMode, config.userName);

    if (config.debug) {
      console.log(LOG, `[debug] Stream: task=${taskKind}, projectCtx=${useProjectCtx}, mode=${resolvedMode}`);
    }

    // ── Project file injection ──────────────────────
    timer.start('project_scan');
    const lastUserMsgRaw = visionMessages.filter(m => m.role === 'user').pop()?.content || '';
    const lastUserMsgStr = typeof lastUserMsgRaw === 'string' ? lastUserMsgRaw : '';
    let fileInjection = '';
    if (useProjectCtx && (isProjectQuery || taskKind === 'project_scan' || taskKind === 'code_review' || taskKind === 'debugging' || taskKind === 'code_edit' || taskKind === 'coding_qa')) {
      const allFiles = projectInfo.tree.split('\n').filter(f => !f.endsWith('/') && f.length > 0);
      const ranked = rankFiles(allFiles, lastUserMsgStr, 8);
      const topFiles = ranked.filter(r => r.score > 5).map(r => r.path).slice(0, 5);

      const fileParts: string[] = [];
      for (const file of topFiles) {
        const fullPath = resolve(workingDir, file);
        if (shouldIgnore(fullPath, workingDir)) continue;
        const content = readFile(fullPath);
        if (content) {
          const lines = content.split('\n').length;
          fileParts.push(`\n--- ${file} (${lines} lines) ---\n${content.slice(0, 3000)}\n`);
        }
      }

      if (fileParts.length > 0) {
        fileInjection = fileParts.join('');
        const est = estimateTokens(fileInjection);
        if (est < 2000) {
          const fileMsg = { role: 'user' as const, content: `Relevant project files:\n${fileInjection}\n\nUser request: ${lastUserMsgStr}` };
          messages[messages.length - 1] = fileMsg;
          console.log(LOG, `[req:${reqId}] Injected ${topFiles.length} relevant files (~${est} tokens)`);
        }
      }
    }
    timer.stop('project_scan');

    // ── Brain context injection (scored selection) ──
    timer.start('context_select');
    if (!simpleMode) {
      try {
        const selected = await selectContext({
          message: lastUserMsgStr,
          taskKind,
          maxItems: 5,
          debug: !!config.debug,
        });
        if (selected.items.length > 0) {
          perQueryPrompt += formatSelectedContext(selected);
        }
      } catch { /* skip */ }
    }
    timer.stop('context_select');

    // ── Timing log ──
    timer.stop('total');
    const timingReport = timer.report() as Record<string, number> & { capability?: string; routing_mode?: string };
    timingReport.capability = supportsVision(prov, config.currentModel) || hasImageAttachments(req.attachments) ? 'vision' : 'text';
    timingReport.routing_mode = 'api';
    if (config.debug) {
      console.log(LOG, `[timing] classification=${timingReport.classification}ms, project_scan=${timingReport.project_scan}ms, context_select=${timingReport.context_select}ms, total=${timingReport.total}ms`);
    }

    // ── Hard validation: reject image payloads for text-only providers ──
    assertNoImagePayload(messages as any, prov, config.currentModel);

    let response = await client.sendMessageStream(messages as any, perQueryPrompt, (event) => {
      if (event.type === 'token') {
        writeEvent(`data: ${JSON.stringify({ type: 'token', text: event.text })}\n\n`);
      }
    });

    // ── Plan execution state tracking ──────────
    let currentPlan = plan ? clonePlan(plan) : null;
    const filesTouched: string[] = [];
    let commandsRun = 0;

    // ── YOLO tool continuation loop (streaming) ──
    let steps = 0;
    let stepsWithoutProgress = 0;
    const maxSteps = getMaxToolSteps(taskKind);
    let streamMessages = [...messages];
    resetToolProgress();

    // Track the active provider for continuation (may differ from original if vision fallback was used)
    let activeProvider = prov;
    let activeModel = config.currentModel;
    let continuationProvider: string | null = null;
    let continuationModel: string | null = null;

    while (steps < maxSteps && response.toolCalls.length > 0) {
      const yoloMode = getYolo();
      if (!yoloMode) break;

      const autoTools = response.toolCalls.filter(tc =>
        tc.type === 'read_file' ||
        (tc.type === 'execute_command' && classifyCommand(tc.params.command || '') === 'safe')
      );
      if (autoTools.length < response.toolCalls.length) break;

      steps++;
      if (config?.debug) {
        console.log(LOG, `[req:${reqId}] YOLO stream tool loop step ${steps}/${maxSteps}: ${autoTools.length} tools`);
      }

      writeEvent(`data: ${JSON.stringify({ type: 'tool_result', step: steps, total: autoTools.length, status: 'executing' })}\n\n`);

      // ── Update plan state: mark inferred step running ──
      if (currentPlan) {
        for (const tc of autoTools) {
          const idx = inferStepFromToolCall(tc.type, tc.params, currentPlan);
          if (idx >= 0) {
            currentPlan = markStepRunning(currentPlan, idx);
            writeEvent(`data: ${JSON.stringify({ type: 'plan_update', plan: currentPlan, stepIndex: idx, status: 'running' })}\n\n`);
          }
          if (tc.type === 'read_file' && tc.params.filePath) {
            filesTouched.push(tc.params.filePath);
          }
          if (tc.type === 'execute_command') {
            commandsRun++;
          }
        }
      }

      const { results } = await executeToolCalls(autoTools, true);

      // ── Update plan state: mark step done ──
      if (currentPlan) {
        for (let i = 0; i < autoTools.length; i++) {
          const tc = autoTools[i];
          const idx = inferStepFromToolCall(tc.type, tc.params, currentPlan);
          if (idx >= 0) {
            const resultText = results[i] || '';
            currentPlan = resultText.includes('Error:') || resultText.includes('Failed:')
              ? markStepFailed(currentPlan, idx)
              : markStepDone(currentPlan, idx);
            writeEvent(`data: ${JSON.stringify({ type: 'plan_update', plan: currentPlan, stepIndex: idx, status: currentPlan.steps[idx].status })}\n\n`);
          }
        }
      }

      const feedText = response.message
        ? `${response.message}\n\nTool results:\n${formatToolResults(autoTools, results)}`
        : `Tool results:\n${formatToolResults(autoTools, results)}`;
      streamMessages.push({ role: 'assistant' as const, content: feedText });

      writeEvent(`data: ${JSON.stringify({ type: 'tool_result', step: steps, total: autoTools.length, status: 'done', results: formatToolResults(autoTools, results) })}\n\n`);

      // Check if progress is being made — break if stuck in a loop
      if (!isMakingProgress(autoTools, results)) {
        stepsWithoutProgress++;
        if (stepsWithoutProgress >= 3) {
          if (config?.debug) console.log(LOG, `[req:${reqId}] Tool loop: no progress for ${stepsWithoutProgress} steps, stopping`);
          break;
        }
      } else {
        stepsWithoutProgress = 0;
      }

      // Sanitize and validate for the ACTIVE provider (not the original)
      sanitizeMessagesForTextModel(streamMessages, activeProvider, activeModel);
      assertNoImagePayload(streamMessages as any, activeProvider, activeModel);
      try {
        response = await client.sendMessageStream(streamMessages as any, perQueryPrompt, (event) => {
          if (event.type === 'token') {
            writeEvent(`data: ${JSON.stringify({ type: 'token', text: event.text })}\n\n`);
          }
        });
      } catch (err) {
        // Background continuation: if provider fails mid-tool-loop, try fallback
        const errMsg = (err as Error).message || '';
        console.log(LOG, `[req:${reqId}] Tool loop provider failed at step ${steps}: ${errMsg}`);
        writeEvent(`data: ${JSON.stringify({ type: 'tool_result', step: steps, total: autoTools.length, status: 'error', error: errMsg.slice(0, 200) })}\n\n`);

        // Try fallback via non-streaming with current state
        try {
          const fallbackClient = createClient(config);
          const fallbackResult = await fallbackClient.sendMessage(
            streamMessages as any,
            perQueryPrompt,
          );
          if (fallbackResult.message) {
            const fallbackLabel = PROVIDER_DEFAULTS[config.currentProvider]?.label || config.currentProvider;
            const continuationMsg = `\n\n[${fallbackLabel} continuing after interruption]\n\n`;
            writeEvent(`data: ${JSON.stringify({ type: 'token', text: continuationMsg })}\n\n`);
            for (const chunk of fallbackResult.message) {
              writeEvent(`data: ${JSON.stringify({ type: 'token', text: chunk })}\n\n`);
            }
            response = fallbackResult;
          } else {
            throw new Error('Fallback returned empty response');
          }
        } catch (fallbackErr) {
          const fallbackMsg = (fallbackErr as Error).message || 'Fallback also failed';
          console.log(LOG, `[req:${reqId}] Tool loop background continuation also failed: ${fallbackMsg}`);
          // Emit what we have so far as the final response
          writeEvent(`data: ${JSON.stringify({ type: 'done', fullText: response?.message || 'Tool loop interrupted', toolCalls: response?.toolCalls || [], timing: timingReport, plan: currentPlan, provider: response?.provider, model: response?.model, fallbackEvents: response?.fallbackEvents })}\n\n`);
          return;
        }
      }
    }

    const planReport = currentPlan ? buildFinalReport(currentPlan, [...new Set(filesTouched)], commandsRun) : undefined;
    writeEvent(`data: ${JSON.stringify({ type: 'done', fullText: response.message, toolCalls: response.toolCalls, timing: timingReport, plan: currentPlan, planReport, provider: response.provider, model: response.model, fallbackEvents: response.fallbackEvents })}\n\n`);
  } catch (err: unknown) {
    const e = err as Error;
    const rawMsg = e.message || 'Unknown stream error';
    console.log(LOG, `Stream failed: ${rawMsg}`);
    const userLastMsg = req.messages.filter(m => m.role === 'user').pop()?.content || '';
    const lang = getResponseLanguage(userLastMsg);
    const fbEvents = getFallbackEvents();

    let friendlyMsg: string;
    if (rawMsg.includes('All free providers')) {
      friendlyMsg = lang === 'arabic'
        ? 'جميع المزودات المجانية مشغولة أو وصلت للحد المسموح حاليًا. جرّب بعد قليل أو استخدم مزود مدفوع.'
        : 'All free providers are currently busy or rate-limited. Try again shortly or configure a paid/stable provider.';
    } else if (rawMsg.includes('timed out') || rawMsg.includes('timeout') || rawMsg.includes('did not respond')) {
      const provLabel = PROVIDER_DEFAULTS[config.currentProvider]?.label || config.currentProvider;
      const fbEvents2 = getFallbackEvents();
      const fallbackUsed = fbEvents2.find(e => e.reason.includes('Switched to') || e.reason.includes('succeeded'));
      if (fallbackUsed) {
        friendlyMsg = lang === 'arabic'
          ? `${provLabel} لم يستجب في الوقت المحدد. تم التبديل التلقائي إلى مزود آخر.`
          : `${provLabel} timed out, continuing with fallback provider.`;
      } else {
        friendlyMsg = lang === 'arabic'
          ? `${provLabel} لم يستجب في الوقت المحدد. جارٍ محاولة مزود بديل...`
          : `${provLabel} timed out. Trying alternative provider...`;
      }
      // Append fallback event details
      const fbEvents3 = getFallbackEvents();
      if (fbEvents3.length > 0) {
        const fallbackLines = fbEvents3.slice(-3).map(e => `  • ${e.reason}`).join('\n');
        friendlyMsg += `\n\n${fallbackLines}`;
      }
    } else {
      friendlyMsg = getFriendlyErrorMessage(lang, rawMsg, !!config?.debug, config?.currentProvider ? PROVIDER_DEFAULTS[config.currentProvider]?.label || config.currentProvider : undefined);
    }

    if (config?.debug && fbEvents.length > 0) {
      const triedLines = fbEvents.map(e => `  • ${e.reason}`).join('\n');
      friendlyMsg += `\n\nTried:\n${triedLines}`;
    }

    writeEvent(`data: ${JSON.stringify({ type: 'token', text: friendlyMsg })}\n\n`);
    writeEvent(`data: ${JSON.stringify({ type: 'done', fullText: friendlyMsg, toolCalls: [] })}\n\n`);
  }
}

export const MAX_TOOL_STEPS = 10;

function getAdaptiveToolBudget(taskKind: TaskKind): number {
  switch (taskKind) {
    case 'code_edit':
    case 'debugging':
    case 'code_review':
    case 'project_scan':
    case 'long_reasoning':
      return 10;
    case 'coding_qa':
    case 'planning':
      return 8;
    case 'long_context':
      return 8;
    case 'simple_chat':
    case 'general_qa':
      return 3;
    default:
      return 6;
  }
}

export function getMaxToolSteps(taskKind: TaskKind): number {
  return getAdaptiveToolBudget(taskKind);
}

let lastToolResults = new Map<string, string>();
const SIMILARITY_THRESHOLD = 0.8;

function isMakingProgress(toolCalls: { type: string; params: Record<string, string> }[], results: string[]): boolean {
  if (toolCalls.length === 0) return false;
  for (let i = 0; i < toolCalls.length; i++) {
    const tc = toolCalls[i];
    const result = results[i] || '';
    const key = `${tc.type}:${tc.params.command || tc.params.filePath || ''}`;
    const prev = lastToolResults.get(key);
    if (prev !== result) {
      lastToolResults.set(key, result);
      return true;
    }
  }
  return false;
}

function resetToolProgress(): void {
  lastToolResults.clear();
}

export function formatToolResults(toolCalls: { type: string; params: Record<string, string> }[], results: string[]): string {
  return toolCalls.map((tc, i) => {
    const label = tc.type === 'read_file' ? `Read ${tc.params.filePath}` :
      tc.type === 'execute_command' ? `Command: ${tc.params.command}` :
      `Tool: ${tc.type}`;
    return `${label}\n${results[i] || '(no output)'}`;
  }).join('\n\n');
}

export async function executeToolCalls(toolCalls: { type: string; params: Record<string, string> }[], yolo: boolean): Promise<{ results: string[]; dangerous: boolean }> {
  const results: string[] = [];
  let dangerous = false;

  for (const tc of toolCalls) {
    if (tc.type === 'read_file') {
      const fullPath = resolve(workingDir, tc.params.filePath || '');
      const content = await import('../files/reader.js').then(m => m.readFile(fullPath));
      results.push(content ? content.slice(0, 5000) : 'File not found or empty');
      continue;
    }

    if (tc.type === 'execute_command') {
      const cmd = tc.params.command || '';
      if (!yolo) {
        const safety = classifyCommand(cmd);
        if (safety !== 'safe') {
          dangerous = true;
          results.push('Requires manual approval');
          continue;
        }
      }
      try {
        const { execSync } = await import('node:child_process');
        const translated = translateCommand(cmd);
        const shell = process.platform === 'win32'
          ? (translated !== cmd && (translated.includes('Get-') || translated.includes('Select-'))
            ? 'powershell.exe -NoProfile -Command'
            : process.env.ComSpec || 'cmd.exe')
          : undefined;
        const stdout = execSync(translated, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, cwd: workingDir, shell });
        results.push(stdout.trim().slice(0, 5000) || '(empty output)');
      } catch (err: unknown) {
        const e = err as { stderr?: string; message?: string };
        results.push(`Error: ${e.stderr || e.message || 'Command failed'}`);
      }
      continue;
    }

    // Non-auto tools (edit_file, etc.) — skip for YOLO loop, let client handle
    dangerous = true;
    results.push('Requires manual review');
  }

  return { results, dangerous };
}

export async function continueChat(messages: { role: string; content: string }[], toolCalls: { type: string; params: Record<string, string> }[], toolResults: string[]): Promise<ChatResult> {
  const config = loadConfig();
  if (!config) return { message: '', toolCalls: [], error: 'No configuration' };

  const prov = config.currentProvider;
  const client = createClient(config);
  const systemPrompt = buildSystemPrompt(undefined, 'chat', false, config.currentProvider, undefined, config.userName);

  const resultText = '\n\nTool results:\n' + formatToolResults(toolCalls, toolResults);
  messages.push({ role: 'assistant', content: resultText });

  sanitizeMessagesForTextModel(messages, prov, config.currentModel);
  assertNoImagePayload(messages as any, prov, config.currentModel);

  try {
    const startTime = Date.now();
    const response = await client.sendMessage(messages as any, systemPrompt);
    recordRequestLatency(prov, config.currentModel, Date.now() - startTime);
    return {
      message: response.message,
      toolCalls: response.toolCalls.map(tc => ({ type: tc.type, params: tc.params })),
    };
  } catch (err: unknown) {
    const e = err as Error;
    const startTime = Date.now();
    // Try background continuation with fallback provider
    try {
      const fallbackClient = createClient(config);
      const fallbackResponse = await fallbackClient.sendMessage(messages as any, systemPrompt);
      if (fallbackResponse.message) {
        recordRecoverySuccess(prov, config.currentModel);
        return {
          message: `[Previous provider failed, continuing with fallback]\n\n${fallbackResponse.message}`,
          toolCalls: fallbackResponse.toolCalls.map(tc => ({ type: tc.type, params: tc.params })),
        };
      }
    } catch {
      // Both failed
    }
    recordRequestLatency(prov, config.currentModel, Date.now() - startTime);
    return { message: `Tool continuation failed: ${e.message}`, toolCalls: [] };
  }
}

export async function handleChat(req: ChatRequest): Promise<ChatResult> {
  const config = loadConfig();
  if (!config) {
    console.log(LOG, 'No config found');
    return { message: '', toolCalls: [], error: 'No configuration found. Run: hysa chat' };
  }

  // Apply env-based default provider resolution (same as CLI)
  const envProvider = getDefaultProviderFromEnv();
  if (envProvider) {
    config.currentProvider = envProvider as ProviderType;
  }
  const prov = config.currentProvider;

  if (!req.messages || !Array.isArray(req.messages) || req.messages.length === 0) {
    console.log(LOG, 'Missing or empty messages array in request body');
    return { message: '', toolCalls: [], error: 'Missing or empty messages array in request body' };
  }

  const reqId = ++apiRequestCounter;
  console.log(LOG, `[req:${reqId}] handleChat called, messages=${req.messages.length}, attachments=${req.attachments?.length || 0}`);
  const textModelLabel = `${PROVIDER_DEFAULTS[prov]?.label || prov} / ${config.currentModel}`;
  if (config.debug) {
    console.log(LOG, `[req:${reqId}] Provider: ${PROVIDER_DEFAULTS[prov]?.label || prov}, Model: ${config.currentModel}`);
    console.log(LOG, `[req:${reqId}] Tier: ${PROVIDER_TIERS[prov]}, Keys: openrouter=${!!config.apiKeys.openrouter}, gemini=${!!config.apiKeys.gemini}, deepseek=${!!config.apiKeys.deepseek}, opencode_zen=${!!config.apiKeys.opencode_zen}, groq=${!!config.apiKeys.groq}, anthropic_proxy=${!!config.apiKeys.anthropic_proxy}, openai_router=${!!config.apiKeys.openai_router}`);
    console.log(LOG, `[debug] text/code provider: ${textModelLabel}`);
    if (config.visionModel) console.log(LOG, `[debug] vision provider: ${config.visionModel} (from HYSA_VISION_MODEL)`);
  }
  try {
    const hasImages = hasImageAttachments(req.attachments);
    const visionAvailable = supportsVision(prov, config.currentModel);

    // ── Vision fallback: if images present but current provider not vision-capable ──
    if (hasImages && !visionAvailable) {
      const visionTimer = Date.now();
      const imageCount = req.attachments?.filter(a => a.kind === 'image').length || 0;
      console.log(LOG, `[req:${reqId}] Vision pipeline: taskKind=image_vision, requiredCapability=vision, text/code provider: ${textModelLabel}, providerSupportsVision=${visionAvailable}, imageCount=${imageCount}`);
      if (config.debug) {
        console.log(LOG, `[debug] text model: ${config.textModel || config.currentModel}${config.visionModel ? `, vision model: ${config.visionModel}` : ', no explicit vision model configured'}`);
      }

      if (req.attachments) {
        for (const att of req.attachments) {
          if (att.kind === 'image') {
            console.log(LOG, `[req:${reqId}] image attachment: ${att.name}, ${att.size}B, hasDataUrl ${!!att.dataUrl}`);
          }
        }
      }

      const visionCandidates = await getVisionFallbackCandidates(config);
      const failures: { label: string; reason: string; error?: string }[] = [];

      if (visionCandidates.length > 0) {
        console.log(LOG, `[req:${reqId}] Current provider ${prov} not vision-capable, trying ${visionCandidates.length} vision-capable fallback(s)`);
        for (const vc of visionCandidates) {
          console.log(LOG, `[req:${reqId}]   Fallback candidate: ${vc.label}`);
        }

        const visionMsgs = buildVisionMessages(req.messages, req.attachments!);
        const fbProjectInfo = getProjectInfo(workingDir);
        const fbSysPrompt = buildSystemPrompt({
          type: fbProjectInfo.type,
          entryPoints: fbProjectInfo.entryPoints,
          configFiles: fbProjectInfo.configFiles,
          fileCount: fbProjectInfo.fileCount,
          tree: fbProjectInfo.tree.length < 3000 ? fbProjectInfo.tree : fbProjectInfo.tree.slice(0, 3000) + '\n... (truncated)',
        }, config.agentMode || 'chat', false, prov, config.promptMode || 'auto', config.userName);

        const fbMessages: any[] = visionMsgs.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));
        injectLanguageInstruction(fbMessages);

        for (const c of visionCandidates) {
          console.log('[vision] using provider', c.provider, 'for vision messages');
          const timeoutMs = 30000;
          const attemptStart = Date.now();
          try {
            console.log(LOG, `[req:${reqId}] Trying vision provider: selectedProvider=${c.provider}, selectedModel=${c.model} (timeout: ${timeoutMs / 1000}s)`);
            validateProviderConsistency(c.provider, c.model, 'image_vision');
            assertNoImagePayload(fbMessages as any, c.provider, c.model);
            const client = createSingleClient(c.provider, c.model, config.apiKeys, config.ollamaBaseUrl, config.localOpenAiBaseUrl, config.localOpenAiModel, config);
            const result = await withTimeout(client.sendMessage(fbMessages, fbSysPrompt), timeoutMs);
            const duration = Date.now() - attemptStart;
            if (result.message) {
              console.log(LOG, `[req:${reqId}] ✅ Vision fallback succeeded with selectedProvider=${c.provider}, selectedModel=${c.model} in ${(duration / 1000).toFixed(1)}s`);
              return {
                message: result.message,
                toolCalls: result.toolCalls,
                provider: PROVIDER_DEFAULTS[c.provider]?.label || c.provider,
                model: c.model,
              };
            }
          } catch (err: unknown) {
            const e = err as Error;
            const duration = Date.now() - attemptStart;
            const errMsg = e.message || '';
            const cat = categorizeError(errMsg);
            let reasonStr: string;
            if (cat === 'rate_limit') reasonStr = 'rate-limited';
            else if (cat === 'quota') reasonStr = 'quota exceeded';
            else if (cat === 'timeout') reasonStr = 'timed out';
            else if (cat === 'invalid_key') reasonStr = 'invalid key';
            else if (cat === 'model_unavailable') reasonStr = 'unavailable';
            else if (cat === 'network') reasonStr = 'network error';
            else if (errMsg.toLowerCase().includes('no active credentials') || errMsg.toLowerCase().includes('active credential')) reasonStr = 'no active credentials';
            else reasonStr = 'failed';
            failures.push({ label: c.label, reason: reasonStr, error: errMsg.slice(0, 200) });
            console.log(LOG, `[req:${reqId}] ❌ Vision fallback failed: selectedProvider=${c.provider}, selectedModel=${c.model}, reason=${reasonStr}, error=${errMsg.slice(0, 200)} (${(duration / 1000).toFixed(1)}s)`);
          }
        }
      }

      // All vision providers failed — friendly message in user's language
      const userLastMsg = req.messages.filter(m => m.role === 'user').pop()?.content || '';
      const lang = getResponseLanguage(userLastMsg);
      const msg = getVisionFallbackErrorMessage(lang, failures, !!config.debug);
      const visionTiming = Date.now() - visionTimer;
      console.log(LOG, `[req:${reqId}] All ${failures.length} vision fallback(s) failed after ${(visionTiming / 1000).toFixed(1)}s`);
      return {
        message: msg,
        toolCalls: [],
        timing: { visionTotal: visionTiming },
        visionDebug: {
          taskKind: 'image_vision',
          requiredCapability: 'vision',
          selectedProvider: failures[0]?.label?.split(' / ')[0] || 'none',
          selectedModel: failures[0]?.label?.split(' / ')[1] || 'none',
          providerSupportsVision: visionAvailable,
          imageCount,
          failures,
        },
      };
    }

    // Inject attachment text content as context before the user's question
    if (req.attachments && req.attachments.length > 0) {
      console.log(LOG, `Attachments: ${req.attachments.length} file(s)`);
      for (const att of req.attachments) {
        const hasText = !!att.textContent && att.textContent.length > 0;
        const hasDataUrl = !!att.dataUrl;
        console.log(LOG, `  ${att.name} (${att.kind}, ${att.size}B, hasText: ${hasText}${att.kind === 'image' ? `, hasDataUrl: ${hasDataUrl}` : ''})`);
        if (hasText && att.kind !== 'image') {
          const contextMsg = {
            role: 'user' as const,
            content: `Attached document content:\nFilename: ${att.name}\nType: ${att.kind.toUpperCase()}\nExtracted text:\n\`\`\`\n${att.textContent}\n\`\`\`\nUse this extracted text to answer the user's question. Do not say you cannot read the ${att.kind.toUpperCase()}.`,
          };
          const insertAt = Math.max(0, req.messages.length - 1);
          req.messages.splice(insertAt, 0, contextMsg);
          console.log(LOG, `  Injected context before user's message`);
        }
      }
    }

    // Format messages for vision if image attachments exist
    let visionMessages = req.messages;
    if (hasImages && visionAvailable) {
      visionMessages = buildVisionMessages(req.messages, req.attachments!);
    }

    const lastMessage = visionMessages[visionMessages.length - 1];
    const label = PROVIDER_DEFAULTS[prov]?.label || prov;
    console.log(LOG, `Starting chat with provider: ${label}, model: ${config.currentModel}`);

    const client = createClient(config);
    const projectInfo = getProjectInfo(workingDir);
    const gitInfo = getGitInfo(workingDir);

    const isLocal = LOCAL_FREE_PROVIDERS.includes(config.currentProvider);
    const lightActive = config.lightMode !== false && isLocal;
    const systemPrompt = buildSystemPrompt({
      type: projectInfo.type,
      entryPoints: projectInfo.entryPoints,
      configFiles: projectInfo.configFiles,
      fileCount: projectInfo.fileCount,
      tree: projectInfo.tree.length < 3000 ? projectInfo.tree : projectInfo.tree.slice(0, 3000) + '\n... (truncated)',
    }, config.agentMode || 'chat', lightActive, config.currentProvider, config.promptMode || 'auto', config.userName);

    const messages: any[] = visionMessages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
    injectLanguageInstruction(messages);
    const imgStripped2 = sanitizeMessagesForTextModel(messages, prov, config.currentModel);
    if (imgStripped2 > 0) {
      console.log(LOG, `[req:${reqId}] Sanitized ${imgStripped2} image part(s) for text-only model ${config.currentModel}`);
    }

    // ── Timing / task classification ─────────────────
    const timer = new TimingTracker();
    timer.start('total');
    timer.start('classification');
    const lastContent = typeof lastMessage?.content === 'string' ? lastMessage.content : '';
    const taskKind = classifyTask(visionMessages as any, req.attachments);
    const projectDecision = decideProjectMode(lastContent, true, taskKind);
    const isProjectQuery = detectProjectIntent(lastContent);
    const useProjectCtx = projectDecision.projectMode || shouldInjectProjectContext(lastContent, taskKind) || isProjectQuery;
    const isSimpleQ = !projectDecision.projectMode && (isSimpleQuestion(lastContent) || taskKind === 'simple_chat');
    timer.stop('classification');

    console.log(LOG, `[req:${reqId}] task=${taskKind} projectMode=${projectDecision.projectMode} reason=${projectDecision.reason} simple=${isSimpleQ} projectQuery=${isProjectQuery}`);

    // ── Agentic plan for complex tasks ─────────────
    const plan = generatePlan(lastContent, taskKind);

    // ── Capability question detection ────────────────
    const capLastMsg = messages[messages.length - 1];
    const capContent = typeof capLastMsg?.content === 'string' ? capLastMsg.content : '';
    if (capContent && isCapabilityQuestion(capContent)) {
      const wsDiag = getSearchDiagnostics();
      const response = getCapabilityResponse(capContent, wsDiag.isReliable);
      console.log(LOG, `[req:${reqId}] Capability question, returning direct response`);
      return { message: response, toolCalls: [] };
    }

    // ── Per-query prompt mode resolution ────────────────
    const lastUserMsgRaw = visionMessages.filter(m => m.role === 'user').pop()?.content || '';
    const lastUserMsg = typeof lastUserMsgRaw === 'string' ? lastUserMsgRaw : '';
    const simpleMode = isSimpleQ;
    const resolvedMode = resolvePromptMode(
      config.promptMode || 'auto',
      config.currentProvider,
      simpleMode,
    );
    let perQueryPrompt = buildSystemPrompt({
      type: projectInfo.type,
      entryPoints: useProjectCtx ? projectInfo.entryPoints : [],
      configFiles: useProjectCtx ? projectInfo.configFiles : [],
      fileCount: projectInfo.fileCount,
      tree: useProjectCtx && projectInfo.tree.length < 3000 ? projectInfo.tree : '',
    }, config.agentMode || 'chat', lightActive, config.currentProvider, resolvedMode, config.userName);

    if (config.debug) {
      const systemTokens = estimateTokens(perQueryPrompt);
      let historyTokens = 0;
      for (const m of messages) {
        if (typeof m.content === 'string') {
          historyTokens += estimateTokens(m.content);
        } else {
          historyTokens += 100;
        }
      }
      const totalTokens = systemTokens + historyTokens;
      console.log(LOG, `[debug] Task: ${taskKind}, projectCtx=${useProjectCtx}, mode: ${resolvedMode}`);
      console.log(LOG, `[debug] System prompt: ~${systemTokens} tokens`);
      console.log(LOG, `[debug] History/messages: ~${historyTokens} tokens`);
      console.log(LOG, `[debug] Total estimated: ~${totalTokens} tokens`);
    }

    // ── Web search detection ────────────────────────
    const searchLastMsg = messages[messages.length - 1];
    const searchLastContent = typeof searchLastMsg?.content === 'string' ? searchLastMsg.content : '';
    const isExplicitSearchCmd = /^hysa\s+(?:search|websearch)\s+/i.test(searchLastContent);
    const searchPatterns = [
      /^hysa\s+(?:search|websearch)\s+"(.+?)"$/i,
      /^hysa\s+(?:search|websearch)\s+'(.+?)'$/i,
      /^hysa\s+(?:search|websearch)\s+(.+)$/i,
      /^(?:search|look\s*up|google|bing|search\s*the\s*web)\s+(?:for\s+)?(.+)/i,
      /^(?:what\s+is\s+the\s+(?:current|latest|recent)\s+)/i,
      /^(?:latest\s+(?:news|updates?|info)\s+(?:about|on)\s+)/i,
      /^(?:where\s+can\s+(?:I|we)\s+(?:watch|find|get)\s+)/i,
      /^(?:ابحث\s+في\s+(?:الانترنت|الإنترنت|النت)\s+(?:عن\s+)?)(.+)/i,
      /^(?:ابحث\s+(?:لي\s+)?عن\s+)(.+)/i,
      /^(?:ابحث\s+(?:عنه|عنها|عنهم|عنك))(?:\s+في\s+(?:الانترنت|الإنترنت|النت))?(?:\s+(.+))?/i,
      /^(?:دور\s+(?:عليها|عليه|عليهم|عليك))(?:\s+في\s+(?:الانترنت|الإنترنت|النت))?(?:\s+(.+))?/i,
      /^(?:شوف|فتش)\s+(?:عليها|عليه|عليهم|عليك)(?:\s+في\s+(?:الانترنت|الإنترنت|النت))?(?:\s+(.+))?/i,
      /^(?:دور|فتش)\s+(?:في\s+)?(?:غوغل|جوجل)\s+(?:عن\s+)?(.+)/i,
      /^(?:شوف|فتش)\s+(?:في\s+)?(?:النت|الانترنت|الإنترنت)\s+(?:عن\s+)?(.+)/i,
      /^(?:هات\s+مصادر|أعطني\s+روابط|اعطني\s+روابط|هات\s+روابط)(?:\s+(?:عن|حول)\s+(.+))?/i,
      /^(?:اعطني|أعطني)\s+(?:مصادر|معلومة)\s+(?:عن|حول)\s+(.+)/i,
      /^(?:مصادر\s+|روابط\s+)(?:عن|حول)\s+(.+)/i,
      /^(?:آخر\s+أخبار\s+)(.+)/i,
      /^(?:هل\s+هذا\s+صحيح\s+(?:الآن|حاليا|حالياً)?)/i,
      /^(?:ما\s+هو\s+(?:آخر|أحدث)\s+)/i,
      /^(?:من\s+أين\s+أتيت\s+)/i,
      /^(?:هل\s+هذه\s+المعلومة\s+محدثة)/i,
      /^(?:هل\s+عندك\s+معلومات\s+(?:عن|حول)\s+)(.+)/i,
      /^(?:دور\s+(?:لي\s+)?(?:على\s+)?)(.+)/i,
    ];
    let searchQuery: string | null = null;
    for (const p of searchPatterns) {
      const m = searchLastContent.match(p);
      if (m) {
        searchQuery = m[1]?.trim() || searchLastContent;
        break;
      }
    }
    if (searchQuery) {
      const wsDiag = getSearchDiagnostics();
      if (!wsDiag.isReliable) {
        const hasArabic = /[\u0600-\u06FF]/.test(searchLastContent);
        const configMsg = hasArabic
          ? 'البحث في الإنترنت غير مضبوط بشكل موثوق. فعّل TAVILY_API_KEY أو SERPER_API_KEY أو BRAVE_SEARCH_API_KEY.'
          : 'Web search is not reliably configured. To enable web search, set TAVILY_API_KEY, SERPER_API_KEY, or BRAVE_SEARCH_API_KEY.';
        console.log(LOG, `[req:${reqId}] Web search skipped (provider: ${wsDiag.provider}, no reliable API keys)`);
        return { message: configMsg, toolCalls: [] };
      } else {
        try {
          const results = await searchWeb(searchQuery, { maxResults: 5 });
          const formatted = formatSearchResults(searchQuery, results);
          if (isExplicitSearchCmd) {
            searchLastMsg.content = `[Web search results for "${searchQuery}"]\n\n${formatted}`;
          } else {
            const searchMsg = { role: 'user' as const, content: formatted };
            messages.splice(messages.length - 1, 0, searchMsg);
          }
          console.log(LOG, `[req:${reqId}] Web search: ${results.length} results for "${searchQuery}"`);
        } catch (err: unknown) {
          console.log(LOG, `[req:${reqId}] Web search failed: ${(err as Error).message}`);
        }
      }
    }

    // ── Entity detection for unknown names/handles ─────
    if (!searchQuery) {
      let previousUserMessage: string | undefined;
      for (let i = messages.length - 2; i >= 0; i--) {
        if (messages[i].role === 'user' && typeof messages[i].content === 'string') {
          previousUserMessage = messages[i].content as string;
          break;
        }
      }
      const entityResult = shouldSearchEntity(searchLastContent, previousUserMessage);
      if (entityResult.shouldSearch && entityResult.query) {
        searchQuery = entityResult.query;
        console.log(LOG, `[req:${reqId}] Entity search: "${searchQuery}"`);
        const wsDiag = getSearchDiagnostics();
        if (!wsDiag.isReliable) {
          const hasArabic = /[\u0600-\u06FF]/.test(searchLastContent);
          const configMsg = hasArabic
            ? 'البحث في الإنترنت غير مضبوط بشكل موثوق. فعّل TAVILY_API_KEY أو SERPER_API_KEY أو BRAVE_SEARCH_API_KEY.'
            : 'Web search is not reliably configured. To enable web search, set TAVILY_API_KEY, SERPER_API_KEY, or BRAVE_SEARCH_API_KEY.';
          console.log(LOG, `[req:${reqId}] Entity search skipped (provider: ${wsDiag.provider}, no reliable API keys)`);
          return { message: configMsg, toolCalls: [] };
        } else {
          try {
            const results = await searchWeb(searchQuery, { maxResults: 5 });
            const formatted = formatSearchResults(searchQuery, results);
            const searchMsg = { role: 'user' as const, content: formatted };
            messages.splice(messages.length - 1, 0, searchMsg);
            console.log(LOG, `[req:${reqId}] Entity search: ${results.length} results for "${searchQuery}"`);
          } catch (err: unknown) {
            console.log(LOG, `[req:${reqId}] Entity search failed: ${(err as Error).message}`);
          }
        }
      }
    }

    // ── Project file injection ──────────────────────
    timer.start('project_scan');
    let fileInjection = '';
    if (!searchQuery && useProjectCtx && (isProjectQuery || taskKind === 'project_scan' || taskKind === 'code_review' || taskKind === 'debugging' || taskKind === 'code_edit' || taskKind === 'coding_qa')) {
      // Rank project files by relevance to the query
      const allFiles = projectInfo.tree.split('\n').filter(f => !f.endsWith('/') && f.length > 0);
      const ranked = rankFiles(allFiles, lastUserMsg, 8);
      const topFiles = ranked.filter(r => r.score > 5).map(r => r.path).slice(0, 5);

      const fileParts: string[] = [];
      for (const file of topFiles) {
        const fullPath = resolve(workingDir, file);
        if (shouldIgnore(fullPath, workingDir)) continue;
        const content = readFile(fullPath);
        if (content) {
          const lines = content.split('\n').length;
          fileParts.push(`\n--- ${file} (${lines} lines) ---\n${content.slice(0, 3000)}\n`);
        }
      }

      if (fileParts.length > 0) {
        fileInjection = fileParts.join('');
        const est = estimateTokens(fileInjection);
        if (est < 2000) {
          // Inject file content as a separate user message before the last message
          const fileMsg = { role: 'user' as const, content: `Relevant project files:\n${fileInjection}\n\nUser request: ${lastUserMsg}` };
          messages[messages.length - 1] = fileMsg;
          console.log(LOG, `[req:${reqId}] Injected ${topFiles.length} relevant files (~${est} tokens)`);
        }
      }
    }
    timer.stop('project_scan');

    // ── Brain context injection (scored selection) ──
    timer.start('context_select');
    if (!isSimpleQ && !searchQuery) {
      try {
        const selected = await selectContext({
          message: lastUserMsg,
          taskKind,
          maxItems: 5,
          debug: !!config.debug,
        });
        if (selected.items.length > 0) {
          perQueryPrompt += formatSelectedContext(selected);
          if (config.debug) {
            console.log(LOG, `[debug] Context selection: ${selected.items.length} items (${selected.totalChars}/${selected.budget} chars)`);
          }
        }
      } catch { /* skip */ }
    }
    timer.stop('context_select');

    // ── Timing log ──
    timer.stop('total');
    const timingReport = timer.report() as Record<string, number> & { capability?: string; routing_mode?: string };
    timingReport.capability = isModelVisionCapable(config.currentModel) || hasImageAttachments(req.attachments) ? 'vision' : 'text';
    timingReport.routing_mode = 'api';
    if (config.debug) {
      console.log(LOG, `[timing] classification=${timingReport.classification}ms, project_scan=${timingReport.project_scan}ms, context_select=${timingReport.context_select}ms, total=${timingReport.total}ms`);
    }

    let currentPlan = plan ? clonePlan(plan) : null;
    const filesTouched: string[] = [];
    let commandsRun = 0;

    console.log(LOG, `Sending ${messages.length} messages to provider`);
    sanitizeMessagesForTextModel(messages, config.currentProvider, config.currentModel);
    assertNoImagePayload(messages as any, config.currentProvider, config.currentModel);
    let response = await client.sendMessage(messages as any, perQueryPrompt);
    console.log(LOG, 'Provider response received successfully');

    // ── YOLO tool continuation loop ──────────────
    let steps = 0;
    let stepsWithoutProgress = 0;
    const toolMaxSteps = getMaxToolSteps(taskKind);
    let currentMessages = [...messages];
    let activeProvider = config.currentProvider;
    let activeModel = config.currentModel;
    resetToolProgress();

    while (steps < toolMaxSteps && response.toolCalls.length > 0) {
      const yoloMode = getYolo();
      if (!yoloMode) break;

      const autoTools = response.toolCalls.filter(tc =>
        tc.type === 'read_file' ||
        (tc.type === 'execute_command' && classifyCommand(tc.params.command || '') === 'safe')
      );

      // If any tool needs manual approval, stop and return remaining
      if (autoTools.length < response.toolCalls.length) break;

      steps++;
      if (config.debug) {
        console.log(LOG, `[req:${reqId}] YOLO tool loop step ${steps}/${toolMaxSteps}: ${autoTools.length} tools`);
      }

      // ── Update plan state: mark inferred step running ──
      if (currentPlan) {
        for (const tc of autoTools) {
          const idx = inferStepFromToolCall(tc.type, tc.params, currentPlan);
          if (idx >= 0) {
            currentPlan = markStepRunning(currentPlan, idx);
          }
          if (tc.type === 'read_file' && tc.params.filePath) {
            filesTouched.push(tc.params.filePath);
          }
          if (tc.type === 'execute_command') {
            commandsRun++;
          }
        }
      }

      const { results } = await executeToolCalls(autoTools, true);

      // ── Update plan state: mark step done ──
      if (currentPlan) {
        for (let i = 0; i < autoTools.length; i++) {
          const tc = autoTools[i];
          const idx = inferStepFromToolCall(tc.type, tc.params, currentPlan);
          if (idx >= 0) {
            const resultText = results[i] || '';
            currentPlan = resultText.includes('Error:') || resultText.includes('Failed:')
              ? markStepFailed(currentPlan, idx)
              : markStepDone(currentPlan, idx);
          }
        }
      }

      const feedText = response.message
        ? `${response.message}\n\nTool results:\n${formatToolResults(autoTools, results)}`
        : `Tool results:\n${formatToolResults(autoTools, results)}`;
      currentMessages.push({ role: 'assistant' as const, content: feedText });

      // Check if progress is being made — break if stuck in a loop
      if (!isMakingProgress(autoTools, results)) {
        stepsWithoutProgress++;
        if (stepsWithoutProgress >= 3) {
          if (config.debug) console.log(LOG, `[req:${reqId}] Tool loop: no progress for ${stepsWithoutProgress} steps, stopping`);
          break;
        }
      } else {
        stepsWithoutProgress = 0;
      }

      // Sanitize and validate against the active provider
      sanitizeMessagesForTextModel(currentMessages, activeProvider, activeModel);
      assertNoImagePayload(currentMessages as any, activeProvider, activeModel);
      response = await client.sendMessage(currentMessages as any, perQueryPrompt);
    }

    // If still has tool calls after loop, return them to client
    if (response.toolCalls.length > 0 && steps > 0) {
      console.log(LOG, `[req:${reqId}] Tool loop stopped after ${steps} steps, ${response.toolCalls.length} remaining tools`);
    }

    const planReport = currentPlan ? buildFinalReport(currentPlan, [...new Set(filesTouched)], commandsRun) : undefined;

    const fbEvents = getFallbackEvents();
    const fallbackEvents = fbEvents.map(e => e.reason);
    const actualProvider = getLastSuccessfulProvider();
    const actualModel = getLastSuccessfulModel();

    return {
      message: response.message,
      toolCalls: response.toolCalls.map(tc => ({
        type: tc.type,
        params: tc.params,
      })),
      plan: currentPlan || plan || undefined,
      planReport,
      fallbackEvents: fallbackEvents.length > 0 ? fallbackEvents : undefined,
      provider: actualProvider ? (PROVIDER_DEFAULTS[actualProvider as ProviderType]?.label || actualProvider) : (PROVIDER_DEFAULTS[prov]?.label || prov),
      model: actualModel || config.currentModel,
      timing: timingReport,
    };
  } catch (err: unknown) {
    const e = err as Error;
    const rawMsg = e.message || 'Unknown provider error';
    console.log(LOG, `[req:${reqId}] Provider failed: ${rawMsg}`);
    const userLastMsg = req.messages.filter(m => m.role === 'user').pop()?.content || '';
    const lang = getResponseLanguage(userLastMsg);
    const lastErr = getLastError();
    const lastFb = getLastFallbackUsed();
    const fbEvents = getFallbackEvents();

    // If ALL free providers failed, use the clean "all busy" message
    const allFailedRaw = rawMsg.includes('All free providers');
    let friendlyMsg: string;
    if (allFailedRaw) {
      if (lang === 'arabic') {
        friendlyMsg = 'جميع المزودات المجانية مشغولة أو وصلت للحد المسموح حاليًا. جرّب بعد قليل أو استخدم مزود مدفوع.';
      } else {
        friendlyMsg = 'All free providers are currently busy or rate-limited. Try again shortly or configure a paid/stable provider.';
      }
    } else {
      friendlyMsg = getFriendlyErrorMessage(lang, rawMsg, !!config.debug, PROVIDER_DEFAULTS[prov]?.label || prov);
    }

    if (config.debug && fbEvents.length > 0) {
      const triedLines = fbEvents.map(e => `  • ${e.reason}`).join('\n');
      friendlyMsg += `\n\nTried:\n${triedLines}`;
    }

    return {
      message: friendlyMsg,
      toolCalls: [],
      fallbackEvents: fbEvents.length > 0 ? fbEvents.map(e => e.reason) : undefined,
      provider: lastFb || PROVIDER_DEFAULTS[prov]?.label || prov,
      model: lastErr?.model || config.currentModel,
    };
  }
}

export async function runCommand(command: string): Promise<{ stdout: string; stderr: string; error?: string }> {
  try {
    const { execSync } = await import('node:child_process');
    const translated = translateCommand(command);
    const needsPowerShell = translated !== command && (translated.includes('Get-') || translated.includes('Select-'));
    const shell = process.platform === 'win32'
      ? (needsPowerShell ? 'powershell.exe -NoProfile -Command' : process.env.ComSpec || 'cmd.exe')
      : undefined;
    const stdout = execSync(translated, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      cwd: workingDir,
      shell,
    });
    return { stdout: stdout.trim(), stderr: '' };
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string; stdout?: string };
    return {
      stdout: e.stdout?.toString().trim() || '',
      stderr: e.stderr?.toString().trim() || '',
      error: e.message || 'Command failed',
    };
  }
}

// ── Exported for testing ──────────────────────────────

export { getVisionFallbackCandidates, getVisionFallbackErrorMessage, buildVisionMessages, hasImageAttachments, supportsVision, sanitizeMessagesForTextModel, VISION_FALLBACK_ORDER };

export function getFilePreview(path: string, content: string): string | null {
  const fullPath = resolve(workingDir, path);
  return previewEdit(fullPath, content);
}

export function getYoloStatus(): { enabled: boolean } {
  return { enabled: getYolo() };
}

export function setYoloStatus(enabled: boolean): { enabled: boolean } {
  setYolo(enabled);
  return { enabled };
}

export function getFallbackStatus(): {
  unhealthy: string[];
  lastError: { provider: string; model: string; reason: string; category: string } | null;
  lastFallback: string | null;
  lastSuccessful: { provider: string | null; model: string | null };
  lastAttempted: { provider: string | null; model: string | null; category: string | null };
} {
  const summary = toHealthSummary();
  const lastErr = getLastError();
  const health = getAllHealth();
  let lastAttemptedProvider: string | null = null;
  let lastAttemptedModel: string | null = null;
  let lastAttemptedCategory: string | null = null;

  // Find the most recently attempted entry: lastError or the latest health timestamp
  if (lastErr) {
    lastAttemptedProvider = lastErr.provider;
    lastAttemptedModel = lastErr.model;
    lastAttemptedCategory = lastErr.category;
  } else {
    let latestTs = 0;
    for (const [k, rec] of health) {
      if (rec.lastFailureTime && rec.lastFailureTime > latestTs) {
        latestTs = rec.lastFailureTime;
        const sep = k.lastIndexOf(':');
        lastAttemptedProvider = k.substring(0, sep);
        lastAttemptedModel = k.substring(sep + 1);
        lastAttemptedCategory = rec.category;
      }
    }
  }

  return {
    unhealthy: summary,
    lastError: lastErr ? { provider: lastErr.provider, model: lastErr.model, reason: lastErr.reason, category: lastErr.category } : null,
    lastFallback: getLastFallbackUsed(),
    lastSuccessful: {
      provider: getLastSuccessfulProvider(),
      model: getLastSuccessfulModel(),
    },
    lastAttempted: {
      provider: lastAttemptedProvider,
      model: lastAttemptedModel,
      category: lastAttemptedCategory,
    },
  };
}
