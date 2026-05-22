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
            const response = await client.chat.completions.create({
                model,
                max_tokens: 4096,
                messages: [
                    { role: 'system', content: systemPrompt },
                    ...messages.map(m => ({ role: m.role, content: m.content })),
                ],
            }, { signal });
            const content = extractContentFromResponse(response);
            return {
                message: stripToolCallBlocks(content),
                toolCalls: parseToolCalls(content),
            };
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
            // 401 means the endpoint is reachable but key might be invalid
            // We treat reachable as healthy for the purpose of connectivity check
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