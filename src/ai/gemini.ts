import { GoogleGenerativeAI } from '@google/generative-ai';
import type { AIClient, Message, AIResponse, StreamEvent } from './types.js';
import { parseToolCalls, stripToolCallBlocks } from './tools.js';

function toGeminiRole(role: 'user' | 'assistant'): string {
  return role === 'assistant' ? 'model' : 'user';
}

function contentToGeminiParts(content: string | any[]): any[] {
  if (typeof content === 'string') {
    return [{ text: content }];
  }
  const parts: any[] = [];
  for (const part of content) {
    if (part.type === 'text') {
      parts.push({ text: part.text });
    } else if (part.type === 'image_url') {
      const dataUrl = part.image_url?.url || '';
      const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
      if (match) {
        parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
      }
    }
  }
  return parts.length > 0 ? parts : [{ text: String(content) }];
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

  const handleContent = (content: string): AIResponse => ({
    message: stripToolCallBlocks(content),
    toolCalls: parseToolCalls(content),
  });

  const buildContents = (messages: Message[], systemPrompt: string) => {
    const history = messages.slice(0, -1).map(m => ({
      role: toGeminiRole(m.role),
      parts: contentToGeminiParts(m.content),
    }));
    const lastMessage = messages[messages.length - 1];
    return { history, lastMessage };
  };

  return {
    async sendMessage(messages: Message[], systemPrompt: string, signal?: AbortSignal): Promise<AIResponse> {
      const geminiModel = genAI.getGenerativeModel({ model });
      const { history, lastMessage } = buildContents(messages, systemPrompt);

      let content: string;

      try {
        if (messages.length === 1) {
          const result = await withTimeout(
            geminiModel.generateContent({
              contents: [{ role: 'user', parts: contentToGeminiParts(lastMessage.content) }],
              systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
            }),
            30000,
            signal,
          );
          content = result.response.text();
        } else {
          const chat = geminiModel.startChat({
            history,
            systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
          });
          const result = await withTimeout(
            chat.sendMessage(contentToGeminiParts(lastMessage.content)),
            30000,
            signal,
          );
          content = result.response.text();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log('[Gemini] Error:', msg.slice(0, 200));
        throw err;
      }

      return handleContent(content);
    },

    async sendMessageStream(messages: Message[], systemPrompt: string, onEvent: (event: StreamEvent) => void, signal?: AbortSignal): Promise<AIResponse> {
      const geminiModel = genAI.getGenerativeModel({ model });
      const { history, lastMessage } = buildContents(messages, systemPrompt);

      let fullContent = '';

      try {
        if (messages.length === 1) {
          const result = await withTimeout(
            geminiModel.generateContentStream({
              contents: [{ role: 'user', parts: contentToGeminiParts(lastMessage.content) }],
              systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
            }),
            30000,
            signal,
          );
          for await (const chunk of result.stream) {
            const delta = chunk.text();
            if (delta) {
              fullContent += delta;
              onEvent({ type: 'token', text: delta });
            }
          }
        } else {
          const chat = geminiModel.startChat({
            history,
            systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
          });
          const result = await withTimeout(
            chat.sendMessageStream(contentToGeminiParts(lastMessage.content)),
            30000,
            signal,
          );
          for await (const chunk of result.stream) {
            const delta = chunk.text();
            if (delta) {
              fullContent += delta;
              onEvent({ type: 'token', text: delta });
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log('[Gemini] Error:', msg.slice(0, 200));
        throw err;
      }

      onEvent({ type: 'done', fullText: stripToolCallBlocks(fullContent), toolCalls: parseToolCalls(fullContent) });
      return handleContent(fullContent);
    },
  };
}
