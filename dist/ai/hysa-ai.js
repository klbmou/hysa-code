import { createOpenAICompatibleClient } from './openai-compatible.js';
export function createHysaAIClient(apiKey, model, baseUrl) {
    return createOpenAICompatibleClient(baseUrl, apiKey || 'hysa_dev_key', model);
}
//# sourceMappingURL=hysa-ai.js.map