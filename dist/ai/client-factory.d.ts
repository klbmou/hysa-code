import type { AIClient } from './types.js';
import type { ProviderType, HysaConfig } from '../config/keys.js';
export declare function createSingleClient(provider: ProviderType, model: string, apiKeys: HysaConfig['apiKeys'], ollamaBaseUrl: string, localOpenAiBaseUrl?: string, localOpenAiModel?: string, config?: HysaConfig): AIClient;
//# sourceMappingURL=client-factory.d.ts.map