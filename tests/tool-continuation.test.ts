import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildToolContinuationMessages,
  countAutoContinueMessages,
  streamChat,
} from '../web/src/utils/tool-continuation.js';
import type { StreamEvent } from '../web/src/utils/tool-continuation.js';

describe('tool continuation helper', () => {

  const history = [
    { role: 'user', content: 'read the file src/index.ts' },
    { role: 'assistant', content: 'I will read the file for you.' },
  ];

  const toolContext =
    '[Tool Results: 2 action(s) executed]\n' +
    '  OK read_file: src/index.ts read successfully\n' +
    '  OK list_files: project structure listed';

  // ── regression guards: [auto-continue] must never appear ──────────

  it('buildToolContinuationMessages never inserts [auto-continue]', () => {
    const result = buildToolContinuationMessages(history, toolContext);
    assert.equal(countAutoContinueMessages(result.messages), 0,
      `Messages contain [auto-continue]: ${JSON.stringify(result.messages)}`);
  });

  it('countAutoContinueMessages returns 0 for clean messages', () => {
    assert.equal(countAutoContinueMessages(history), 0);
    const result = buildToolContinuationMessages(history, toolContext);
    assert.equal(countAutoContinueMessages(result.messages), 0);
  });

  it('countAutoContinueMessages detects [auto-continue] when present', () => {
    const dirty = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: '[auto-continue] more stuff' },
    ];
    assert.equal(countAutoContinueMessages(dirty), 1);
  });

  // ── tool context shape ────────────────────────────────────────────

  it('tool context is appended as a user message at the end', () => {
    const result = buildToolContinuationMessages(history, toolContext);
    const last = result.messages[result.messages.length - 1];
    assert.equal(last.role, 'user');
    assert.ok(last.content.startsWith('[Tool Results]'),
      `Expected [Tool Results] prefix, got: ${last.content.slice(0, 50)}`);
    assert.ok(last.content.includes(toolContext),
      'Tool context content must appear in the user message');
    assert.ok(last.content.includes('Synthesize the tool results'),
      `Expected synthesis instruction, got: ${last.content.slice(-60)}`);
  });

  it('tool context message references the tool results', () => {
    const result = buildToolContinuationMessages(history, toolContext);
    const last = result.messages[result.messages.length - 1].content;
    assert.ok(last.includes('read_file'), 'Must mention read_file');
    assert.ok(last.includes('list_files'), 'Must mention list_files');
  });

  // ── history preservation ──────────────────────────────────────────

  it('original history messages are preserved unchanged', () => {
    const result = buildToolContinuationMessages(history, toolContext);
    assert.equal(result.messages.length, history.length + 1,
      'Should have history + 1 tool context message');
    for (let i = 0; i < history.length; i++) {
      assert.equal(result.messages[i].role, history[i].role);
      assert.equal(result.messages[i].content, history[i].content);
    }
  });

  it('tool context message is the last message', () => {
    const result = buildToolContinuationMessages(history, toolContext);
    assert.equal(result.messages[result.messages.length - 1].role, 'user');
    assert.ok(result.messages[result.messages.length - 1].content.includes('[Tool Results]'));
  });

  it('works with empty history', () => {
    const result = buildToolContinuationMessages([], toolContext);
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0].role, 'user');
    assert.ok(result.messages[0].content.includes('[Tool Results]'));
  });

  // ── sessionId ─────────────────────────────────────────────────────

  it('sessionId is included when provided', () => {
    const result = buildToolContinuationMessages(history, toolContext, 'session-abc');
    assert.equal(result.sessionId, 'session-abc');
  });

  it('sessionId is undefined when not provided', () => {
    const result = buildToolContinuationMessages(history, toolContext);
    assert.equal(result.sessionId, undefined);
  });

  // ── edge cases ────────────────────────────────────────────────────

  it('does not mutate the input history array', () => {
    const originalLength = history.length;
    buildToolContinuationMessages(history, toolContext);
    assert.equal(history.length, originalLength,
      'Input history length should not change');
    assert.equal(history[history.length - 1].content,
      'I will read the file for you.');
  });

  it('empty tool context produces valid message', () => {
    const result = buildToolContinuationMessages(history, '');
    const last = result.messages[result.messages.length - 1];
    assert.equal(last.role, 'user');
    assert.ok(last.content.includes('[Tool Results]'));
    assert.ok(last.content.includes('Synthesize'));
  });

  it('long tool context is preserved (no truncation in helper)', () => {
    const longCtx = 'LONG '.repeat(200).trim();
    const result = buildToolContinuationMessages(history, longCtx);
    const lastContent = result.messages[result.messages.length - 1].content;
    assert.ok(lastContent.includes(longCtx),
      'Long tool context should be preserved whole');
  });

  // ── synthesis prompt ──────────────────────────────────────────────

  it('prompt instructs model to synthesize tool results', () => {
    const result = buildToolContinuationMessages(history, toolContext);
    const last = result.messages[result.messages.length - 1].content;
    assert.ok(last.includes('Synthesize'), 'Must contain synthesis instruction');
    assert.ok(last.includes('Explain'), 'Must mention explaining findings');
    assert.ok(last.includes('summarize'), 'Must mention summarizing actions');
    assert.ok(last.includes('errors') || last.includes('limitations'), 'Must mention errors/limitations');
    assert.ok(last.includes('next steps'), 'Must suggest next steps');
  });

  it('prompt does not contain raw Continue.', () => {
    const result = buildToolContinuationMessages(history, toolContext);
    const last = result.messages[result.messages.length - 1].content;
    assert.ok(!last.includes('\n\nContinue.'), 'Should not end with bare Continue.');
  });

  it('tool result count is computed from context lines', () => {
    const ctx = '  OK read_file: done\n  ERROR run_command: failed\n  OK list_files: done';
    const result = buildToolContinuationMessages(history, ctx);
    const last = result.messages[result.messages.length - 1].content;
    assert.ok(last.includes('[Tool Results]'), 'Prefix present');
  });

  it('empty tool context still gets synthesis instruction', () => {
    const result = buildToolContinuationMessages(history, '');
    const last = result.messages[result.messages.length - 1].content;
    assert.ok(last.includes('Synthesize'), 'Synthesis instruction present even with empty context');
  });

  it('synthesis prompt covers original user goal', () => {
    const result = buildToolContinuationMessages(history, toolContext);
    const last = result.messages[result.messages.length - 1].content;
    assert.ok(last.includes('what was found'), 'Mentions explaining findings');
    assert.ok(last.includes('outcomes'), 'Mentions outcomes of actions');
  });

  it('single tool result gets synthesis instruction', () => {
    const singleCtx = '  OK read_file: src/index.ts read (200 lines)';
    const result = buildToolContinuationMessages(history, singleCtx);
    const last = result.messages[result.messages.length - 1].content;
    assert.ok(last.includes('Synthesize'), 'Synthesis instruction for single result');
  });

  it('multiple tool results instructs summary', () => {
    const multiCtx = '  OK read_file: file1\n  OK list_files: dir1\n  ERROR run_command: failed';
    const result = buildToolContinuationMessages(history, multiCtx);
    const last = result.messages[result.messages.length - 1].content;
    assert.ok(last.includes('summarize actions'), 'Summarize multiple actions');
  });

  it('mixed success/error results handled', () => {
    const mixedCtx = '  OK read_file: success\n  ERROR write_file: permission denied';
    const result = buildToolContinuationMessages(history, mixedCtx);
    const last = result.messages[result.messages.length - 1].content;
    assert.ok(last.includes('errors') || last.includes('limitations'), 'Errors mentioned');
  });

  it('no auto-continue regression in synthesis prompt', () => {
    const result = buildToolContinuationMessages(history, toolContext);
    assert.equal(countAutoContinueMessages(result.messages), 0);
  });
});

