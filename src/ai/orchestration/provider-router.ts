import type { AIClient, AIResponse, Message } from '../types.js';
import type { ProviderType, HysaConfig } from '../../config/keys.js';
import { PROVIDER_DEFAULTS } from '../../config/keys.js';
import { createSingleClient } from '../client-factory.js';
import type { OrchestrationTaskKind } from './types.js';
import {
  isOnCooldown,
  isProviderOnCooldown,
  getHealthRecord,
  markModelCooldown,
  clearRequestSkips,
  clearFallbackEvents,
  addFallbackEvent,
  getFallbackEvents,
  getLastSuccessfulProvider,
  setLastSuccessfulProvider,
} from '../model-health.js';
import type { ErrorCategory } from '../model-health.js';
import { classifyNinerouterFailure, ninerouterProbeStatusToErrorCategory } from '../ninerouter.js';
import { scoreNinerouterModelForPlan } from './ninerouter-role-map.js';

const MAX_FALLBACK_ATTEMPTS = 5;

interface ModelCandidate {
  provider: ProviderType;
  model: string;
  label: string;
}

function getPrimary9RouterModel(taskKind: OrchestrationTaskKind, config: HysaConfig): string {
  const nrModels = config.ninerouterModels ?? [];
  if (nrModels.length === 0) {
    return config.ninerouterModel || PROVIDER_DEFAULTS.ninerouter.model;
  }
  if (nrModels.length === 1) return nrModels[0];

  const scored = nrModels
    .map(m => ({ model: m, score: scoreNinerouterModelForPlan(m, taskKind).score }))
    .sort((a, b) => b.score - a.score);

  return scored[0].model;
}

function buildFallbackCandidates(taskKind: OrchestrationTaskKind, config: HysaConfig): ModelCandidate[] {
  const candidates: ModelCandidate[] = [];
  const added = new Set<string>();

  function add(provider: ProviderType, model: string): void {
    const key = `${provider}:${model}`;
    if (added.has(key)) return;
    added.add(key);
    candidates.push({ provider, model, label: `${PROVIDER_DEFAULTS[provider]?.label || provider} / ${model}` });
  }

  // Tier 1: 9Router — try all models ordered by task score
  if (config.ninerouterBaseUrl) {
    const nrModels = config.ninerouterModels ?? [];
    const ordered = nrModels.length > 1
      ? nrModels.sort((a, b) => scoreNinerouterModelForPlan(b, taskKind).score - scoreNinerouterModelForPlan(a, taskKind).score)
      : nrModels;
    for (const m of ordered) {
      add('ninerouter', m);
    }
    if (ordered.length === 0) {
      add('ninerouter', config.ninerouterModel || PROVIDER_DEFAULTS.ninerouter.model);
    }
  }

  // Tier 2: openai_router
  if (config.openaiRouterBaseUrl) {
    const routerModel = config.openaiRouterModel || PROVIDER_DEFAULTS.openai_router.model;
    add('openai_router', routerModel);
    const extraModels = PROVIDER_DEFAULTS.openai_router?.model ? [PROVIDER_DEFAULTS.openai_router.model] : [];
    for (const m of extraModels) {
      add('openai_router', m);
    }
  }

  // Tier 3: Direct providers depending on task
  const isArabic = taskKind === 'arabic_explanation';
  const isCode = taskKind === 'code_edit' || taskKind === 'debug_error' || taskKind === 'code_explain';
  const isResearch = taskKind === 'web_research';

  if (isArabic) {
    if (config.apiKeys.gemini) add('gemini', PROVIDER_DEFAULTS.gemini.model);
    if (config.apiKeys.deepseek) add('deepseek', PROVIDER_DEFAULTS.deepseek.model);
    if (config.apiKeys.groq) add('groq', PROVIDER_DEFAULTS.groq.model);
    if (config.apiKeys.openrouter) add('openrouter', 'qwen/qwen3-coder:free');
  } else if (isCode) {
    if (config.apiKeys.deepseek) add('deepseek', PROVIDER_DEFAULTS.deepseek.model);
    if (config.apiKeys.openrouter) add('openrouter', 'deepseek/deepseek-chat:free');
    if (config.apiKeys.groq) add('groq', PROVIDER_DEFAULTS.groq.model);
    if (config.apiKeys.gemini) add('gemini', PROVIDER_DEFAULTS.gemini.model);
    if (config.apiKeys.opencode_zen) add('opencode_zen', PROVIDER_DEFAULTS.opencode_zen.model);
  } else if (isResearch) {
    if (config.apiKeys.gemini) add('gemini', PROVIDER_DEFAULTS.gemini.model);
    if (config.apiKeys.openrouter) add('openrouter', 'qwen/qwen3-coder:free');
    if (config.apiKeys.deepseek) add('deepseek', PROVIDER_DEFAULTS.deepseek.model);
  } else {
    if (config.apiKeys.openrouter) add('openrouter', 'qwen/qwen3-coder:free');
    if (config.apiKeys.gemini) add('gemini', PROVIDER_DEFAULTS.gemini.model);
    if (config.apiKeys.deepseek) add('deepseek', PROVIDER_DEFAULTS.deepseek.model);
    if (config.apiKeys.groq) add('groq', PROVIDER_DEFAULTS.groq.model);
    if (config.apiKeys.opencode_zen) add('opencode_zen', PROVIDER_DEFAULTS.opencode_zen.model);
  }

  // Tier 4: anthropic_proxy if configured
  if (config.anthropicProxyBaseUrl) {
    add('anthropic_proxy', config.anthropicProxyModel || PROVIDER_DEFAULTS.anthropic_proxy.model);
  }

  return candidates;
}

