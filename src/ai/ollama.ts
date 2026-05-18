import type { AIClient, Message, AIResponse } from './types.js';
import { parseToolCalls, stripToolCallBlocks } from './tools.js';

export async function checkOllama(baseUrl: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) {
      return { ok: false, message: `Ollama returned status ${res.status}` };
    }
    return { ok: true, message: '' };
  } catch {
    return {
      ok: false,
      message: 'Ollama is not running. Install it from https://ollama.com and run: ollama run qwen2.5-coder',
    };
  }
}

export function createOllamaClient(baseUrl: string, model: string): AIClient {
  return {
    async sendMessage(messages: Message[], systemPrompt: string, signal?: AbortSignal): Promise<AIResponse> {
      const ollamaMessages = [
        { role: 'system', content: systemPrompt },
        ...messages.map(m => ({ role: m.role, content: m.content })),
      ];

      const res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: ollamaMessages,
          stream: false,
          options: { num_predict: 4096 },
        }),
        signal: signal || AbortSignal.timeout(45000),
      });

      if (res.status === 404) {
        throw new Error(`Model "${model}" not found. Run: ollama pull ${model}`);
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Ollama error (${res.status}): ${text || res.statusText}`);
      }

      const data = await res.json() as { message?: { content?: string } };
      const content = data.message?.content || '';

      return {
        message: stripToolCallBlocks(content),
        toolCalls: parseToolCalls(content),
      };
    },
  };
}
