import { GoogleGenerativeAI } from '@google/generative-ai';
import type { AIClient, Message, AIResponse } from './types.js';
import { parseToolCalls, stripToolCallBlocks } from './tools.js';

function toGeminiRole(role: 'user' | 'assistant'): string {
  return role === 'assistant' ? 'model' : 'user';
}

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

export function createGeminiClient(apiKey: string, model: string): AIClient {
  const genAI = new GoogleGenerativeAI(apiKey);

  return {
    async sendMessage(messages: Message[], systemPrompt: string, signal?: AbortSignal): Promise<AIResponse> {
      const geminiModel = genAI.getGenerativeModel({ model });

      const history = messages.slice(0, -1).map(m => ({
        role: toGeminiRole(m.role),
        parts: [{ text: m.content }],
      }));

      const lastMessage = messages[messages.length - 1];

      let content: string;

      if (messages.length === 1) {
        const result = await withTimeout(
          geminiModel.generateContent({
            contents: [{ role: 'user', parts: [{ text: lastMessage.content }] }],
            systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
          }),
          45000,
          signal,
        );
        content = result.response.text();
      } else {
        const chat = geminiModel.startChat({
          history,
          systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
        });
        const result = await withTimeout(
          chat.sendMessage(lastMessage.content),
          45000,
          signal,
        );
        content = result.response.text();
      }

      return {
        message: stripToolCallBlocks(content),
        toolCalls: parseToolCalls(content),
      };
    },
  };
}
