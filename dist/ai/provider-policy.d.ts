/**
 * Provider selection policy.
 *
 * Reachability is not enough: a provider is usable only when it is configured,
 * not in provider cooldown, and has at least one model that is not cooling down
 * or marked unhealthy.
 */
import type { ProviderType, HysaConfig } from '../config/keys.js';
import type { TaskKind } from './task-classifier.js';
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
export declare function getProviderTier(provider: string): ProviderTier;
export declare function isRateLimitError(error: string | Error | unknown): boolean;
export declare function isTimeoutError(error: string | Error | unknown): boolean;
export declare function isNetworkError(error: string | Error | unknown): boolean;
export declare function getRetryAfterSeconds(error: unknown): number | null;
export declare function getProviderModelsFromRegistry(runtimeModels?: RuntimeProviderModels): Map<string, string[]>;
export declare function getProviderModels(provider: string, runtimeModels?: RuntimeProviderModels): string[];
export declare function providerIsConfigured(provider: string, config: HysaConfig): boolean;
export declare function isProviderUsable(provider: string, config: HysaConfig, runtimeModels?: RuntimeProviderModels, healthChecker?: {
    isOnCooldown: (p: string, m: string) => boolean;
    isUnhealthy: (p: string, m: string) => boolean;
}): boolean;
export declare function getProviderUsability(provider: ProviderType, config: HysaConfig, runtimeModels?: RuntimeProviderModels, healthChecker?: {
    isOnCooldown: (p: string, m: string) => boolean;
    isUnhealthy: (p: string, m: string) => boolean;
}): ProviderUsability;
export declare function getProviderRateLimitedModelCount(provider: string, runtimeModels?: RuntimeProviderModels): number;
export declare function shouldInjectProjectContext(message: string, taskKind: TaskKind): boolean;
export declare function getBestProviderForTask(taskKind: TaskKind, config: HysaConfig, runtimeModels?: RuntimeProviderModels): ProviderType | null;
export declare function getProviderPreferenceForTask(taskKind: TaskKind, input?: HysaConfig | ProviderType): ProviderType[];
export declare function didProviderFailWithCategory(provider: string, category: string, runtimeModels?: RuntimeProviderModels): boolean;
export declare function getAvailableFallbackProviders(config: HysaConfig, runtimeModels?: RuntimeProviderModels): ProviderUsability[];
export declare function getSuggestedFallbackAction(provider: string, config: HysaConfig, lastError?: string, runtimeModels?: RuntimeProviderModels): string;
//# sourceMappingURL=provider-policy.d.ts.map