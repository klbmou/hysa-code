import { createOpenAICompatibleClient, checkOpenAICompatibleAPI } from './openai-compatible.js';
import { normalizeApiKey } from '../config/keys.js';
import type { AIClient } from './types.js';

const BASE_URL = 'https://openrouter.ai/api/v1';

const OPENROUTER_HEADERS: Record<string, string> = {
  'HTTP-Referer': 'https://github.com/hysa-code',
  'X-Title': 'HYSA Code',
};

export function createOpenRouterClient(apiKey: string | undefined, model: string): AIClient {
  const cleanKey = apiKey ? normalizeApiKey(apiKey) : apiKey;
  return createOpenAICompatibleClient(BASE_URL, cleanKey, model, OPENROUTER_HEADERS);
}

export async function checkOpenRouter(apiKey?: string): Promise<{ ok: boolean; message: string }> {
  const cleanKey = apiKey ? normalizeApiKey(apiKey) : apiKey;
  return checkOpenAICompatibleAPI(BASE_URL, cleanKey);
}
