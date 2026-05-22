import Anthropic from '@anthropic-ai/sdk';
import type { AIClient, Message, AIResponse, StreamEvent } from './types.js';
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
         30000,
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

    async sendMessageStream(messages: Message[], systemPrompt: string, onEvent: (event: StreamEvent) => void, signal?: AbortSignal): Promise<AIResponse> {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 30000);
      if (signal) {
        signal.addEventListener('abort', () => { clearTimeout(timer); ac.abort(); }, { once: true });
      }

      const stream = client.messages.stream({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      }, { signal: ac.signal });

      let fullContent = '';
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          const delta = event.delta.text;
          if (delta) {
            fullContent += delta;
            onEvent({ type: 'token', text: delta });
          }
        }
      }
      clearTimeout(timer);

      const toolCalls = parseToolCalls(fullContent);
      const cleanContent = stripToolCallBlocks(fullContent);
      onEvent({ type: 'done', fullText: cleanContent, toolCalls });
      return { message: cleanContent, toolCalls };
    },
  };
}
