import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

import type { AgentMode } from '../agent/types.js';

const CONFIG_DIR = join(homedir(), '.hysa');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

export type ProviderType = 'anthropic' | 'openai' | 'gemini' | 'ollama' | 'openrouter' | 'groq' | 'deepseek' | 'local_openai' | 'opencode_zen' | 'pollinations' | 'llm7' | 'puter' | 'hysa_ai' | 'anthropic_proxy' | 'openai_router';

export type ProviderCategory = 'local_free' | 'cloud_free' | 'premium_api' | 'experimental_free';

export interface HysaConfig {
  currentProvider: ProviderType;
  currentModel: string;
  apiKeys: {
    anthropic?: string;
    openai?: string;
    gemini?: string;
    openrouter?: string;
    groq?: string;
    deepseek?: string;
    opencode_zen?: string;
    pollinations?: string;
    llm7?: string;
    puter?: string;
    hysa_ai?: string;
    anthropic_proxy?: string;
    openai_router?: string;
  };
  ollamaBaseUrl: string;
  localOpenAiBaseUrl?: string;
  localOpenAiModel?: string;
  hysaAiBaseUrl?: string;
  anthropicProxyBaseUrl?: string;
  anthropicProxyModel?: string;
  openaiRouterBaseUrl?: string;
  openaiRouterModel?: string;
  allowExperimentalProviders?: boolean;
  experimentalConfirmed?: boolean;
  enableLocalFallback?: boolean;
  agentMode?: AgentMode;
  debug?: boolean;
  lightMode?: boolean;
  promptMode?: 'full' | 'compact' | 'minimal' | 'auto';
}

export const PROVIDER_CATEGORIES: Record<ProviderType, ProviderCategory> = {
  anthropic: 'premium_api',
  openai: 'premium_api',
  gemini: 'cloud_free',
  ollama: 'local_free',
  openrouter: 'cloud_free',
  groq: 'cloud_free',
  deepseek: 'cloud_free',
  local_openai: 'local_free',
  opencode_zen: 'cloud_free',
  pollinations: 'experimental_free',
  llm7: 'experimental_free',
  puter: 'experimental_free',
  hysa_ai: 'local_free',
  anthropic_proxy: 'cloud_free',
  openai_router: 'cloud_free',
};

export const PROVIDER_CATEGORY_LABELS: Record<ProviderCategory, string> = {
  local_free: 'LOCAL FREE',
  cloud_free: 'FREE API KEY',
  premium_api: 'PREMIUM API',
  experimental_free: 'EXPERIMENTAL FREE',
};

export const PROVIDER_DEFAULTS: Record<ProviderType, { model: string; label: string }> = {
  anthropic: { model: 'claude-sonnet-4-20250514', label: 'Anthropic Claude' },
  openai: { model: 'gpt-4o', label: 'OpenAI GPT' },
  gemini: { model: 'gemini-2.5-flash', label: 'Google Gemini' },
  ollama: { model: 'qwen2.5-coder', label: 'Ollama' },
  openrouter: { model: 'qwen/qwen3-coder:free', label: 'OpenRouter' },
  groq: { model: 'llama3-70b-8192', label: 'Groq' },
  deepseek: { model: 'deepseek-chat', label: 'DeepSeek' },
  local_openai: { model: 'local-model', label: 'LM Studio / Local OpenAI' },
  opencode_zen: { model: 'big-pickle', label: 'OpenCode Zen' },
  pollinations: { model: 'openai', label: 'Pollinations AI' },
  llm7: { model: 'qwen2.5-coder-32b-instruct', label: 'LLM7' },
  puter: { model: 'gpt-4o-mini', label: 'Puter AI' },
  hysa_ai: { model: 'hysa-coder-lite', label: 'HYSA AI' },
  anthropic_proxy: { model: 'claude-3-5-sonnet-latest', label: 'Anthropic Proxy' },
  openai_router: { model: 'gpt-4o-mini', label: 'OpenAI Router' },
};

