import Anthropic from '@anthropic-ai/sdk';
import { parseToolCalls, stripToolCallBlocks } from './tools.js';
function withTimeout(promise, ms, signal) {
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Request timed out after ${ms / 1000}s`)), ms);
        if (signal) {
            signal.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(new DOMException('Aborted', 'AbortError'));
            });
        }
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}
export function createAnthropicClient(apiKey, model) {
    const client = new Anthropic({ apiKey });
    return {
        async sendMessage(messages, systemPrompt, signal) {
            const response = await withTimeout(client.messages.create({
                model,
                max_tokens: 4096,
                system: systemPrompt,
                messages: messages.map(m => ({ role: m.role, content: m.content })),
            }), 30000, signal);
            const content = response.content
                .filter((block) => block.type === 'text')
                .map(block => block.text)
                .join('\n');
            const toolCalls = parseToolCalls(content);
            return {
                message: stripToolCallBlocks(content),
                toolCalls,
            };
        },
        async sendMessageStream(messages, systemPrompt, onEvent, signal) {
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
//# sourceMappingURL=anthropic.js.map