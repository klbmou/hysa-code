import type { ProviderHealthEntry } from '../utils/session.js';
export type ErrorCategory = 'rate_limit' | 'quota' | 'timeout' | 'network' | 'invalid_key' | 'model_unavailable' | 'unknown';
export interface FallbackEvent {
    provider: string;
    model: string;
    reason: string;
    timestamp: number;
}
export interface ProviderAnalytics {
    totalRequests: number;
    totalErrors: number;
    timeoutCount: number;
    rateLimitCount: number;
    recoverySuccessCount: number;
    streamInterruptionCount: number;
    lastLatencyMs: number;
    minLatencyMs: number;
    maxLatencyMs: number;
    totalLatencyMs: number;
    lastRecoveryTime?: number;
}
export interface ProviderHealthRecord {
    status: 'healthy' | 'unhealthy';
    reason: string;
    category: ErrorCategory;
    timestamp: number;
    failedCount: number;
    lastSuccessTime?: number;
    lastFailureTime?: number;
    failureReason?: string;
    rateLimited: boolean;
    timedOut: boolean;
    cooldownUntil?: number;
    cooldownReason?: string;
    averageResponseTimeMs?: number;
    requestCount: number;
    totalResponseTimeMs: number;
    analytics?: ProviderAnalytics;
}
export interface LastErrorInfo {
    provider: string;
    model: string;
    category: ErrorCategory;
    reason: string;
    timestamp: number;
}
export interface CooldownInfo {
    provider: string;
    model: string;
    reason: string;
    category: ErrorCategory;
    cooldownUntil: number;
    remainingMs: number;
}
export interface ProviderCooldownInfo {
    provider: string;
    reason: string;
    category: ErrorCategory;
    timestamp: number;
    cooldownUntil: number;
    remainingMs: number;
    failedCount: number;
}
declare function key(provider: string, model: string): string;
export declare function markHealth(provider: string, model: string, status: 'healthy' | 'unhealthy', reason: string, category?: ErrorCategory, responseTimeMs?: number): void;
export declare function markModelCooldown(provider: string, model: string, reason: string, seconds: number, category?: ErrorCategory): void;
export declare function markProviderCooldown(provider: string, reason: string, seconds: number, category?: ErrorCategory): void;
export declare function isOnCooldown(provider: string, model: string): boolean;
export declare function isProviderOnCooldown(provider: string): boolean;
export declare function getCooldownRemaining(provider: string, model: string): number;
export declare function getProviderCooldownRemaining(provider: string): number;
export declare function clearCooldowns(): void;
export declare function isUnhealthy(provider: string, model: string): boolean;
export declare function isSkippedForRequest(provider: string, model: string): boolean;
export declare function getHealthRecord(provider: string, model: string): ProviderHealthRecord | null;
export declare function getHealthRecordsForProvider(provider: string): ProviderHealthRecord[];
export declare function getHealthForProvider(provider: string): ProviderHealthRecord | null;
export declare function getHealthSummary(provider?: string, model?: string): string;
export declare function getAllHealth(): Map<string, ProviderHealthRecord>;
export declare function getLastError(): LastErrorInfo | null;
export declare function getLastFallbackUsed(): string | null;
export declare function setLastFallbackUsed(fb: string | null): void;
export declare function getLastSuccessfulProvider(): string | null;
export declare function getLastSuccessfulModel(): string | null;
export declare function setLastSuccessfulProvider(provider: string | null, model: string | null): void;
export declare function addFallbackEvent(provider: string, model: string, reason: string): void;
export declare function getFallbackEvents(): FallbackEvent[];
export declare function clearFallbackEvents(): void;
export declare function clearRequestSkips(): void;
export declare function recordRequestLatency(provider: string, model: string, latencyMs: number): void;
export declare function recordErrorAnalytics(provider: string, model: string, category: ErrorCategory): void;
export declare function recordRecoverySuccess(provider: string, model: string): void;
export declare function recordStreamInterruption(provider: string, model: string): void;
export declare function getProviderAnalytics(provider: string, model: string): ProviderAnalytics | null;
export declare function getAllProviderAnalytics(): Map<string, ProviderAnalytics>;
export declare function getTimeoutRate(provider: string, model: string): number;
export declare function getRecoveryRate(provider: string, model: string): number;
export declare function getAverageLatency(provider: string, model: string): number;
export declare function resetHealth(): void;
export declare function toHealthSummary(): string[];
export declare function toHealthEntries(): ProviderHealthEntry[];
export declare function getModelsInCooldown(provider?: string): CooldownInfo[];
export declare function getProviderCooldowns(provider?: string): ProviderCooldownInfo[];
export declare function getRateLimitedModels(provider?: string): ProviderHealthEntry[];
export declare function loadHealthFromEntries(entries: ProviderHealthEntry[]): void;
export { key as healthKey };
//# sourceMappingURL=model-health.d.ts.map