import OpenAI from 'openai';
import type { AIClient, Message, AIResponse, StreamEvent } from './types.js';
import { parseToolCalls, stripToolCallBlocks } from './tools.js';

function extractContentFromResponse(response: unknown): string {
  const resp = response as Record<string, any>;
  const choice = resp.choices?.[0];
  if (choice) {
    if (typeof choice.message?.content === 'string') return choice.message.content;
    if (typeof choice.text === 'string') return choice.text;
  }
  if (typeof resp.output_text === 'string') return resp.output_text;
  if (typeof resp.response === 'string') return resp.response;
  if (typeof resp.message === 'string') return resp.message;
  if (typeof resp.content === 'string') return resp.content;
  if (typeof resp.text === 'string') return resp.text;
  return '';
}

export function createOpenAICompatibleClient(
  baseURL: string,
  apiKey: string | undefined,
  model: string,
  defaultHeaders?: Record<string, string>,
  timeoutMs = 30000,
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

      const content = extractContentFromResponse(response);

      return {
        message: stripToolCallBlocks(content),
        toolCalls: parseToolCalls(content),
      };
    },

    async sendMessageStream(messages: Message[], systemPrompt: string, onEvent: (event: StreamEvent) => void, signal?: AbortSignal): Promise<AIResponse> {
      const stream = await client.chat.completions.create(
        {
          model,
          max_tokens: 4096,
          stream: true,
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
          ],
        },
        { signal },
      );

      let fullContent = '';
      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta?.content || '';
        if (delta) {
          fullContent += delta;
          onEvent({ type: 'token', text: delta });
        }
      }

      const toolCalls = parseToolCalls(fullContent);
      const cleanContent = stripToolCallBlocks(fullContent);
      onEvent({ type: 'done', fullText: cleanContent, toolCalls });
      return { message: cleanContent, toolCalls };
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
