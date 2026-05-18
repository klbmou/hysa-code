export interface Message {
    role: 'user' | 'assistant';
    content: string;
}
export type ToolType = 'read_file' | 'edit_file' | 'execute_command' | 'list_symbols' | 'find_references' | 'search_imports' | 'summarize_file' | 'explain_function';
export interface ToolCall {
    type: ToolType;
    params: Record<string, string>;
}
export interface AIResponse {
    message: string;
    toolCalls: ToolCall[];
}
export interface AIClient {
    sendMessage(messages: Message[], systemPrompt: string, signal?: AbortSignal): Promise<AIResponse>;
}
export interface HealthCheckResult {
    ok: boolean;
    message: string;
}
export type { ProviderType } from '../config/keys.js';
//# sourceMappingURL=types.d.ts.map