declare const MAX_CONTEXT_TOKENS = 8000;
export declare function estimateTokens(text: string): number;
export declare function truncateToTokens(text: string, maxTokens?: number): {
    text: string;
    truncated: boolean;
    originalTokens: number;
    finalTokens: number;
};
export declare function truncateMessages(messages: {
    role: 'user' | 'assistant';
    content: string;
}[], maxTokens?: number): {
    messages: {
        role: 'user' | 'assistant';
        content: string;
    }[];
    truncated: boolean;
};
export { MAX_CONTEXT_TOKENS };
//# sourceMappingURL=tokens.d.ts.map