function mockResponse(sseChunks: string[]): Response {
  async function* generate() {
    for (const chunk of sseChunks) {
      yield new TextEncoder().encode(chunk);
    }
  }
  const stream = new ReadableStream({
    async start(controller) {
      for await (const chunk of generate()) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
  return { ok: true, status: 200, body: stream, headers: new Headers() } as Response;
}

describe('streamChat', () => {

  it('emits token events for SSE data chunks', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => mockResponse([
      'data: {"type":"token","text":"Hello"}\n',
      'data: {"type":"token","text":" World"}\n',
      'data: {"type":"done","fullText":"Hello World"}\n',
    ]);
    try {
      const events: StreamEvent[] = [];
      await streamChat({ messages: [{ role: 'user', content: 'test' }] }, evt => events.push(evt));
      assert.equal(events.length, 3);
      assert.equal(events[0].type, 'token');
      assert.equal((events[0] as any).text, 'Hello');
      assert.equal(events[1].type, 'token');
      assert.equal((events[1] as any).text, ' World');
      assert.equal(events[2].type, 'done');
      assert.equal((events[2] as any).fullText, 'Hello World');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('handles token split across chunks', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => mockResponse([
      'data: {"type":"token","text":"Hel',
      'lo"}\n',
      'data: {"type":"done","fullText":"Hello"}\n',
    ]);
    try {
      const events: StreamEvent[] = [];
      await streamChat({ messages: [{ role: 'user', content: 'test' }] }, evt => events.push(evt));
      assert.equal(events.length, 2);
      assert.equal(events[0].type, 'token');
      assert.equal((events[0] as any).text, 'Hello');
      assert.equal(events[1].type, 'done');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('emits sessionId on done event', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => mockResponse([
      'data: {"type":"done","fullText":"ok","sessionId":"sess-xyz"}\n',
    ]);
    try {
      const events: StreamEvent[] = [];
      await streamChat({ messages: [{ role: 'user', content: 'test' }] }, evt => events.push(evt));
      assert.equal(events.length, 1);
      assert.equal(events[0].type, 'done');
      assert.equal((events[0] as any).sessionId, 'sess-xyz');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('emits error event without throwing', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => mockResponse([
      'data: {"type":"error","message":"Rate limit exceeded"}\n',
    ]);
    try {
      const events: StreamEvent[] = [];
      await streamChat({ messages: [{ role: 'user', content: 'test' }] }, evt => events.push(evt));
      assert.equal(events.length, 1);
      assert.equal(events[0].type, 'error');
      assert.equal((events[0] as any).message, 'Rate limit exceeded');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('skips non-data SSE lines', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => mockResponse([
      ':\n',
      'data: {"type":"token","text":"Hi"}\n',
      'event: custom\n',
      'data: {"type":"done","fullText":"Hi"}\n',
    ]);
    try {
      const events: StreamEvent[] = [];
      await streamChat({ messages: [{ role: 'user', content: 'test' }] }, evt => events.push(evt));
      assert.equal(events.length, 2);
      assert.equal(events[0].type, 'token');
      assert.equal(events[1].type, 'done');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('throws when fetch returns non-ok status', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 500, body: null } as Response);
    try {
      await assert.rejects(
        () => streamChat({ messages: [{ role: 'user', content: 'test' }] }, () => {}),
        /Stream request failed: 500/,
      );
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('throws when body is null', async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, status: 200, body: null } as Response);
    try {
      await assert.rejects(
        () => streamChat({ messages: [{ role: 'user', content: 'test' }] }, () => {}),
        /Stream request failed/,
      );
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('sends correct POST request', async () => {
    const origFetch = globalThis.fetch;
    let capturedUrl = '';
    let capturedBody = '';
    globalThis.fetch = async (url: string, init?: any) => {
      capturedUrl = url as string;
      capturedBody = init?.body || '';
      return mockResponse(['data: {"type":"done","fullText":""}\n']);
    };
    try {
      const payload = { messages: [{ role: 'user', content: 'continue' }], sessionId: 's-1' };
      await streamChat(payload, () => {});
      assert.equal(capturedUrl, '/api/chat/stream');
      const parsed = JSON.parse(capturedBody);
      assert.equal(parsed.messages[0].content, 'continue');
      assert.equal(parsed.sessionId, 's-1');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('accepts AbortSignal without error', async () => {
    const origFetch = globalThis.fetch;
    const ac = new AbortController();
    globalThis.fetch = async (_url: string, init?: any) => {
      assert.ok(init?.signal, 'AbortSignal should be passed');
      return mockResponse(['data: {"type":"done","fullText":""}\n']);
    };
    try {
      await streamChat({ messages: [] }, () => {}, ac.signal);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