function shouldSkipCandidate(provider: ProviderType, model: string): boolean {
  if (provider !== 'ninerouter' && isProviderOnCooldown(provider)) return true;
  if (isOnCooldown(provider, model)) return true;
  const rec = getHealthRecord(provider, model);
  if (rec && rec.status === 'unhealthy') {
    const permanent = rec.category === 'invalid_key' || rec.category === 'quota';
    if (permanent) return true;
  }
  return false;
}

export interface RoutedClientResult {
  client: AIClient | null;
  provider: string;
  model: string;
  label: string;
  fallbackEvents: string[];
}

export async function routeVia9Router(
  config: HysaConfig,
  taskKind: OrchestrationTaskKind,
  signal?: AbortSignal,
): Promise<RoutedClientResult> {
  clearRequestSkips();
  clearFallbackEvents();

  const candidates = buildFallbackCandidates(taskKind, config);
  const fallbackEvents: string[] = [];
  const usedProviders = new Set<string>();

  for (let i = 0; i < Math.min(candidates.length, MAX_FALLBACK_ATTEMPTS); i++) {
    const cand = candidates[i];
    if (shouldSkipCandidate(cand.provider, cand.model)) {
      fallbackEvents.push(`Skipped ${cand.label} (on cooldown/unhealthy)`);
      continue;
    }

    if (usedProviders.has(cand.provider)) continue;
    usedProviders.add(cand.provider);

    try {
      const client = createSingleClient(
        cand.provider,
        cand.model,
        config.apiKeys,
        config.ollamaBaseUrl,
        config.localOpenAiBaseUrl,
        config.localOpenAiModel,
        config,
      );
      if (client) {
        return {
          client,
          provider: cand.provider,
          model: cand.model,
          label: cand.label,
          fallbackEvents,
        };
      }
    } catch (err) {
      const msg = (err as Error).message || '';
      const cat = classifyNinerouterFailure(msg);
      fallbackEvents.push(`${cand.label}: ${cat}`);
    }
  }

  return { client: null, provider: '', model: '', label: '', fallbackEvents };
}

export async function sendVia9Router(
  config: HysaConfig,
  taskKind: OrchestrationTaskKind,
  messages: Message[],
  systemPrompt: string,
  signal?: AbortSignal,
): Promise<{ response: AIResponse | null; provider: string; model: string; fallbackEvents: string[] }> {
  const routed = await routeVia9Router(config, taskKind, signal);
  if (!routed.client) {
    return { response: null, provider: '', model: '', fallbackEvents: routed.fallbackEvents };
  }

  try {
    const response = await routed.client.sendMessage(messages, systemPrompt, signal);
    setLastSuccessfulProvider(routed.provider, routed.model);
    return {
      response,
      provider: routed.provider,
      model: routed.model,
      fallbackEvents: routed.fallbackEvents,
    };
  } catch (err) {
    const msg = (err as Error).message || '';
    routed.fallbackEvents.push(`${routed.label}: ${msg.slice(0, 100)}`);
    const cat = (classifyNinerouterFailure(msg) as ErrorCategory);
    markModelCooldown(routed.provider, routed.model, cat === 'rate_limit' ? 'rate_limit' : 'model_unavailable', cat === 'rate_limit' ? 120 : 60, cat);

    // Retry with next candidate
    const remaining = buildFallbackCandidates(taskKind, config)
      .filter(c => !shouldSkipCandidate(c.provider, c.model) && c.provider !== routed.provider);

    for (const cand of remaining) {
      try {
        const client = createSingleClient(
          cand.provider,
          cand.model,
          config.apiKeys,
          config.ollamaBaseUrl,
          config.localOpenAiBaseUrl,
          config.localOpenAiModel,
          config,
        );
        if (!client) continue;
        const response = await client.sendMessage(messages, systemPrompt, signal);
        setLastSuccessfulProvider(cand.provider, cand.model);
        return {
          response,
          provider: cand.provider,
          model: cand.model,
          fallbackEvents: routed.fallbackEvents,
        };
      } catch {
        routed.fallbackEvents.push(`Fallback ${cand.label} failed`);
      }
    }

    return { response: null, provider: '', model: '', fallbackEvents: routed.fallbackEvents };
  }
}
