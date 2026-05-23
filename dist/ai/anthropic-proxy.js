import { parseToolCalls, stripToolCallBlocks } from './tools.js';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_TIMEOUT_MS = 30000;
function buildRequestBody(messages, systemPrompt, model, stream) {
    const anthropicMessages = messages.map(m => ({
        role: m.role,
        content: m.content,
    }));
    const body = {
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
async function parseResponse(response) {
    const text = await response.text();
    if (!response.ok) {
        let detail = '';
        try {
            const parsed = JSON.parse(text);
            detail = parsed.error?.message || parsed.error || JSON.stringify(parsed).slice(0, 200);
        }
        catch {
            detail = text.slice(0, 200);
        }
        throw new Error(`Anthropic proxy error (${response.status}): ${detail}`);
    }
    return JSON.parse(text);
}
async function* streamResponse(response) {
    const reader = response.body?.getReader();
    if (!reader) {
        throw new Error('Response body is not readable');
    }
    const decoder = new TextDecoder();
    let buffer = '';
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith(':'))
                    continue;
                if (!trimmed.startsWith('data: '))
                    continue;
                const data = trimmed.slice(6).trim();
                if (data === '[DONE]')
                    return;
                let parsed;
                try {
                    parsed = JSON.parse(data);
                }
                catch {
                    continue;
                }
                if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
                    const delta = parsed.delta.text;
                    if (delta)
                        yield delta;
                }
            }
        }
    }
    finally {
        reader.releaseLock();
    }
}
export function createAnthropicProxyClient(baseUrl, apiKey, model) {
    const apiBase = baseUrl.replace(/\/+$/, '');
    const headers = {
        'content-type': 'application/json',
        'anthropic-version': ANTHROPIC_VERSION,
    };
    if (apiKey) {
        headers['x-api-key'] = apiKey;
        headers['authorization'] = `Bearer ${apiKey}`;
    }
    async function makeRequest(messages, systemPrompt, signal) {
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
        async sendMessage(messages, systemPrompt, signal) {
            const ac = new AbortController();
            const timer = setTimeout(() => ac.abort(), DEFAULT_TIMEOUT_MS);
            if (signal) {
                signal.addEventListener('abort', () => { clearTimeout(timer); ac.abort(); }, { once: true });
            }
            try {
                const anthropicResponse = await makeRequest(messages, systemPrompt, ac.signal);
                const content = anthropicResponse.content
                    .filter((block) => block.type === 'text' && !!block.text)
                    .map(block => block.text)
                    .join('\n');
                return {
                    message: stripToolCallBlocks(content),
                    toolCalls: parseToolCalls(content),
                };
            }
            finally {
                clearTimeout(timer);
            }
        },
        async sendMessageStream(messages, systemPrompt, onEvent, signal) {
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
            }
            finally {
                clearTimeout(timer);
            }
        },
    };
}
export async function checkAnthropicProxyAPI(baseUrl, apiKey) {
    const apiBase = baseUrl.replace(/\/+$/, '');
    try {
        const headers = {
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
    }
    catch (err) {
        const e = err;
        return { ok: false, message: `Cannot reach Anthropic proxy: ${e.message}` };
    }
}
//# sourceMappingURL=anthropic-proxy.js.map