import type { AIClient } from './types.js';
export declare function createDeepSeekClient(apiKey: string | undefined, model: string): AIClient;
export declare function checkDeepSeek(apiKey?: string): Promise<{
    ok: boolean;
    message: string;
}>;
//# sourceMappingURL=deepseek.d.ts.map