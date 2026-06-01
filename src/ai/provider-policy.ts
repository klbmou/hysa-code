/**
 * Provider selection policy.
 *
 * Reachability is not enough: a provider is usable only when it is configured,
 * not in provider cooldown, and has at least one model that is not cooling down
 * or marked unhealthy.
 */

import type { ProviderType, HysaConfig } from '../config/keys.js';
import {
  EXPERIMENTAL_FREE_PROVIDERS,
  LOCAL_FREE_PROVIDERS,
  PROVIDER_DEFAULTS,
  PROVIDER_MODELS,
  isLocalFallbackEnabled,
  providerHasOptionalApiKey,
} from '../config/keys.js';
import type { TaskKind } from './task-classifier.js';
import {
  getHealthRecord,
  getModelsInCooldown,
  getProviderCooldownRemaining,
  isOnCooldown,
  isProviderOnCooldown,
  isUnhealthy,
} from './model-health.js';

export type TaskClassification = TaskKind;
export type ProviderTier = 'local_free' | 'free_api' | 'premium_api' | 'experimental_free';

export interface ProviderPolicyDecision {
  provider: ProviderType;
  model?: string;
  reason: string;
}

export interface RuntimeProviderModels {
  ollama?: string[];
  local_openai?: string[];
  hysa_ai?: string[];
  ninerouter?: string[];
  ninerouterVision?: string[];
  ninerouterAutoHealthChecked?: boolean;
}

export interface ProviderUsability {
  provider: ProviderType;
  configured: boolean;
  usable: boolean;
  reason: string;
  usableModels: string[];
  cooldownModels: string[];
  providerCooldownRemainingMs: number;
}

const CODE_OR_PROJECT_REQUEST = /\b(code|file|files|repo|project|debug|bug|error|stack|trace|fix|edit|change|modify|implement|refactor|review|search|find|grep|read|run|test|build|compile|function|class|type|interface|component|route|api)\b/i;

function hasArabicProjectKeywords(text: string): boolean {
  return /(?:مشروع|ملف|ملفات|الكود|كود|مجلد|مكون|مكونات|كومبوننت|دالة|دوال|وظيفة|وظائف|كلاس|ثغرة|ثغرات|خلل|خطأ|أخطاء|بنية|واجهة|اختبار|اختبارات|أصلح|إصلاح|راجع|مراجعة|حلل|تحليل|افحص|فحص|اختصر|تلخيص|اقرأ|قراءة|التطبيق|أمر|الأوامر|سكريبت|سكربت)/u.test(text);
}
const LOCAL_FALLBACK_DISABLED_REASON = 'local fallback disabled; set HYSA_ENABLE_LOCAL_FALLBACK=true to allow local fallback';
const ALL_PROVIDERS_UNAVAILABLE_MESSAGE = 'All currently configured providers are temporarily unavailable or rate-limited.';

export function getProviderTier(provider: string): ProviderTier {
  const premium = ['anthropic', 'openai'];
  const experimental = ['pollinations', 'puter', 'llm7'];

  if (LOCAL_FREE_PROVIDERS.includes(provider as ProviderType)) return 'local_free';
  if (premium.includes(provider)) return 'premium_api';
  if (experimental.includes(provider)) return 'experimental_free';
  return 'free_api';
}

export function isRateLimitError(error: string | Error | unknown): boolean {
  const msg = typeof error === 'string'
    ? error
    : error instanceof Error
      ? error.message
      : String(error ?? '');
  return /rate\s*limit|rate-limited|429|too\s*many\s*requests|requests?\s+per\s+minute|tokens?\s+per\s+minute/i.test(msg);
}

export function isTimeoutError(error: string | Error | unknown): boolean {
  const msg = typeof error === 'string'
    ? error
    : error instanceof Error
      ? error.message
      : String(error ?? '');
  return /timeout|timed\s*out|abort|aborted|deadline|etimedout/i.test(msg);
}

export function isNetworkError(error: string | Error | unknown): boolean {
  const msg = typeof error === 'string'
    ? error
    : error instanceof Error
      ? error.message
      : String(error ?? '');
  return /econnrefused|econnreset|fetch failed|network|enotfound|unavailable|econnaborted|connection/i.test(msg);
}

