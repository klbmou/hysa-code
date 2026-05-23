export type ErrorCategory = 'rate_limit' | 'quota' | 'timeout' | 'network' | 'invalid_key' | 'model_unavailable' | 'unknown';
export interface FallbackEvent {
    provider: string;
    model: string;
    reason: string;
    timestamp: number;
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
    averageResponseTimeMs?: number;
    requestCount: number;
    totalResponseTimeMs: number;
}
interface LastErrorInfo {
    provider: string;
    model: string;
    category: ErrorCategory;
    reason: string;
    timestamp: number;
}
import type { ProviderHealthEntry } from '../utils/session.js';
declare function key(provider: string, model: string): string;
export declare function markHealth(provider: string, model: string, status: 'healthy' | 'unhealthy', reason: string, category?: ErrorCategory, responseTimeMs?: number): void;
export declare function isUnhealthy(provider: string, model: string): boolean;
export declare function isSkippedForRequest(provider: string, model: string): boolean;
export declare function getHealthRecord(provider: string, model: string): ProviderHealthRecord | null;
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
export declare function resetHealth(): void;
export declare function toHealthSummary(): string[];
export declare function toHealthEntries(): ProviderHealthEntry[];
export declare function loadHealthFromEntries(entries: ProviderHealthEntry[]): void;
export { key as healthKey };
//# sourceMappingURL=model-health.d.ts.map