export const PROVIDER_MODELS: Record<ProviderType, string[]> = {
  anthropic: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
  gemini: ['gemini-2.5-flash', 'gemini-1.5-flash'],
  ollama: ['qwen2.5-coder', 'llama3.1', 'deepseek-coder', 'codellama'],
  openrouter: [
    'qwen/qwen3-coder:free',
    'openai/gpt-oss-120b:free',
    'deepseek/deepseek-chat:free',
    'meta-llama/llama-3.1-8b-instruct:free',
    'deepseek/deepseek-chat',
    'z-ai/glm-4.5-air:free',
    'google/gemini-2.5-flash:free',
    'qwen/qwen-2.5-coder-32b-instruct',
    'nvidia/nemotron-nano-12b-v2-vl:free',
    'google/gemini-2.5-flash',
    'openrouter/free',
    'mistralai/mistral-nemo:free',
    'qwen/qwen2.5-vl-72b-instruct:free',
    'qwen/qwen-vl-plus',
  ],
  groq: ['llama3-70b-8192', 'llama3-8b-8192', 'mixtral-8x7b-32768', 'deepseek-r1-distill-llama-70b'],
  deepseek: ['deepseek-chat', 'deepseek-coder'],
  local_openai: ['local-model'],
  opencode_zen: [
    'big-pickle',
    'minimax-m2.5-free',
    'nemotron-3-super-free',
    'mimo-v2-pro-free',
    'mimo-v2-omni-free',
    'glm-4.7-free',
    'kimi-k2.5-free',
  ],
  pollinations: ['openai', 'openai-fast', 'qwen-coder', 'deepseek-v3', 'gemini-2.5-flash-lite'],
  llm7: ['qwen2.5-coder-32b-instruct', 'gpt-4o-mini-2024-07-18', 'deepseek-r1-0528'],
  puter: ['gpt-4o-mini'],
  hysa_ai: ['hysa-coder-lite', 'hysa-coder', 'hysa-fast'],
  anthropic_proxy: ['claude-3-5-sonnet-latest', 'claude-3-opus-latest', 'claude-3-haiku-latest'],
  openai_router: ['qw/qwen3-coder-flash', 'oc/deepseek-v4-flash-free', 'qw/qwen3-coder-plus', 'oc/nemotron-3-super-free', 'deepseek/deepseek-chat', 'openai/gpt-4o-mini', 'cc/claude-sonnet-4-6'],
};

export type ProviderTier = 'free_api' | 'local_free' | 'premium_api' | 'experimental_free';

export const PROVIDER_TIERS: Record<ProviderType, ProviderTier> = {
  anthropic: 'premium_api',
  openai: 'premium_api',
  gemini: 'free_api',
  ollama: 'local_free',
  openrouter: 'free_api',
  groq: 'free_api',
  deepseek: 'free_api',
  local_openai: 'local_free',
  opencode_zen: 'free_api',
  pollinations: 'experimental_free',
  llm7: 'experimental_free',
  puter: 'experimental_free',
  hysa_ai: 'local_free',
  anthropic_proxy: 'free_api',
  openai_router: 'free_api',
};

export const TIER_LABELS: Record<ProviderTier, { icon: string; label: string }> = {
  free_api: { icon: '☁️', label: 'FREE API KEY' },
  local_free: { icon: '🖥️', label: 'LOCAL FREE' },
  premium_api: { icon: '🔑', label: 'PREMIUM API' },
  experimental_free: { icon: '🧪', label: 'EXPERIMENTAL FREE' },
};

