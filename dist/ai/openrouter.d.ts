import type { AIClient } from './types.js';
export declare function createOpenRouterClient(apiKey: string | undefined, model: string): AIClient;
export declare function checkOpenRouter(apiKey?: string): Promise<{
    ok: boolean;
    message: string;
}>;
//# sourceMappingURL=openrouter.d.ts.map