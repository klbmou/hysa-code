import type { AIClient } from './types.js';
export declare function createAnthropicProxyClient(baseUrl: string, apiKey: string | undefined, model: string): AIClient;
export declare function checkAnthropicProxyAPI(baseUrl: string, apiKey?: string): Promise<{
    ok: boolean;
    message: string;
}>;
//# sourceMappingURL=anthropic-proxy.d.ts.map