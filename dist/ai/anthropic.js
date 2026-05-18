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
            }), 45000, signal);
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
    };
}
//# sourceMappingURL=anthropic.js.map