export const PROVIDER_DESCRIPTIONS: Record<ProviderType, string> = {
  anthropic: 'Best for complex coding tasks. Paid, usage-based.',
  openai: 'Fast and versatile. Paid, usage-based.',
  gemini: "Google's latest. Free tier available (60 req/min quotas). Paid tier also available.",
  ollama: 'Run models locally. Free, no internet needed. Requires download.',
  local_openai: 'LM Studio / Jan / llama.cpp. OpenAI-compatible local server. No API key.',
  openrouter: 'Gateway to many free + paid models. Requires free API key, no credit card.',
  groq: 'Fast inference on open models. Requires free API key, no credit card.',
  deepseek: 'Strong coding models. Requires free API key, no credit card.',
  opencode_zen: 'Curated free/open models via OpenCode Zen. Some free for limited time. Requires API key.',
  pollinations: '🧪 Experimental: Free text generation. No API key required by default. May log prompts, rate-limit, or disappear.',
  llm7: '🧪 Experimental: Free OpenAI-compatible endpoint. API key optional. Not guaranteed stable.',
  puter: '🧪 Experimental: Web-based AI. May require browser/session. Not suitable for CLI automation.',
  hysa_ai: 'Your own local/free provider. Uses HYSA Provider server, which uses Ollama. No external paid API required.',
  anthropic_proxy: 'Connect to any Anthropic-compatible proxy endpoint. Requires base URL. API key optional.',
  openai_router: 'Connect to any OpenAI-compatible router/proxy (e.g. 9router). Requires base URL. API key optional.',
};

export const PROVIDER_SIGNUP_URLS: Record<ProviderType, string> = {
  anthropic: 'https://console.anthropic.com',
  openai: 'https://platform.openai.com/api-keys',
  gemini: 'https://aistudio.google.com/apikey',
  ollama: 'https://ollama.com',
  local_openai: 'https://lmstudio.ai',
  openrouter: 'https://openrouter.ai/keys',
  groq: 'https://console.groq.com',
  deepseek: 'https://platform.deepseek.com',
  opencode_zen: 'https://opencode.ai/zen',
  pollinations: 'https://pollinations.ai',
  llm7: '',
  puter: 'https://puter.com',
  hysa_ai: '',
  anthropic_proxy: '',
  openai_router: '',
};

export const FREE_API_PROVIDERS: ProviderType[] = ['opencode_zen', 'openrouter', 'groq', 'gemini', 'deepseek', 'anthropic_proxy', 'openai_router'];

export const PREMIUM_API_PROVIDERS: ProviderType[] = ['anthropic', 'openai'];

export const LOCAL_FREE_PROVIDERS: ProviderType[] = ['ollama', 'local_openai', 'hysa_ai'];

export const CLOUD_FREE_PROVIDERS: ProviderType[] = ['opencode_zen', 'openrouter', 'groq', 'deepseek', 'gemini', 'anthropic_proxy', 'openai_router'];

export const EXPERIMENTAL_FREE_PROVIDERS: ProviderType[] = ['pollinations', 'llm7', 'puter'];

export const COMPACT_PROMPT_PROVIDERS: ProviderType[] = ['ollama', 'local_openai', 'hysa_ai', 'pollinations', 'llm7', 'puter'];

export const EXPERIMENTAL_BASE_URLS: Partial<Record<ProviderType, string>> = {
  pollinations: 'https://text.pollinations.ai/v1',
  llm7: '',
  puter: '',
};

export function providerNeedsApiKey(provider: ProviderType): boolean {
  return !providerHasOptionalApiKey(provider) && !isLocalProvider(provider);
}

export function providerHasOptionalApiKey(provider: ProviderType): boolean {
  return provider === 'llm7' || provider === 'pollinations' || provider === 'puter' || provider === 'anthropic_proxy' || provider === 'openai_router';
}

function isLocalProvider(provider: ProviderType): boolean {
  return provider === 'ollama' || provider === 'local_openai' || provider === 'hysa_ai';
}

export function isLocalFallbackEnabled(config?: Pick<HysaConfig, 'enableLocalFallback'> | null): boolean {
  const raw = process.env.HYSA_ENABLE_LOCAL_FALLBACK;
  if (raw !== undefined) {
    return parseBooleanFlag(raw);
  }
  return config?.enableLocalFallback === true;
}

function parseBooleanFlag(value: string): boolean {
  return /^(1|true|yes|on)$/i.test(value.trim());
}

