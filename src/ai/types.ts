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

export function isValidResponse(res: AIResponse): boolean {
  return !!((res.message && res.message.trim()) || (res.toolCalls && res.toolCalls.length > 0));
}

// Re-exported for convenience
export type { ProviderType } from '../config/keys.js';
