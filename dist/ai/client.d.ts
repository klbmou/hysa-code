import type { AIClient } from './types.js';
import type { ProviderType, HysaConfig } from '../config/keys.js';
import type { ErrorCategory } from './model-health.js';
export declare function categorizeError(msg: string): ErrorCategory;
interface FallbackCandidate {
    provider: ProviderType;
    model: string;
    label: string;
}
export declare function getFallbackCandidates(current: ProviderType, config: HysaConfig): FallbackCandidate[];
export declare function createSingleClient(provider: ProviderType, model: string, apiKeys: HysaConfig['apiKeys'], ollamaBaseUrl: string, localOpenAiBaseUrl?: string, localOpenAiModel?: string, config?: HysaConfig): AIClient;
export declare function isOnlyGreeting(text: string): boolean;
export declare function getCasualResponse(text: string): string | null;
export declare function createClient(config: HysaConfig, signal?: AbortSignal): AIClient;
export type { AIClient } from './types.js';
export type { Message, ToolCall, AIResponse } from './types.js';
//# sourceMappingURL=client.d.ts.map