import type { AIClient, Message, AIResponse, StreamEvent } from './types.js';
import { parseToolCalls, stripToolCallBlocks } from './tools.js';

const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_TIMEOUT_MS = 30000;

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AnthropicResponse {
  id?: string;
  type?: string;
  role?: string;
  content: { type: string; text?: string }[];
  stop_reason?: string;
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

function buildRequestBody(messages: Message[], systemPrompt: string, model: string, stream: boolean): Record<string, unknown> {
  const anthropicMessages: AnthropicMessage[] = messages.map(m => ({
    role: m.role,
    content: m.content,
  }));
  const body: Record<string, unknown> = {
    model,
    max_tokens: 4096,
    messages: anthropicMessages,
    stream,
  };
  if (systemPrompt) {
    body.system = systemPrompt;
  }
  return body;
}

async function parseResponse(response: Response): Promise<AnthropicResponse> {
  const text = await response.text();
  if (!response.ok) {
    let detail = '';
    try {
      const parsed = JSON.parse(text);
      detail = parsed.error?.message || parsed.error || JSON.stringify(parsed).slice(0, 200);
    } catch {
      detail = text.slice(0, 200);
    }
    throw new Error(`Anthropic proxy error (${response.status}): ${detail}`);
  }
  return JSON.parse(text) as AnthropicResponse;
}

async function* streamResponse(response: Response): AsyncGenerator<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Response body is not readable');
  }
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6).trim();
        if (data === '[DONE]') return;
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }
        if (parsed.type === 'content_block_delta' && (parsed.delta as Record<string, unknown>)?.type === 'text_delta') {
          const delta = (parsed.delta as Record<string, unknown>).text as string;
          if (delta) yield delta;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function createAnthropicProxyClient(
  baseUrl: string,
  apiKey: string | undefined,
  model: string,
): AIClient {
  const apiBase = baseUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': ANTHROPIC_VERSION,
  };
  if (apiKey) {
    headers['x-api-key'] = apiKey;
    headers['authorization'] = `Bearer ${apiKey}`;
  }

  async function makeRequest(messages: Message[], systemPrompt: string, signal?: AbortSignal): Promise<AnthropicResponse> {
    const body = buildRequestBody(messages, systemPrompt, model, false);
    const response = await fetch(`${apiBase}/v1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });
    return parseResponse(response);
  }

  return {
    async sendMessage(messages: Message[], systemPrompt: string, signal?: AbortSignal): Promise<AIResponse> {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), DEFAULT_TIMEOUT_MS);
      if (signal) {
        signal.addEventListener('abort', () => { clearTimeout(timer); ac.abort(); }, { once: true });
      }
      try {
        const anthropicResponse = await makeRequest(messages, systemPrompt, ac.signal);
        const content = anthropicResponse.content
          .filter((block): block is { type: 'text'; text: string } => block.type === 'text' && !!block.text)
          .map(block => block.text)
          .join('\n');
        return {
          message: stripToolCallBlocks(content),
          toolCalls: parseToolCalls(content),
        };
      } finally {
        clearTimeout(timer);
      }
    },

    async sendMessageStream(messages: Message[], systemPrompt: string, onEvent: (event: StreamEvent) => void, signal?: AbortSignal): Promise<AIResponse> {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), DEFAULT_TIMEOUT_MS);
      if (signal) {
        signal.addEventListener('abort', () => { clearTimeout(timer); ac.abort(); }, { once: true });
      }
      try {
        const body = buildRequestBody(messages, systemPrompt, model, true);
        const response = await fetch(`${apiBase}/v1/messages`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: ac.signal,
        });
        if (!response.ok) {
          await parseResponse(response);
          return { message: '', toolCalls: [] };
        }
        let fullContent = '';
        for await (const delta of streamResponse(response)) {
          fullContent += delta;
          onEvent({ type: 'token', text: delta });
        }
        const toolCalls = parseToolCalls(fullContent);
        const cleanContent = stripToolCallBlocks(fullContent);
        onEvent({ type: 'done', fullText: cleanContent, toolCalls });
        return { message: cleanContent, toolCalls };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export async function checkAnthropicProxyAPI(baseUrl: string, apiKey?: string): Promise<{ ok: boolean; message: string }> {
  const apiBase = baseUrl.replace(/\/+$/, '');
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': ANTHROPIC_VERSION,
    };
    if (apiKey) {
      headers['x-api-key'] = apiKey;
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    const url = `${apiBase}/v1/models`;
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok || res.status === 401 || res.status === 404) {
      return { ok: true, message: '' };
    }
    return { ok: false, message: `API returned status ${res.status}` };
  } catch (err: unknown) {
    const e = err as Error;
    return { ok: false, message: `Cannot reach Anthropic proxy: ${e.message}` };
  }
}
