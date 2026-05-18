import type { AIClient, Message, AIResponse } from './types.js';
import type { ProviderType, HysaConfig } from '../config/keys.js';
import { PROVIDER_DEFAULTS, PROVIDER_MODELS, PROVIDER_TIERS, FREE_API_PROVIDERS, PREMIUM_API_PROVIDERS, PROVIDER_SIGNUP_URLS, EXPERIMENTAL_BASE_URLS } from '../config/keys.js';
import { createAnthropicClient } from './anthropic.js';
import { createOpenAIClient } from './openai.js';
import { createGeminiClient } from './gemini.js';
import { createOllamaClient } from './ollama.js';
import { createOpenRouterClient } from './openrouter.js';
import { createGroqClient } from './groq.js';
import { createDeepSeekClient } from './deepseek.js';
import { createOpenAICompatibleClient } from './openai-compatible.js';
import { createOpenCodeZenClient } from './opencode-zen.js';
import { createHysaAIClient } from './hysa-ai.js';
import { markWeakForTools, markUnhealthy, isUnhealthy, getPreferredModel } from './model-health.js';

const CHAT_TIMEOUT_MS = 45000;
const FALLBACK_ATTEMPT_TIMEOUT_MS = 30000;
const MAX_TOTAL_TIME_MS = 90000;
const MAX_FALLBACK_ATTEMPTS = 3;

const OPENROUTER_FREE_FALLBACK_MODELS = [
  'qwen/qwen3-coder:free',
  'deepseek/deepseek-chat:free',
  'meta-llama/llama-3.1-8b-instruct:free',
];

function extractDebugInfo(err: unknown, provider: ProviderType, model: string, config: HysaConfig, elapsed?: string, timeoutMs?: number, attempt?: number): string {
  const lines: string[] = [];
  lines.push(`  Provider: ${provider}`);
  lines.push(`  Model: ${model}`);
  if (elapsed) lines.push(`  Elapsed: ${elapsed}s`);
  if (timeoutMs) lines.push(`  Timeout: ${timeoutMs / 1000}s`);
  if (attempt !== undefined) lines.push(`  Attempt: ${attempt}`);
  lines.push(`  API key set: ${config.apiKeys[provider as keyof typeof config.apiKeys] ? 'yes' : 'no'}`);

  if (provider === 'openrouter') {
    lines.push(`  Base URL: https://openrouter.ai/api/v1`);
  } else if (EXPERIMENTAL_BASE_URLS[provider]) {
    lines.push(`  Base URL: ${EXPERIMENTAL_BASE_URLS[provider] || 'default'}`);
  }

  const e = err as { status?: number; message?: string; response?: { status?: number; data?: unknown } };
  if (e.status) lines.push(`  HTTP Status: ${e.status}`);
  if (e.response?.status) lines.push(`  HTTP Status: ${e.response.status}`);
  if (e.message) {
    const statusMatch = e.message.match(/(\d{3})/);
    if (statusMatch && !e.status && !e.response?.status) lines.push(`  HTTP Status: ${statusMatch[1]}`);
    lines.push(`  Error: ${e.message.slice(0, 500)}`);
  }
  if (e.response?.data) {
    const body = typeof e.response.data === 'string' ? e.response.data : JSON.stringify(e.response.data);
    lines.push(`  Body: ${body.slice(0, 300)}`);
  }

  return lines.join('\n');
}

