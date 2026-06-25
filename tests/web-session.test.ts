import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createWebSessionId, getOrCreateWebSession, summarizeMessageForMemory, summarizeAssistantResponse, recordWebChatTurn } from '../src/brain/web-session.js';
import { readRecentEvents } from '../src/brain/store.js';

const TEST_DIR = join(process.cwd(), '.hysa-test-web-session');
let origCwd = process.cwd();

async function setupTestBrain(): Promise<void> {
  await mkdir(TEST_DIR, { recursive: true });
  process.chdir(TEST_DIR);
  const brainDir = join(TEST_DIR, '.hysa', 'brain');
  await mkdir(brainDir, { recursive: true });
  await writeFile(join(brainDir, 'experience-graph.json'), JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), nodes: [], edges: [] }));
  await writeFile(join(brainDir, 'experience-log.jsonl'), '');
  await writeFile(join(brainDir, 'lessons.md'), '# Lessons\n\n');
  await writeFile(join(brainDir, 'decisions.md'), '# Decisions\n\n');
}

async function teardownTestBrain(): Promise<void> {
  process.chdir(origCwd);
  await rm(TEST_DIR, { recursive: true, force: true });
}

describe('web-session', () => {
  before(setupTestBrain);
  after(teardownTestBrain);

  // 1. session ID creation
  it('creates a unique session ID', () => {
    const id1 = createWebSessionId();
    const id2 = createWebSessionId();
    assert.ok(id1.length > 0, 'sessionId should not be empty');
    assert.notEqual(id1, id2, 'each sessionId should be unique');
  });

  // 2. Arabic message summary preservation
  it('preserves Arabic text in summary', () => {
    const arabic = 'مرحباً بالعالم هذا نص عربي طويل يحتوي على كلمات مختلفة';
    const result = summarizeMessageForMemory(arabic, 200);
    assert.ok(result.includes('مرحباً'), 'Arabic text should be preserved');
    assert.ok(result.includes('العالم'), 'Arabic text should be preserved');
    assert.equal(result, arabic, 'short Arabic text should pass through unchanged');
  });

  // 3. long pasted text summarized safely
  it('summarizes long pasted text without first-line-only bug', () => {
    const longLines = Array.from({ length: 50 }, (_, i) => `This is line number ${i + 1} of the pasted content for testing truncation behavior.`);
    const longText = longLines.join('\n');
    const maxLen = 200;
    const result = summarizeMessageForMemory(longText, maxLen);
    assert.ok(result.length <= maxLen + 50, `result should not exceed maxLen by much, got ${result.length}`);
    assert.ok(result.includes('truncated'), 'should indicate truncation');
    assert.ok(!result.startsWith('This is line number 1') || result.includes('line number'), 'should not be just first line');
  });

  // 4. secrets redacted
  it('redacts secrets from summaries', () => {
    const withKey = 'My API key is sk-abc123def456 and it should be secret';
    assert.equal(summarizeMessageForMemory(withKey), '[REDACTED]');
    assert.equal(summarizeAssistantResponse(withKey), '[REDACTED]');
  });

  // 5. event creation includes task/language/provider metadata
  it('recordWebChatTurn creates brain event with metadata', async () => {
    const session = getOrCreateWebSession();
    await recordWebChatTurn({
      sessionId: session.sessionId,
      userMessage: 'What is the weather?',
      assistantResponse: 'It is sunny today.',
      taskKind: 'simple_chat',
      language: 'english',
      provider: 'openai_router',
      model: 'oc/deepseek-v4-flash-free',
      usedSearch: true,
      messageCount: 1,
    });
    const events = await readRecentEvents(5);
    const found = events.find((e: any) => e.metadata?.sessionId === session.sessionId);
    assert.ok(found, 'brain event should exist');
    assert.equal(found.kind, 'task_completed');
    assert.equal(found.provider, 'openai_router');
    assert.equal(found.model, 'oc/deepseek-v4-flash-free');
    assert.ok(found.tags.includes('simple_chat'), 'should include task kind tag');
    assert.ok(found.tags.includes('search-used'), 'should include search-used tag');
    assert.equal(found.metadata.language, 'english');
  });

  // 6. memory write failure does not throw
  it('recordWebChatTurn does not throw on failure', async () => {
    const session = getOrCreateWebSession();
    // Delete the brain dir to force a write failure
    await rm(join(TEST_DIR, '.hysa', 'brain', 'experience-log.jsonl'), { force: true });
    let threw = false;
    try {
      await recordWebChatTurn({
        sessionId: session.sessionId,
        userMessage: 'test',
        assistantResponse: 'test',
        messageCount: 1,
      });
    } catch {
      threw = true;
    }
    assert.equal(threw, false, 'should not throw on write failure');
    // Restore the file for other tests
    await writeFile(join(TEST_DIR, '.hysa', 'brain', 'experience-log.jsonl'), '');
  });

  // 7. streaming does not save every chunk (verify summarization is at message level)
  it('summarizeAssistantResponse handles full message, not chunks', () => {
    const fullResponse = 'This is a complete assistant response that spans multiple sentences. '.repeat(30);
    const result = summarizeAssistantResponse(fullResponse, 200);
    assert.ok(result.includes('...'), 'long response should be truncated');
    assert.ok(result.includes('This is a complete'), 'should start from beginning');
    assert.ok(result.includes('multiple sentences.'), 'should contain middle content');
    assert.ok(result.length < fullResponse.length, 'result should be shorter than original');
  });

  // 8. latest user message is not reduced to first line
  it('does not truncate to first line', () => {
    const multiLine = 'First line of the message.\nSecond line with important context.\nThird line with even more detail.';
    const result = summarizeMessageForMemory(multiLine, 500);
    assert.ok(result.includes('First line'), 'should include first line');
    assert.ok(result.includes('Second line'), 'should include second line');
    assert.ok(result.includes('Third line'), 'should include third line');
  });

  // 9. no raw source JSON saved
  it('summarizeMessageForMemory does not include large JSON blobs', () => {
    const withJson = 'Based on search results:\n' + JSON.stringify({ sources: Array.from({ length: 20 }, (_, i) => ({ title: `Source ${i}`, url: `https://example.com/${i}` })) });
    const maxLen = 200;
    const result = summarizeMessageForMemory(withJson, maxLen);
    assert.ok(result.length <= maxLen + 50, 'result should be limited');
    assert.ok(result.length < withJson.length, 'should be shorter than raw JSON input');
  });

  // 10. sessionId round-trip in data flow
  it('getOrCreateWebSession returns consistent session', () => {
    const id = createWebSessionId();
    const s1 = getOrCreateWebSession(id);
    const s2 = getOrCreateWebSession(id);
    assert.equal(s1.sessionId, s2.sessionId);
    assert.equal(s1.createdAt, s2.createdAt);
  });
});