export function getRetryAfterSeconds(error: unknown): number | null {
  const err = error as {
    headers?: Headers | Record<string, string | number | undefined>;
    response?: { headers?: Headers | Record<string, string | number | undefined> };
  };
  const headers = err?.headers ?? err?.response?.headers;
  const raw = getHeader(headers, 'retry-after');
  if (!raw) return null;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds);

  const dateMs = Date.parse(String(raw));
  if (!Number.isNaN(dateMs)) {
    return Math.max(1, Math.ceil((dateMs - Date.now()) / 1000));
  }

  return null;
}

function getHeader(headers: Headers | Record<string, string | number | undefined> | undefined, name: string): string | null {
  if (!headers) return null;
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name);
  }
  const record = headers as Record<string, string | number | undefined>;
  const direct = record[name] ?? record[name.toLowerCase()] ?? record[name.toUpperCase()];
  return direct === undefined ? null : String(direct);
}

export function getProviderModelsFromRegistry(runtimeModels?: RuntimeProviderModels): Map<string, string[]> {
  const modelsByProvider = new Map<string, string[]>();
  for (const [provider, models] of Object.entries(PROVIDER_MODELS)) {
    modelsByProvider.set(provider, [...models]);
  }

  if (runtimeModels && 'ollama' in runtimeModels) {
    modelsByProvider.set('ollama', dedupe(runtimeModels.ollama ?? []));
  }
  if (runtimeModels && 'local_openai' in runtimeModels) {
    modelsByProvider.set('local_openai', dedupe(runtimeModels.local_openai ?? []));
  }
  if (runtimeModels && 'hysa_ai' in runtimeModels) {
    modelsByProvider.set('hysa_ai', dedupe(runtimeModels.hysa_ai ?? []));
  }
  if (runtimeModels && 'ninerouter' in runtimeModels) {
    modelsByProvider.set('ninerouter', dedupe([
      ...(runtimeModels.ninerouter ?? []),
      ...(modelsByProvider.get('ninerouter') ?? []),
    ]));
  }

  return modelsByProvider;
}

export function getProviderModels(provider: string, runtimeModels?: RuntimeProviderModels): string[] {
  return getProviderModelsFromRegistry(runtimeModels).get(provider) ?? [];
}

export function providerIsConfigured(provider: string, config: HysaConfig): boolean {
  const prov = provider as ProviderType;
  if (prov === 'openai_router') return !!config.openaiRouterBaseUrl;
  if (prov === 'anthropic_proxy') return !!config.anthropicProxyBaseUrl;
  if (prov === 'ninerouter') return !!config.ninerouterBaseUrl || config.ninerouterDiscovered === true;
  if (prov === 'ollama' || prov === 'local_openai' || prov === 'hysa_ai') return true;
  if (EXPERIMENTAL_FREE_PROVIDERS.includes(prov) && !config.allowExperimentalProviders) return false;
  if (providerHasOptionalApiKey(prov)) return true;
  return !!config.apiKeys[prov as keyof typeof config.apiKeys];
}

export function providerModelHasActiveCredentials(provider: string, model: string, config: HysaConfig): boolean {
  if (!providerIsConfigured(provider, config)) return false;

  const prov = provider as ProviderType;
  const normalizedModel = model.trim().toLowerCase();
  if (!normalizedModel) return false;

  if (prov === 'openai') return !!config.apiKeys.openai;
  if (prov === 'anthropic') return !!config.apiKeys.anthropic;
  if (prov === 'gemini') return !!config.apiKeys.gemini;
  if (prov === 'openrouter') return !!config.apiKeys.openrouter;
  if (prov === 'groq') return !!config.apiKeys.groq;
  if (prov === 'deepseek') return !!config.apiKeys.deepseek;
  if (prov === 'opencode_zen') return !!config.apiKeys.opencode_zen;

  if (prov === 'openai_router') {
    if (isAutoModel(normalizedModel)) return !!config.apiKeys.openai;
    if (isOpenAiRoutedModel(normalizedModel)) return !!config.apiKeys.openai;
  }
  if (prov === 'ninerouter') {
    const discoveredModels = new Set([
      ...(config.ninerouterModels ?? []),
      ...(config.ninerouterVisionModels ?? []),
    ].map(m => m.trim().toLowerCase()));
    if (isAutoModel(normalizedModel)) return config.ninerouterAutoHealthChecked === true;
    if (discoveredModels.has(normalizedModel)) return true;
    if (discoveredModels.size > 0) return false;
    if (isOpenAiRoutedModel(normalizedModel)) return !!config.apiKeys.openai;
  }

  return true;
}

