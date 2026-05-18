import { createOpenAICompatibleClient } from './openai-compatible.js';
import type { AIClient } from './types.js';

export function createHysaAIClient(apiKey: string | undefined, model: string, baseUrl: string): AIClient {
  return createOpenAICompatibleClient(baseUrl, apiKey || 'hysa_dev_key', model);
}
