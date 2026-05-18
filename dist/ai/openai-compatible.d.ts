import type { AIClient } from './types.js';
export declare function createOpenAICompatibleClient(baseURL: string, apiKey: string | undefined, model: string, defaultHeaders?: Record<string, string>, timeoutMs?: number): AIClient;
export declare function checkOpenAICompatibleAPI(baseURL: string, apiKey?: string): Promise<{
    ok: boolean;
    message: string;
}>;
//# sourceMappingURL=openai-compatible.d.ts.map