function friendlyError(msg: string, provider: ProviderType): string {
  const lower = msg.toLowerCase();

  if (lower.includes('timed out') || lower.includes('timeout') || lower.includes('abort')) {
    const label = PROVIDER_DEFAULTS[provider]?.label || provider;
    return `${label} timed out after ${CHAT_TIMEOUT_MS / 1000}s. Try /model or run hysa doctor.`;
  }

  if (lower.includes('429') || lower.includes('too many requests') || lower.includes('rate limit') || lower.includes('quota')) {
    if (provider === 'gemini') return 'Gemini free tier quota exceeded. Daily limit may have been reached.';
    if (provider === 'opencode_zen') return 'OpenCode Zen free model is rate limited or temporarily unavailable. Try again or use /model.';
    if (provider === 'openrouter') return 'OpenRouter rate limit hit. Some free models have strict limits. Try /model and select a different model.';
    return `${PROVIDER_DEFAULTS[provider]?.label || provider} is rate limited. Try again later or use /model to switch.`;
  }

  if (lower.includes('503') || lower.includes('service unavailable') || lower.includes('overloaded') || lower.includes('overload')) {
    if (provider === 'gemini') return 'Gemini free tier is temporarily overloaded (503). Try again in a moment.';
    if (provider === 'openrouter') return 'OpenRouter is temporarily overloaded. Try again or use /model to switch.';
    return `${PROVIDER_DEFAULTS[provider]?.label || provider} is temporarily unavailable. Try again or use /model.`;
  }

  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('forbidden') || lower.includes('api key')) {
    if (provider === 'opencode_zen') return 'OpenCode Zen requires an API key. Get one from https://opencode.ai/zen';
    if (provider === 'openrouter') {
      return `OpenRouter API key is invalid or missing. Get a key: ${PROVIDER_SIGNUP_URLS.openrouter}`;
    }
    const url = PROVIDER_SIGNUP_URLS[provider];
    const keyHint = url ? `\n  Get a key: ${url}` : '';
    return `${PROVIDER_DEFAULTS[provider]?.label || provider} API key is invalid or missing.${keyHint}`;
  }

  if (lower.includes('402')) {
    if (provider === 'openrouter') return 'OpenRouter requires credits or a paid plan for this model. Try /model and select openrouter/free.';
  }

  if (lower.includes('404') || (lower.includes('model not found') || lower.includes('not found') && lower.includes('model')) || lower.includes('model') && lower.includes('unavailable') || lower.includes('no free') || lower.includes('not supported')) {
    if (provider === 'opencode_zen') return 'This Zen model may no longer be free or available. Try /model to switch models.';
    if (provider === 'openrouter') {
      const alt = OPENROUTER_FREE_FALLBACK_MODELS.slice(0, 2).join(' or ');
      return `This OpenRouter model may be unavailable. Try ${alt}.`;
    }
    return `Model not found for ${PROVIDER_DEFAULTS[provider]?.label || provider}. Try a different model with /model.`;
  }

  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('econnrefused') || lower.includes('econnreset') || lower.includes('fetch failed') || lower.includes('network')) {
    if (provider === 'ollama' || provider === 'local_openai') {
      return `${PROVIDER_DEFAULTS[provider]?.label || provider} is not running. Make sure the local server is started.`;
    }
    if (provider === 'openrouter') return 'Cannot reach OpenRouter. Check your internet connection or try again.';
    return `Cannot reach ${PROVIDER_DEFAULTS[provider]?.label || provider}. Check your internet connection.`;
  }

  if (lower.includes('internal server') || lower.includes('500') || lower.includes('502') || lower.includes('503')) {
    if (provider === 'openrouter') return 'OpenRouter returned a server error. The provider may be overloaded. Try again later.';
    return `${PROVIDER_DEFAULTS[provider]?.label || provider} returned an internal server error. Try again later.`;
  }

  return msg;
}

function isRetryableError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes('429') ||
    lower.includes('rate limit') ||
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('econnrefused') ||
    lower.includes('econnreset') ||
    lower.includes('503') ||
    lower.includes('service unavailable') ||
    lower.includes('too many requests') ||
    lower.includes('overloaded') ||
    lower.includes('quota')
  );
}

function tryCreateClient(provider: ProviderType, model: string, apiKeys: HysaConfig['apiKeys'], ollamaBaseUrl: string, localOpenAiBaseUrl?: string, localOpenAiModel?: string): AIClient | null {
  try {
    return createSingleClient(provider, model, apiKeys, ollamaBaseUrl, localOpenAiBaseUrl, localOpenAiModel);
  } catch {
    return null;
  }
}

