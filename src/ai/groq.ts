import { createOpenAICompatibleClient, checkOpenAICompatibleAPI } from './openai-compatible.js';
import type { AIClient } from './types.js';

const BASE_URL = 'https://api.groq.com/openai/v1';

export function createGroqClient(apiKey: string | undefined, model: string): AIClient {
  return createOpenAICompatibleClient(BASE_URL, apiKey, model);
}

export async function checkGroq(apiKey?: string): Promise<{ ok: boolean; message: string }> {
  return checkOpenAICompatibleAPI(BASE_URL, apiKey);
}
