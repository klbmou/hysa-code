import { GoogleGenerativeAI } from '@google/generative-ai';
import { parseToolCalls, stripToolCallBlocks } from './tools.js';
function toGeminiRole(role) {
    return role === 'assistant' ? 'model' : 'user';
}
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
export function createGeminiClient(apiKey, model) {
    const genAI = new GoogleGenerativeAI(apiKey);
    return {
        async sendMessage(messages, systemPrompt, signal) {
            const geminiModel = genAI.getGenerativeModel({ model });
            const history = messages.slice(0, -1).map(m => ({
                role: toGeminiRole(m.role),
                parts: [{ text: m.content }],
            }));
            const lastMessage = messages[messages.length - 1];
            let content;
            if (messages.length === 1) {
                const result = await withTimeout(geminiModel.generateContent({
                    contents: [{ role: 'user', parts: [{ text: lastMessage.content }] }],
                    systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
                }), 30000, signal);
                content = result.response.text();
            }
            else {
                const chat = geminiModel.startChat({
                    history,
                    systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
                });
                const result = await withTimeout(chat.sendMessage(lastMessage.content), 30000, signal);
                content = result.response.text();
            }
            return {
                message: stripToolCallBlocks(content),
                toolCalls: parseToolCalls(content),
            };
        },
    };
}
//# sourceMappingURL=gemini.js.map