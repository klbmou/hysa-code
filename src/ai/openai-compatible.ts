import OpenAI from 'openai';
import type { AIClient, Message, AIResponse } from './types.js';
import { parseToolCalls, stripToolCallBlocks } from './tools.js';

export function createOpenAICompatibleClient(
  baseURL: string,
  apiKey: string | undefined,
  model: string,
  defaultHeaders?: Record<string, string>,
  timeoutMs = 45000,
): AIClient {
  const client = new OpenAI({
    baseURL,
    apiKey: apiKey || '',
    defaultHeaders,
    timeout: timeoutMs,
    maxRetries: 0,
  });

  return {
    async sendMessage(messages: Message[], systemPrompt: string, signal?: AbortSignal): Promise<AIResponse> {
      const response = await client.chat.completions.create(
        {
          model,
          max_tokens: 4096,
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
          ],
        },
        { signal },
      );

      const content = response.choices[0]?.message?.content || '';

      return {
        message: stripToolCallBlocks(content),
        toolCalls: parseToolCalls(content),
      };
    },
  };
}

const HEALTH_CHECK_TIMEOUT = 5000;

export async function checkOpenAICompatibleAPI(baseURL: string, apiKey?: string): Promise<{ ok: boolean; message: string }> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    const res = await fetch(`${baseURL}/models`, {
      headers,
      signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT),
    });
    if (res.ok || res.status === 401) {
      // 401 means the endpoint is reachable but key might be invalid
      // We treat reachable as healthy for the purpose of connectivity check
      return { ok: true, message: '' };
    }
    return { ok: false, message: `API returned status ${res.status}` };
  } catch (err: unknown) {
    const e = err as Error;
    return { ok: false, message: `Cannot reach API: ${e.message}` };
  }
}
