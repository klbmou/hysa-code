import { createOpenAICompatibleClient, checkOpenAICompatibleAPI } from './openai-compatible.js';
import { normalizeApiKey } from '../config/keys.js';
const BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_HEADERS = {
    'HTTP-Referer': 'https://github.com/hysa-code',
    'X-Title': 'HYSA Code',
};
export function createOpenRouterClient(apiKey, model) {
    const cleanKey = apiKey ? normalizeApiKey(apiKey) : apiKey;
    return createOpenAICompatibleClient(BASE_URL, cleanKey, model, OPENROUTER_HEADERS);
}
export async function checkOpenRouter(apiKey) {
    const cleanKey = apiKey ? normalizeApiKey(apiKey) : apiKey;
    return checkOpenAICompatibleAPI(BASE_URL, cleanKey);
}
//# sourceMappingURL=openrouter.js.map