export function isProviderUsable(
  provider: string,
  config: HysaConfig,
  runtimeModels?: RuntimeProviderModels,
  healthChecker?: { isOnCooldown: (p: string, m: string) => boolean; isUnhealthy: (p: string, m: string) => boolean },
): boolean {
  return getProviderUsability(provider as ProviderType, config, runtimeModels, healthChecker).usable;
}

export function getProviderUsability(
  provider: ProviderType,
  config: HysaConfig,
  runtimeModels?: RuntimeProviderModels,
  healthChecker?: { isOnCooldown: (p: string, m: string) => boolean; isUnhealthy: (p: string, m: string) => boolean },
): ProviderUsability {
  const configured = providerIsConfigured(provider, config);
  const providerCooldownRemainingMs = getProviderCooldownRemaining(provider);
  const checker = healthChecker || { isOnCooldown, isUnhealthy };
  const models = getProviderModels(provider, runtimeModels);
  const cooldownModels: string[] = [];
  const usableModels: string[] = [];

  if (!configured) {
    return { provider, configured, usable: false, reason: 'not configured', usableModels, cooldownModels, providerCooldownRemainingMs };
  }
  if (isLocalProvider(provider) && provider !== config.currentProvider && !isLocalFallbackEnabled(config)) {
    return { provider, configured, usable: false, reason: LOCAL_FALLBACK_DISABLED_REASON, usableModels, cooldownModels, providerCooldownRemainingMs };
  }
  if (provider !== 'ninerouter' && isProviderOnCooldown(provider)) {
    return { provider, configured, usable: false, reason: `provider cooldown ${Math.ceil(providerCooldownRemainingMs / 1000)}s`, usableModels, cooldownModels, providerCooldownRemainingMs };
  }
  if (models.length === 0) {
    return { provider, configured, usable: false, reason: 'no models configured', usableModels, cooldownModels, providerCooldownRemainingMs };
  }

  for (const model of models) {
    if (!providerModelHasActiveCredentials(provider, model, config)) continue;
    if (checker.isOnCooldown(provider, model)) {
      cooldownModels.push(model);
      continue;
    }
    if (checker.isUnhealthy(provider, model)) continue;
    usableModels.push(model);
  }

  if (usableModels.length === 0) {
    const cooldownCount = getModelsInCooldown(provider).length;
    const reason = cooldownCount > 0
      ? 'all known models are in cooldown or unhealthy'
      : 'all known models are unhealthy';
    return { provider, configured, usable: false, reason, usableModels, cooldownModels, providerCooldownRemainingMs };
  }

  return { provider, configured, usable: true, reason: `${usableModels.length} usable model(s)`, usableModels, cooldownModels, providerCooldownRemainingMs };
}

export function getProviderRateLimitedModelCount(provider: string, runtimeModels?: RuntimeProviderModels): number {
  let count = 0;
  for (const model of getProviderModels(provider, runtimeModels)) {
    const health = getHealthRecord(provider, model);
    if (health?.rateLimited) count++;
  }
  return count;
}

export function shouldInjectProjectContext(message: string, taskKind: TaskKind): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;

  const words = trimmed.split(/\s+/).filter(Boolean);
  const hasProjectIntent = CODE_OR_PROJECT_REQUEST.test(trimmed) || hasArabicProjectKeywords(trimmed);

  if (words.length < 5 && !hasProjectIntent) return false;
  if (taskKind === 'simple_chat') return false;
  if (taskKind === 'search' || taskKind === 'web_research') return false;

  if (['code_edit', 'debugging', 'code_review', 'long_context', 'project_scan', 'coding_qa', 'long_reasoning'].includes(taskKind)) {
    return true;
  }

  return hasProjectIntent && trimmed.length > 20;
}

export function getBestProviderForTask(
  taskKind: TaskKind,
  config: HysaConfig,
  runtimeModels?: RuntimeProviderModels,
): ProviderType | null {
  for (const provider of getProviderPreferenceForTask(taskKind, config)) {
    if (isProviderUsable(provider, config, runtimeModels)) return provider;
  }
  return null;
}

