import type { AIClient } from './types.js';
export declare function checkOllama(baseUrl: string): Promise<{
    ok: boolean;
    message: string;
}>;
export declare function listOllamaModels(baseUrl: string, timeoutMs?: number): Promise<string[]>;
export declare function createOllamaClient(baseUrl: string, model: string): AIClient;
//# sourceMappingURL=ollama.d.ts.map