export function providerRequiresKey(provider: ProviderType): boolean {
  return providerNeedsApiKey(provider) && !isLocalProvider(provider);
}

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig(): HysaConfig | null {
  try {
    if (!existsSync(CONFIG_PATH)) return null;
    const data = readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(data);

    // Migrate from v0.1 format: { provider, model, apiKey }
    if (parsed.provider && !parsed.currentProvider) {
      const migrated: HysaConfig = {
        currentProvider: parsed.provider,
        currentModel: parsed.model || PROVIDER_DEFAULTS[parsed.provider as ProviderType]?.model || 'claude-sonnet-4-20250514',
        apiKeys: {},
        ollamaBaseUrl: 'http://localhost:11434',
      };
      if (parsed.apiKey) {
        (migrated.apiKeys as Record<string, string | undefined>)[parsed.provider as string] = parsed.apiKey;
      }
      applyEnvOverrides(migrated);
      saveConfig(migrated);
      return migrated;
    }

    const config = parsed as HysaConfig;
    applyEnvOverrides(config);
    return config;
  } catch {
    return null;
  }
}

/**
 * Merge environment variable overrides into config.
 * Env vars take precedence over config file values.
 */
function applyEnvOverrides(config: HysaConfig): void {
  const baseUrl = process.env.HYSA_ANTHROPIC_PROXY_BASE_URL;
  if (baseUrl) {
    config.anthropicProxyBaseUrl = baseUrl.replace(/\/+$/, '');
  }
  const apiKey = process.env.HYSA_ANTHROPIC_PROXY_API_KEY;
  if (apiKey) {
    config.apiKeys.anthropic_proxy = apiKey.trim();
  }
  const model = process.env.HYSA_ANTHROPIC_PROXY_MODEL;
  if (model) {
    config.anthropicProxyModel = model.trim();
  }
  const routerUrl = process.env.HYSA_OPENAI_ROUTER_BASE_URL;
  if (routerUrl) {
    config.openaiRouterBaseUrl = routerUrl.replace(/\/+$/, '');
  }
  const routerKey = process.env.HYSA_OPENAI_ROUTER_API_KEY;
  if (routerKey) {
    config.apiKeys.openai_router = routerKey.trim();
  }
  const routerModel = process.env.HYSA_OPENAI_ROUTER_MODEL;
  if (routerModel) {
    config.openaiRouterModel = routerModel.trim();
  }
  if (process.env.HYSA_ENABLE_LOCAL_FALLBACK !== undefined) {
    config.enableLocalFallback = isLocalFallbackEnabled(config);
  }
}

export function getDefaultProviderFromEnv(): string | null {
  const fromEnv = process.env.HYSA_DEFAULT_PROVIDER;
  if (fromEnv) return fromEnv;
  if (process.env.HYSA_OPENAI_ROUTER_BASE_URL) return 'openai_router';
  return null;
}

export function normalizeApiKey(key: string): string {
  return key.trim().replace(/^Bearer\s+/i, '');
}

export function validateApiKey(key: string, provider?: ProviderType): { valid: boolean; key: string; error?: string } {
  const cleaned = normalizeApiKey(key);

  if (!cleaned) {
    // Empty key is valid for optional/keyless providers
    if (provider && (providerHasOptionalApiKey(provider) || isLocalProvider(provider))) {
      return { valid: true, key: '' };
    }
    return { valid: false, key: '', error: 'Invalid API key format. Paste the key only, without spaces or extra text.' };
  }

  // Check for non-ASCII characters
  for (let i = 0; i < cleaned.length; i++) {
    if (cleaned.charCodeAt(i) > 127) {
      return { valid: false, key: cleaned, error: 'Invalid API key format. Paste the key only, without spaces or extra text.' };
    }
  }

  // OpenRouter-specific validation
  if (provider === 'openrouter' && !cleaned.startsWith('sk-or-')) {
    return { valid: false, key: cleaned, error: 'OpenRouter keys usually start with sk-or-v1-... Check your key and paste it again.' };
  }

  return { valid: true, key: cleaned };
}

export function saveConfig(config: HysaConfig): void {
  ensureConfigDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}
