import { createOpenAICompatibleClient, checkOpenAICompatibleAPI } from './openai-compatible.js';
import type { AIClient } from './types.js';

const BASE_URL = 'https://api.deepseek.com';

export function createDeepSeekClient(apiKey: string | undefined, model: string): AIClient {
  return createOpenAICompatibleClient(BASE_URL, apiKey, model);
}

export async function checkDeepSeek(apiKey?: string): Promise<{ ok: boolean; message: string }> {
  return checkOpenAICompatibleAPI(BASE_URL, apiKey);
}