function createSingleClient(
  provider: ProviderType,
  model: string,
  apiKeys: HysaConfig['apiKeys'],
  ollamaBaseUrl: string,
  localOpenAiBaseUrl?: string,
  localOpenAiModel?: string,
): AIClient {
  switch (provider) {
    case 'anthropic': {
      const key = apiKeys.anthropic;
      if (!key) throw new Error('Anthropic API key not configured. Run: hysa config');
      return createAnthropicClient(key, model);
    }
    case 'openai': {
      const key = apiKeys.openai;
      if (!key) throw new Error('OpenAI API key not configured. Run: hysa config');
      return createOpenAIClient(key, model);
    }
    case 'gemini': {
      const key = apiKeys.gemini;
      if (!key) throw new Error('Gemini API key not configured. Run: hysa config');
      return createGeminiClient(key, model);
    }
    case 'ollama':
      return createOllamaClient(ollamaBaseUrl, model);
    case 'local_openai':
      return createOpenAICompatibleClient(localOpenAiBaseUrl || 'http://localhost:1234/v1', undefined, localOpenAiModel || model);
    case 'openrouter':
      return createOpenRouterClient(apiKeys.openrouter, model);
    case 'groq':
      return createGroqClient(apiKeys.groq, model);
    case 'deepseek':
      return createDeepSeekClient(apiKeys.deepseek, model);
    case 'opencode_zen': {
      if (!apiKeys.opencode_zen) throw new Error('OpenCode Zen requires an API key. Get one from https://opencode.ai/zen');
      return createOpenCodeZenClient(apiKeys.opencode_zen, model);
    }
    case 'pollinations': {
      const baseUrl = EXPERIMENTAL_BASE_URLS.pollinations || 'https://text.pollinations.ai/v1';
      return createOpenAICompatibleClient(baseUrl, apiKeys.pollinations, model);
    }
    case 'llm7': {
      const baseUrl = EXPERIMENTAL_BASE_URLS.llm7 || 'https://api.llm7.io/v1';
      return createOpenAICompatibleClient(baseUrl, apiKeys.llm7, model);
    }
    case 'puter': {
      const baseUrl = EXPERIMENTAL_BASE_URLS.puter || 'https://api.puter.com/v1';
      return createOpenAICompatibleClient(baseUrl, apiKeys.puter, model);
    }
    case 'hysa_ai': {
      return createHysaAIClient(apiKeys.hysa_ai, model, 'http://localhost:3002/v1');
    }
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

function wrapClient(client: AIClient, provider: ProviderType): AIClient {
  return {
    async sendMessage(messages: Message[], systemPrompt: string, signal?: AbortSignal): Promise<AIResponse> {
      try {
        return await client.sendMessage(messages, systemPrompt, signal);
      } catch (err: unknown) {
        const raw = (err as Error).message || String(err);
        throw new Error(friendlyError(raw, provider));
      }
    },
  };
}

function getFallbackProviders(current: ProviderType, config: HysaConfig): ProviderType[] {
  const tier = PROVIDER_TIERS[current];
  const fallbacks: ProviderType[] = [];

  if (tier === 'free_api') {
    for (const p of FREE_API_PROVIDERS) {
      if (p !== current) {
        const key = config.apiKeys[p as keyof typeof config.apiKeys];
        if (key) fallbacks.push(p);
      }
    }
  }

  if (tier !== 'premium_api') {
    for (const p of PREMIUM_API_PROVIDERS) {
      const key = config.apiKeys[p as keyof typeof config.apiKeys];
      if (key) fallbacks.push(p);
    }
  }

  if (tier !== 'local_free') {
    fallbacks.push('ollama');
  }

  return fallbacks;
}

function createFallbackClient(primary: ProviderType, config: HysaConfig): AIClient {
  const fallbackProviders = getFallbackProviders(primary, config);
  const debug = !!config.debug;

  return {
    async sendMessage(messages: Message[], systemPrompt: string, signal?: AbortSignal): Promise<AIResponse> {
      let lastError: Error | null = null;
      let lastProvider = primary;
      const startTime = Date.now();
      let totalAttempts = 0;

      const tryProvider = async (provider: ProviderType, model: string, timeoutMs: number, attemptLabel: string): Promise<AIResponse | null> => {
        const client = tryCreateClient(provider, model, config.apiKeys, config.ollamaBaseUrl, config.localOpenAiBaseUrl, config.localOpenAiModel);
        if (!client) return null;

        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), timeoutMs);
        if (signal) {
          signal.addEventListener('abort', () => { clearTimeout(timer); ac.abort(); }, { once: true });
        }

        const tryOnce = async (): Promise<AIResponse> => {
          totalAttempts++;
          if (debug) {
            console.log(`  [debug] ${attemptLabel}: ${PROVIDER_DEFAULTS[provider]?.label || provider} / ${model} (timeout: ${timeoutMs / 1000}s)`);
          }
          return await client.sendMessage(messages, systemPrompt, ac.signal);
        };

        let retries = 0;
        const maxRetries = 2;
        let attemptStart = Date.now();

        while (retries <= maxRetries) {
          try {
            lastProvider = provider;
            attemptStart = Date.now();
            return await tryOnce();
          } catch (err: unknown) {
            retries++;
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            lastError = err as Error;
            const errMsg = lastError.message || '';

            if (errMsg.toLowerCase().includes('timed out') || errMsg.includes('Abort')) {
              markUnhealthy(provider, model);
            }

            if (debug) {
              console.log(`  [debug] ${attemptLabel} failed (retry ${retries}/${maxRetries}) after ${((Date.now() - attemptStart) / 1000).toFixed(1)}s:`);
              console.log(extractDebugInfo(err, provider, model, config, elapsed, timeoutMs, totalAttempts));
            }

            if (retries <= maxRetries && isRetryableError(errMsg)) {
              const delay = Math.min(1000 * Math.pow(2, retries - 1), 4000);
              if (debug) console.log(`  [debug] Retrying ${attemptLabel} in ${delay}ms...`);
              await new Promise(r => setTimeout(r, delay));
              continue;
            }

            return null;
          } finally {
            clearTimeout(timer);
          }
        }

        return null;
      };

      // Try primary provider with current model
      const primaryModel = config.currentModel;
      if (debug) console.log(`  [debug] Trying primary: ${primary} / ${primaryModel}`);
      let result = await tryProvider(primary, primaryModel, CHAT_TIMEOUT_MS, 'Primary');
      if (result) return result;

      // Check total time
      if (Date.now() - startTime >= MAX_TOTAL_TIME_MS) {
        const label = PROVIDER_DEFAULTS[primary]?.label || primary;
        throw new Error(`${label} is unavailable after ${((Date.now() - startTime) / 1000).toFixed(0)}s. All retries and fallbacks exhausted.\n  Use /model to switch providers manually.`);
      }

      // Model-level fallback: try other models on the same provider
      if (primary === 'openrouter') {
        const triedModels = new Set([primaryModel]);
        const preferred = getPreferredModel(primary, PROVIDER_MODELS.openrouter);
        const orderedModels = preferred !== primaryModel
          ? [preferred, ...PROVIDER_MODELS.openrouter.filter(m => m !== preferred && m !== primaryModel)]
          : PROVIDER_MODELS.openrouter.filter(m => m !== primaryModel);

        for (const altModel of orderedModels) {
          if (triedModels.has(altModel)) continue;
          triedModels.add(altModel);
          if (Date.now() - startTime >= MAX_TOTAL_TIME_MS) break;
          if (isUnhealthy(primary, altModel)) {
            if (debug) console.log(`  [debug] Skipping unhealthy model: ${altModel}`);
            continue;
          }
          if (debug) console.log(`  [debug] Model fallback to ${altModel}`);
          result = await tryProvider(primary, altModel, FALLBACK_ATTEMPT_TIMEOUT_MS, 'Model fallback');
          if (result) {
            const errMsg = lastError ? friendlyError((lastError as Error).message, primary) : null;
            console.log(`  ⚡ Switched temporarily to ${altModel} because ${errMsg || 'the previous model was unavailable'}.`);
            return result;
          }
          markWeakForTools(primary, altModel);
        }
      }

      // Check total time
      if (Date.now() - startTime >= MAX_TOTAL_TIME_MS) {
        const label = PROVIDER_DEFAULTS[primary]?.label || primary;
        throw new Error(`${label} is unavailable after ${((Date.now() - startTime) / 1000).toFixed(0)}s. All retries and fallbacks exhausted.\n  Use /model to switch providers manually.`);
      }

      // Provider-level fallback: try other providers
      let fallbackCount = 0;
      for (const p of fallbackProviders) {
        if (fallbackCount >= MAX_FALLBACK_ATTEMPTS) break;
        if (Date.now() - startTime >= MAX_TOTAL_TIME_MS) break;
        const model = PROVIDER_DEFAULTS[p]?.model || 'default';
        if (debug) console.log(`  [debug] Provider fallback ${fallbackCount + 1}/${MAX_FALLBACK_ATTEMPTS}: ${p} / ${model}`);
        const fbResult = await tryProvider(p, model, FALLBACK_ATTEMPT_TIMEOUT_MS, `Fallback ${fallbackCount + 1}`);
        fallbackCount++;
        if (fbResult) {
          const fbLabel = PROVIDER_DEFAULTS[p]?.label || p;
          const errMsg = lastError ? friendlyError((lastError as Error).message, primary) : null;
          if (errMsg) {
            console.log(`  ⚡ Switched temporarily to ${fbLabel} because ${errMsg}.`);
          } else {
            console.log(`  ⚡ Switched temporarily to ${fbLabel}.`);
          }
          return fbResult;
        }
      }

      const primaryLabel = PROVIDER_DEFAULTS[primary]?.label || primary;
      const errMsg = lastError
        ? friendlyError((lastError as Error).message, primary)
        : `${primaryLabel} is unavailable. No fallback providers configured.`;

      if (debug && lastError) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`  [debug] All providers failed after ${elapsed}s. Last error:`);
        console.log(extractDebugInfo(lastError as Error, primary, primaryModel, config, elapsed, CHAT_TIMEOUT_MS, totalAttempts));
      }

      throw new Error(`${errMsg}\n  Use /model to switch providers manually.`);
    },
  };
}

