export interface ContinuationPayload {
  messages: { role: string; content: string }[];
  sessionId?: string;
}

export function buildToolContinuationMessages(
  chatHistory: { role: string; content: string }[],
  toolContextForAi: string,
  sessionId?: string,
): ContinuationPayload {
  const messages: { role: string; content: string }[] = [...chatHistory];
  const toolResultCount = toolContextForAi ? (toolContextForAi.match(/^\s{2}(OK|ERROR|SKIP|BLOCKED)/gm) || []).length : 0;
  messages.push({ role: 'user', content: `[Tool Results]\n${toolContextForAi}\n\nSynthesize the tool results above into a clear and helpful answer. Explain what was found, summarize actions taken and their outcomes, mention any errors or limitations, and suggest next steps if appropriate.` });
  const result: ContinuationPayload = { messages };
  if (sessionId) result.sessionId = sessionId;
  return result;
}

export function countAutoContinueMessages(msgs: { role: string; content: string }[]): number {
  return msgs.filter(m => m.content.includes('[auto-continue]')).length;
}

export interface StreamEvent {
  type: 'token' | 'done' | 'error';
  text?: string;
  fullText?: string;
  sessionId?: string;
  message?: string;
}

export async function streamChat(
  payload: ContinuationPayload,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const streamRes = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });
  if (!streamRes.ok || !streamRes.body) {
    throw new Error(`Stream request failed: ${streamRes.status}`);
  }
  const reader = streamRes.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let streamDone = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      try {
        const event = JSON.parse(trimmed.slice(6)) as StreamEvent;
        onEvent(event);
        if (event.type === 'done' || event.type === 'error') {
          streamDone = true;
        }
      } catch { /* skip malformed SSE */ }
    }
  }
  if (!streamDone && buf.trim()) {
    try {
      const event = JSON.parse(buf.trim().slice(6)) as StreamEvent;
      onEvent(event);
    } catch { /* skip trailing garbage */ }
  }
}
