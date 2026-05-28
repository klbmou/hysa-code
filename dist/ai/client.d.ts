import type { AIClient, Message } from './types.js';
import type { ProviderType, HysaConfig } from '../config/keys.js';
import type { ErrorCategory } from './model-health.js';
export declare function setMessagesForTimeout(messages: Message[]): void;
export declare function categorizeError(msg: string): ErrorCategory;
interface FallbackCandidate {
    provider: ProviderType;
    model: string;
    label: string;
}
export declare function getFallbackCandidates(current: ProviderType, config: HysaConfig): FallbackCandidate[];
export declare function createClient(config: HysaConfig, signal?: AbortSignal): AIClient;
export { createSingleClient } from './client-factory.js';
export type { AIClient } from './types.js';
export type { Message, ToolCall, AIResponse } from './types.js';
//# sourceMappingURL=client.d.ts.map