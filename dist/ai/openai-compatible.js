import OpenAI from 'openai';
import { parseToolCalls, stripToolCallBlocks } from './tools.js';
function extractContentFromResponse(response) {
    const resp = response;
    const choice = resp.choices?.[0];
    if (choice) {
        if (typeof choice.message?.content === 'string')
            return choice.message.content;
        if (typeof choice.text === 'string')
            return choice.text;
    }
    if (typeof resp.output_text === 'string')
        return resp.output_text;
    if (typeof resp.response === 'string')
        return resp.response;
    if (typeof resp.message === 'string')
        return resp.message;
    if (typeof resp.content === 'string')
        return resp.content;
    if (typeof resp.text === 'string')
        return resp.text;
    return '';
}
export function createOpenAICompatibleClient(baseURL, apiKey, model, defaultHeaders, timeoutMs = 30000) {
    const client = new OpenAI({
        baseURL,
        apiKey: apiKey || '',
        defaultHeaders,
        timeout: timeoutMs,
        maxRetries: 0,
    });
    return {
        async sendMessage(messages, systemPrompt, signal) {
            const openaiMessages = [
                { role: 'system', content: systemPrompt },
                ...messages.map(m => ({ role: m.role, content: m.content })),
            ];
            const response = await client.chat.completions.create({
                model,
                max_tokens: 4096,
                messages: openaiMessages,
            }, { signal });
            const content = extractContentFromResponse(response);
            return {
                message: stripToolCallBlocks(content),
                toolCalls: parseToolCalls(content),
            };
        },
        async sendMessageStream(messages, systemPrompt, onEvent, signal) {
            const openaiMessages = [
                { role: 'system', content: systemPrompt },
                ...messages.map(m => ({ role: m.role, content: m.content })),
            ];
            const stream = await client.chat.completions.create({
                model,
                max_tokens: 4096,
                stream: true,
                messages: openaiMessages,
            }, { signal });
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
export async function checkOpenAICompatibleAPI(baseURL, apiKey) {
    try {
        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }
        const res = await fetch(`${baseURL}/models`, {
            headers,
            signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT),
        });
        if (res.ok || res.status === 401) {
            return { ok: true, message: '' };
        }
        return { ok: false, message: `API returned status ${res.status}` };
    }
    catch (err) {
        const e = err;
        return { ok: false, message: `Cannot reach API: ${e.message}` };
    }
}
//# sourceMappingURL=openai-compatible.js.map