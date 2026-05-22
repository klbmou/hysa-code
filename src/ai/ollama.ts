import type { AIClient, Message, AIResponse, StreamEvent } from './types.js';
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
  const buildMessages = (messages: Message[], systemPrompt: string) => [
    { role: 'system', content: systemPrompt },
    ...messages.map(m => ({ role: m.role, content: m.content })),
  ];

  const handleResponse = (content: string): AIResponse => ({
    message: stripToolCallBlocks(content),
    toolCalls: parseToolCalls(content),
  });

  return {
    async sendMessage(messages: Message[], systemPrompt: string, signal?: AbortSignal): Promise<AIResponse> {
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: buildMessages(messages, systemPrompt),
          stream: false,
          options: { num_predict: 4096 },
        }),
        signal: signal || AbortSignal.timeout(30000),
      });

      if (res.status === 404) {
        throw new Error(`Model "${model}" not found. Run: ollama pull ${model}`);
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Ollama error (${res.status}): ${text || res.statusText}`);
      }

      const data = await res.json() as { message?: { content?: string } };
      return handleResponse(data.message?.content || '');
    },

    async sendMessageStream(messages: Message[], systemPrompt: string, onEvent: (event: StreamEvent) => void, signal?: AbortSignal): Promise<AIResponse> {
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: buildMessages(messages, systemPrompt),
          stream: true,
          options: { num_predict: 4096 },
        }),
        signal: signal || AbortSignal.timeout(30000),
      });

      if (res.status === 404) {
        throw new Error(`Model "${model}" not found. Run: ollama pull ${model}`);
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Ollama error (${res.status}): ${text || res.statusText}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('Ollama: no response body');

      const decoder = new TextDecoder();
      let fullContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const lines = decoder.decode(value, { stream: true }).split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const json = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
            const delta = json.message?.content || '';
            if (delta) {
              fullContent += delta;
              onEvent({ type: 'token', text: delta });
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      }

      return handleResponse(fullContent);
    },
  };
}
