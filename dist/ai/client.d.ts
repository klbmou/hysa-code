import type { AIClient } from './types.js';
import type { HysaConfig } from '../config/keys.js';
export declare function isOnlyGreeting(text: string): boolean;
export declare function createClient(config: HysaConfig, signal?: AbortSignal): AIClient;
export type { AIClient } from './types.js';
export type { Message, ToolCall, AIResponse } from './types.js';
//# sourceMappingURL=client.d.ts.map