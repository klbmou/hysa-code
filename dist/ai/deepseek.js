import { createOpenAICompatibleClient, checkOpenAICompatibleAPI } from './openai-compatible.js';
const BASE_URL = 'https://api.deepseek.com';
export function createDeepSeekClient(apiKey, model) {
    return createOpenAICompatibleClient(BASE_URL, apiKey, model);
}
export async function checkDeepSeek(apiKey) {
    return checkOpenAICompatibleAPI(BASE_URL, apiKey);
}
//# sourceMappingURL=deepseek.js.map