export function getProviderPreferenceForTask(taskKind: TaskKind, input?: HysaConfig | ProviderType): ProviderType[] {
  const currentProvider = typeof input === 'string' ? input : input?.currentProvider;
  const localFallbackEnabled = typeof input === 'object' ? isLocalFallbackEnabled(input) : false;
  const currentIsLocal = !!currentProvider && isLocalProvider(currentProvider);
  const local: ProviderType[] = localFallbackEnabled
    ? LOCAL_FREE_PROVIDERS
    : currentIsLocal && currentProvider
      ? [currentProvider]
      : [];
  const directFree: ProviderType[] = taskKind === 'image_vision'
    ? ['gemini', 'openrouter', 'opencode_zen', 'groq', 'deepseek']
    : ['opencode_zen', 'openrouter', 'groq', 'deepseek', 'gemini'];
  const routerFree: ProviderType[] = ['ninerouter'];
  const configuredOnline: ProviderType[] = ['openai_router', 'anthropic_proxy', 'anthropic', 'openai'];
  const experimental: ProviderType[] = ['pollinations', 'llm7', 'puter'];
  const currentOnline = currentProvider && !currentIsLocal ? currentProvider : undefined;

  if (currentIsLocal) {
    return dedupeProviders([currentProvider, ...directFree, ...routerFree, ...configuredOnline, ...experimental, ...local]);
  }

  return dedupeProviders([currentOnline, ...directFree, ...routerFree, ...configuredOnline, ...experimental, ...local]);
}

export function didProviderFailWithCategory(provider: string, category: string, runtimeModels?: RuntimeProviderModels): boolean {
  const models = getProviderModels(provider, runtimeModels);
  if (models.length === 0) return false;
  return models.every(model => getHealthRecord(provider, model)?.category === category);
}

export function getAvailableFallbackProviders(config: HysaConfig, runtimeModels?: RuntimeProviderModels): ProviderUsability[] {
  const providers = getProviderPreferenceForTask('code_edit', config);
  return providers
    .map(provider => getProviderUsability(provider, config, runtimeModels))
    .filter(status => status.provider !== config.currentProvider && status.usable);
}

export function getSuggestedFallbackAction(provider: string, config: HysaConfig, lastError?: string, runtimeModels?: RuntimeProviderModels): string {
  if ((provider === 'openai_router' || provider === 'openrouter') && lastError && isRateLimitError(lastError)) {
    if (isLocalFallbackEnabled(config) && isProviderUsable('ollama', config, runtimeModels)) {
      return `${PROVIDER_DEFAULTS[provider as ProviderType]?.label || provider} is rate-limited. HYSA will use Ollama until the cooldown expires.`;
    }
    const localHint = isLocalFallbackEnabled(config)
      ? 'Ollama is not currently usable.'
      : 'Local fallback is disabled. To enable it, set HYSA_ENABLE_LOCAL_FALLBACK=true.';
    return `${ALL_PROVIDERS_UNAVAILABLE_MESSAGE} ${localHint}`;
  }

  if (!isProviderUsable(provider, config, runtimeModels)) {
    return `${PROVIDER_DEFAULTS[provider as ProviderType]?.label || provider} is not currently usable. Run hysa config to switch providers or wait for cooldowns to expire.`;
  }

  if (!isLocalFallbackEnabled(config)) {
    const fallbacks = getAvailableFallbackProviders(config, runtimeModels);
    if (fallbacks.length === 0) {
      return 'No usable fallback providers available. Local fallback is disabled. Enable HYSA_ENABLE_LOCAL_FALLBACK=true or configure another online provider.';
    }
  }

  return 'No action needed. A usable provider is available.';
}

function isLocalProvider(provider: ProviderType): boolean {
  return LOCAL_FREE_PROVIDERS.includes(provider);
}

function isAutoModel(model: string): boolean {
  return model === 'auto' || model === 'openai/auto';
}

function isOpenAiRoutedModel(model: string): boolean {
  return model.startsWith('openai/') || model === 'gpt-4o' || model === 'gpt-4o-mini' || model === 'gpt-4-turbo';
}

function dedupe<T>(items: T[]): T[] {
  return [...new Set(items.filter(Boolean))];
}

function dedupeProviders(items: (ProviderType | undefined)[]): ProviderType[] {
  return [...new Set(items.filter((item): item is ProviderType => !!item))];
}
