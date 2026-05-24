import type { AgentMode } from '../agent/types.js';
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
export declare const PROVIDER_CATEGORIES: Record<ProviderType, ProviderCategory>;
export declare const PROVIDER_CATEGORY_LABELS: Record<ProviderCategory, string>;
export declare const PROVIDER_DEFAULTS: Record<ProviderType, {
    model: string;
    label: string;
}>;
export declare const PROVIDER_MODELS: Record<ProviderType, string[]>;
export type ProviderTier = 'free_api' | 'local_free' | 'premium_api' | 'experimental_free';
export declare const PROVIDER_TIERS: Record<ProviderType, ProviderTier>;
export declare const TIER_LABELS: Record<ProviderTier, {
    icon: string;
    label: string;
}>;
export declare const PROVIDER_DESCRIPTIONS: Record<ProviderType, string>;
export declare const PROVIDER_SIGNUP_URLS: Record<ProviderType, string>;
export declare const FREE_API_PROVIDERS: ProviderType[];
export declare const PREMIUM_API_PROVIDERS: ProviderType[];
export declare const LOCAL_FREE_PROVIDERS: ProviderType[];
export declare const CLOUD_FREE_PROVIDERS: ProviderType[];
export declare const EXPERIMENTAL_FREE_PROVIDERS: ProviderType[];
export declare const COMPACT_PROMPT_PROVIDERS: ProviderType[];
export declare const EXPERIMENTAL_BASE_URLS: Partial<Record<ProviderType, string>>;
export declare function providerNeedsApiKey(provider: ProviderType): boolean;
export declare function providerHasOptionalApiKey(provider: ProviderType): boolean;
export declare function isLocalFallbackEnabled(config?: Pick<HysaConfig, 'enableLocalFallback'> | null): boolean;
export declare function providerRequiresKey(provider: ProviderType): boolean;
export declare function loadConfig(): HysaConfig | null;
export declare function getDefaultProviderFromEnv(): string | null;
export declare function normalizeApiKey(key: string): string;
export declare function validateApiKey(key: string, provider?: ProviderType): {
    valid: boolean;
    key: string;
    error?: string;
};
export declare function saveConfig(config: HysaConfig): void;
//# sourceMappingURL=keys.d.ts.map