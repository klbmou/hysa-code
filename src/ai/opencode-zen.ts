import { createOpenAICompatibleClient, checkOpenAICompatibleAPI } from './openai-compatible.js';
import type { AIClient } from './types.js';

const BASE_URL = 'https://opencode.ai/zen/v1';

export function createOpenCodeZenClient(apiKey: string, model: string): AIClient {
  return createOpenAICompatibleClient(BASE_URL, apiKey, model);
}

export async function checkOpenCodeZenAPI(apiKey?: string): Promise<{ ok: boolean; message: string }> {
  return checkOpenAICompatibleAPI(BASE_URL, apiKey);
}
