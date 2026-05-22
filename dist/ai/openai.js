import OpenAI from 'openai';
import { parseToolCalls, stripToolCallBlocks } from './tools.js';
export function createOpenAIClient(apiKey, model) {
    const client = new OpenAI({ apiKey, timeout: 30000, maxRetries: 0 });
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
            const content = response.choices[0]?.message?.content || '';
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
                const delta = chunk.choices[0]?.delta?.content || '';
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
//# sourceMappingURL=openai.js.map