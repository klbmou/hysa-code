import Anthropic from '@anthropic-ai/sdk';
import type { AIClient, Message, AIResponse } from './types.js';
import { parseToolCalls, stripToolCallBlocks } from './tools.js';

function withTimeout<T>(promise: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Request timed out after ${ms / 1000}s`)), ms);
    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      });
    }
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer!));
}

export function createAnthropicClient(apiKey: string, model: string): AIClient {
  const client = new Anthropic({ apiKey });

  return {
    async sendMessage(messages: Message[], systemPrompt: string, signal?: AbortSignal): Promise<AIResponse> {
      const response = await withTimeout(
        client.messages.create({
          model,
          max_tokens: 4096,
          system: systemPrompt,
          messages: messages.map(m => ({ role: m.role, content: m.content })),
        }),
        45000,
        signal,
      );

      const content = response.content
        .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
        .map(block => block.text)
        .join('\n');

      const toolCalls = parseToolCalls(content);

      return {
        message: stripToolCallBlocks(content),
        toolCalls,
      };
    },
  };
}
