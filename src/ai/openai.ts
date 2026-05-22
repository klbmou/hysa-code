import OpenAI from 'openai';
import type { AIClient, Message, AIResponse } from './types.js';
import { parseToolCalls, stripToolCallBlocks } from './tools.js';

export function createOpenAIClient(apiKey: string, model: string): AIClient {
  const client = new OpenAI({ apiKey, timeout: 30000, maxRetries: 0 });

  return {
    async sendMessage(messages: Message[], systemPrompt: string, signal?: AbortSignal): Promise<AIResponse> {
      const response = await client.chat.completions.create(
        {
          model,
          max_tokens: 4096,
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages.map(m => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content })),
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
