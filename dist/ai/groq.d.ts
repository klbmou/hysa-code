import type { AIClient } from './types.js';
export declare function createGroqClient(apiKey: string | undefined, model: string): AIClient;
export declare function checkGroq(apiKey?: string): Promise<{
    ok: boolean;
    message: string;
}>;
//# sourceMappingURL=groq.d.ts.map