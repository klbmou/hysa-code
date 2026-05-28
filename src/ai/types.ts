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
  provider?: string;
  model?: string;
  fallbackEvents?: string[];
}

export interface AIClient {
  sendMessage(messages: Message[], systemPrompt: string, signal?: AbortSignal): Promise<AIResponse>;
  sendMessageStream?(messages: Message[], systemPrompt: string, onEvent: (event: StreamEvent) => void, signal?: AbortSignal): Promise<AIResponse>;
}

export type StreamEvent =
  | { type: 'token'; text: string }
  | { type: 'done'; fullText: string; toolCalls: ToolCall[]; provider?: string; model?: string; fallbackEvents?: string[] }
  | { type: 'error'; message: string };

export interface HealthCheckResult {
  ok: boolean;
  message: string;
}

export function isValidResponse(res: AIResponse): boolean {
  return !!((res.message && res.message.trim()) || (res.toolCalls && res.toolCalls.length > 0));
}

// Re-exported for convenience
export type { ProviderType } from '../config/keys.js';
