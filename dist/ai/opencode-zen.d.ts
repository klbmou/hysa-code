import type { AIClient } from './types.js';
export declare function createOpenCodeZenClient(apiKey: string, model: string): AIClient;
export declare function checkOpenCodeZenAPI(apiKey?: string): Promise<{
    ok: boolean;
    message: string;
}>;
//# sourceMappingURL=opencode-zen.d.ts.map