import { createOpenAICompatibleClient, checkOpenAICompatibleAPI } from './openai-compatible.js';
const BASE_URL = 'https://opencode.ai/zen/v1';
export function createOpenCodeZenClient(apiKey, model) {
    return createOpenAICompatibleClient(BASE_URL, apiKey, model);
}
export async function checkOpenCodeZenAPI(apiKey) {
    return checkOpenAICompatibleAPI(BASE_URL, apiKey);
}
//# sourceMappingURL=opencode-zen.js.map