import { GoogleGenerativeAI } from '@google/generative-ai';
import { parseToolCalls, stripToolCallBlocks } from './tools.js';
function toGeminiRole(role) {
    return role === 'assistant' ? 'model' : 'user';
}
function contentToGeminiParts(content) {
    if (typeof content === 'string') {
        return [{ text: content }];
    }
    const parts = [];
    for (const part of content) {
        if (part.type === 'text') {
            parts.push({ text: part.text });
        }
        else if (part.type === 'image_url') {
            const dataUrl = part.image_url?.url || '';
            const match = dataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
            if (match) {
                parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
            }
        }
    }
    return parts.length > 0 ? parts : [{ text: String(content) }];
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
    const handleContent = (content) => ({
        message: stripToolCallBlocks(content),
        toolCalls: parseToolCalls(content),
    });
    const buildContents = (messages, systemPrompt) => {
        const history = messages.slice(0, -1).map(m => ({
            role: toGeminiRole(m.role),
            parts: contentToGeminiParts(m.content),
        }));
        const lastMessage = messages[messages.length - 1];
        return { history, lastMessage };
    };
    return {
        async sendMessage(messages, systemPrompt, signal) {
            const geminiModel = genAI.getGenerativeModel({ model });
            const { history, lastMessage } = buildContents(messages, systemPrompt);
            let content;
            if (messages.length === 1) {
                const result = await withTimeout(geminiModel.generateContent({
                    contents: [{ role: 'user', parts: contentToGeminiParts(lastMessage.content) }],
                    systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
                }), 30000, signal);
                content = result.response.text();
            }
            else {
                const chat = geminiModel.startChat({
                    history,
                    systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
                });
                const result = await withTimeout(chat.sendMessage(contentToGeminiParts(lastMessage.content)), 30000, signal);
                content = result.response.text();
            }
            return handleContent(content);
        },
        async sendMessageStream(messages, systemPrompt, onEvent, signal) {
            const geminiModel = genAI.getGenerativeModel({ model });
            const { history, lastMessage } = buildContents(messages, systemPrompt);
            let fullContent = '';
            if (messages.length === 1) {
                const result = await withTimeout(geminiModel.generateContentStream({
                    contents: [{ role: 'user', parts: contentToGeminiParts(lastMessage.content) }],
                    systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
                }), 30000, signal);
                for await (const chunk of result.stream) {
                    const delta = chunk.text();
                    if (delta) {
                        fullContent += delta;
                        onEvent({ type: 'token', text: delta });
                    }
                }
            }
            else {
                const chat = geminiModel.startChat({
                    history,
                    systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
                });
                const result = await withTimeout(chat.sendMessageStream(contentToGeminiParts(lastMessage.content)), 30000, signal);
                for await (const chunk of result.stream) {
                    const delta = chunk.text();
                    if (delta) {
                        fullContent += delta;
                        onEvent({ type: 'token', text: delta });
                    }
                }
            }
            onEvent({ type: 'done', fullText: stripToolCallBlocks(fullContent), toolCalls: parseToolCalls(fullContent) });
            return handleContent(fullContent);
        },
    };
}
//# sourceMappingURL=gemini.js.map