export function isOnlyGreeting(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  const greetings = ['hi', 'hello', 'hey', 'yo', 'sup', 'hiya', 'howdy', 'greetings', 'salam', 'السلام', 'صباح', 'مساء', 'مرحبا', 'اهلا'];
  return greetings.some(g => trimmed === g || trimmed === `${g}!` || trimmed === `${g},` || trimmed.startsWith(g + ' ') && trimmed.split(/\s+/).length <= 3);
}

function applyGreetingGuard(client: AIClient): AIClient {
  return {
    async sendMessage(messages: Message[], systemPrompt: string, signal?: AbortSignal): Promise<AIResponse> {
      const result = await client.sendMessage(messages, systemPrompt, signal);
      const lastUser = [...messages].reverse().find(m => m.role === 'user');
      if (lastUser && isOnlyGreeting(lastUser.content)) {
        const hasReadFile = result.toolCalls?.some(tc => tc.type === 'read_file');
        if (hasReadFile) {
          return { message: 'Hi! How can I help with this project?', toolCalls: [] };
        }
      }
      return result;
    },
  };
}

export function createClient(config: HysaConfig, signal?: AbortSignal): AIClient {
  const { currentProvider: provider } = config;
  const tier = PROVIDER_TIERS[provider];

  if (tier === 'free_api' || tier === 'premium_api') {
    return applyGreetingGuard(createFallbackClient(provider, config));
  }

  const client = createSingleClient(provider, config.currentModel, config.apiKeys, config.ollamaBaseUrl, config.localOpenAiBaseUrl, config.localOpenAiModel);
  const wrapped: AIClient = {
    async sendMessage(messages: Message[], systemPrompt: string): Promise<AIResponse> {
      return client.sendMessage(messages, systemPrompt, signal);
    },
  };
  const finalClient = tier === 'experimental_free' ? wrapClient(wrapped, provider) : wrapped;
  return applyGreetingGuard(finalClient);
}

export type { AIClient } from './types.js';
export type { Message, ToolCall, AIResponse } from './types.js';
