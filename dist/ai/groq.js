import { createOpenAICompatibleClient, checkOpenAICompatibleAPI } from './openai-compatible.js';
const BASE_URL = 'https://api.groq.com/openai/v1';
export function createGroqClient(apiKey, model) {
    return createOpenAICompatibleClient(BASE_URL, apiKey, model);
}
export async function checkGroq(apiKey) {
    return checkOpenAICompatibleAPI(BASE_URL, apiKey);
}
//# sourceMappingURL=groq.js.map