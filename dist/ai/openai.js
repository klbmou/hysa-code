import OpenAI from 'openai';
import { parseToolCalls, stripToolCallBlocks } from './tools.js';
export function createOpenAIClient(apiKey, model) {
    const client = new OpenAI({ apiKey, timeout: 45000, maxRetries: 0 });
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
            const content = response.choices[0]?.message?.content || '';
            return {
                message: stripToolCallBlocks(content),
                toolCalls: parseToolCalls(content),
            };
        },
    };
}
//# sourceMappingURL=openai.js.map