import type { AIClient, Message, AIResponse, StreamEvent } from './types.js';

const TEST_PROVIDER_LABEL = 'Test Provider';
const TEST_MODEL = 'hysa-e2e-test-model';

function getDeterministicResponse(messages: Message[]): string {
  const lastUserMsg = messages.filter(m => m.role === 'user').pop()?.content || '';
  const lower = lastUserMsg.toLowerCase();
  const isArabic = /[\u0600-\u06FF]/.test(lastUserMsg);

  if (isArabic) {
    return 'حسنًا';
  }

  // Respond minimally based on the prompt pattern
  if (/\bhi+\b|hello|hey\b/i.test(lower)) return 'Hello! How can I help you?';
  if (/\bok\b/i.test(lower) || /say.*ok/i.test(lower)) return 'OK';
  if (/\byes\b/i.test(lower)) return 'Yes';
  if (/\bno\b/i.test(lower)) return 'No';
  if (/\bthank/i.test(lower)) return "You're welcome!";
  if (/\bwhat.*(name|you)/i.test(lower)) return 'I am the HYSA E2E test provider.';

  return 'OK';
}

function createTestClientSendMessage(messages: Message[], _systemPrompt: string, _signal?: AbortSignal): Promise<AIResponse> {
  const message = getDeterministicResponse(messages);
  return Promise.resolve({ message, toolCalls: [] });
}

function createTestClientSendMessageStream(
  messages: Message[],
  _systemPrompt: string,
  onEvent: (event: StreamEvent) => void,
  _signal?: AbortSignal,
): Promise<AIResponse> {
  const message = getDeterministicResponse(messages);

  // Emit the full response as a single token
  onEvent({ type: 'token', text: message });

  // Emit done event
  onEvent({
    type: 'done',
    fullText: message,
    toolCalls: [],
    provider: TEST_PROVIDER_LABEL,
    model: TEST_MODEL,
  });

  return Promise.resolve({ message, toolCalls: [], provider: TEST_PROVIDER_LABEL, model: TEST_MODEL });
}

export function createTestClient(): AIClient {
  return {
    sendMessage: createTestClientSendMessage,
    sendMessageStream: createTestClientSendMessageStream,
  };
}
