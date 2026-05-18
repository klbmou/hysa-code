const MAX_CONTEXT_TOKENS = 8000;
const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function truncateToTokens(text: string, maxTokens: number = MAX_CONTEXT_TOKENS): { text: string; truncated: boolean; originalTokens: number; finalTokens: number } {
  const originalTokens = estimateTokens(text);
  if (originalTokens <= maxTokens) {
    return { text, truncated: false, originalTokens, finalTokens: originalTokens };
  }

  const maxChars = maxTokens * CHARS_PER_TOKEN;
  const truncated = text.slice(0, maxChars) + '\n\n[Content truncated for token safety...]';
  return {
    text: truncated,
    truncated: true,
    originalTokens,
    finalTokens: estimateTokens(truncated),
  };
}

export function truncateMessages(
  messages: { role: 'user' | 'assistant'; content: string }[],
  maxTokens: number = MAX_CONTEXT_TOKENS,
): { messages: { role: 'user' | 'assistant'; content: string }[]; truncated: boolean } {
  let totalTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);

  if (totalTokens <= maxTokens) {
    return { messages, truncated: false };
  }

  const result = [...messages];

  // Remove oldest non-system messages until under limit
  while (result.length > 2 && totalTokens > maxTokens) {
    const removed = result.splice(1, 1)[0];
    if (removed) {
      totalTokens -= estimateTokens(removed.content);
    }
  }

  // If still over limit, truncate oldest remaining content
  if (totalTokens > maxTokens && result.length > 1) {
    const oldestIdx = result.length > 2 ? 1 : 0;
    const msg = result[oldestIdx];
    if (msg) {
      const targetTokens = Math.max(1000, totalTokens - maxTokens);
      const truncated = truncateToTokens(msg.content, estimateTokens(msg.content) - targetTokens);
      result[oldestIdx] = { ...msg, content: truncated.text };
    }
  }

  return { messages: result, truncated: true };
}

export { MAX_CONTEXT_TOKENS };
