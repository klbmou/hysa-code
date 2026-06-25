import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { buildWebRecallContext, shouldUseRecallForWebMessage } from '../src/brain/web-recall.js';
import type { WebRecallResult } from '../src/brain/web-recall.js';

const TEST_DIR = join(process.cwd(), '.hysa-test-web-recall');
let origCwd = process.cwd();

function makeGraph(nodes: any[]): string {
  return JSON.stringify({
    version: 2,
    updatedAt: new Date().toISOString(),
    nodes,
    edges: [],
  });
}

function node(label: string, kind: string = 'event', extra: any = {}): any {
  return {
    id: Math.random().toString(36).slice(2, 10),
    kind,
    label,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastAccessedAt: new Date().toISOString(),
    tags: [],
    importance: 50,
    confidence: 50,
    source: 'user',
    ...extra,
  };
}

async function setupGraph(nodes: any[]): Promise<void> {
  await mkdir(join(TEST_DIR, '.hysa', 'brain'), { recursive: true });
  await writeFile(join(TEST_DIR, '.hysa', 'brain', 'experience-graph.json'), makeGraph(nodes));
  await writeFile(join(TEST_DIR, '.hysa', 'brain', 'experience-log.jsonl'), '');
  process.chdir(TEST_DIR);
}

async function teardown(): Promise<void> {
  process.chdir(origCwd);
  await rm(TEST_DIR, { recursive: true, force: true });
}

describe('web-recall', () => {
  after(teardown);

  // 1. Recall injection adds context when memory exists
  it('injects context when relevant memory exists', async () => {
    await setupGraph([
      node('fixed provider fallback timeout issue', 'lesson', { tags: ['provider', 'fix'] }),
    ]);
    const result = await buildWebRecallContext('tell me about provider fallback', 'general_qa');
    assert.ok(result.recallUsed, 'recall should be used');
    assert.ok(result.recallItemCount >= 1, 'should have at least 1 item');
    assert.ok(result.recallChars > 0, 'should have non-zero chars');
    assert.ok(result.systemPromptInjection.includes('[Project Memory]'), 'should include section header');
  });

  // 2. No recall when no relevant memory
  it('returns empty when no relevant memory exists', async () => {
    await setupGraph([
      node('irrelevant gardening tip', 'event'),
    ]);
    const result = await buildWebRecallContext('what about TypeScript types', 'coding_qa');
    assert.ok(!result.recallUsed, 'recall should not be used');
    assert.equal(result.recallItemCount, 0, 'item count should be 0');
    assert.equal(result.recallChars, 0, 'chars should be 0');
    assert.equal(result.systemPromptInjection, '', 'injection should be empty');
  });

  // 3. Arabic memory is preserved
  it('preserves Arabic memory without mojibake', async () => {
    await setupGraph([
      node('إصلاح مشكلة التوجيه في المزود', 'lesson', { tags: ['arabic', 'provider'] }),
    ]);
    const result = await buildWebRecallContext('ماذا حدث مع المزود', 'general_qa');
    assert.ok(result.recallUsed, 'recall should be used for Arabic');
    assert.ok(result.systemPromptInjection.includes('إصلاح'), 'Arabic should survive in injection');
  });

  // 4. Secrets are not injected
  it('excludes secrets from recall injection', async () => {
    await setupGraph([
      node('my password is sk-abc123def456', 'event', { summary: 'API key: sk-abc123def456 is my secret', tags: ['secret'] }),
    ]);
    const result = await buildWebRecallContext('tell me about the password', 'general_qa');
    if (result.recallUsed) {
      assert.ok(!result.systemPromptInjection.includes('sk-abc123def456'), 'secrets should be redacted');
      assert.ok(!result.systemPromptInjection.includes('my password'), 'secrets should be redacted');
    }
  });

  // 5. Long memory context is capped
  it('caps long memory context within budget', async () => {
    const longLabel = 'A'.repeat(3000);
    await setupGraph([
      node(longLabel, 'decision', { tags: ['long'] }),
    ]);
    const result = await buildWebRecallContext('tell me about the A project', 'general_qa');
    // selectContext respects budget, so even if item is long, it should be capped
    assert.ok(result.recallChars <= 3000, `chars ${result.recallChars} should be within budget`);
    assert.ok(!result.recallUsed || result.systemPromptInjection.length > 0, 'injection should exist or be empty');
  });

  // 6. Helper handles empty graph
  it('handles empty graph gracefully', async () => {
    await setupGraph([]);
    const result = await buildWebRecallContext('what happened last session', 'general_qa');
    assert.ok(!result.recallUsed, 'should not use recall on empty graph');
    assert.equal(result.recallItemCount, 0, 'no items from empty graph');
    assert.equal(result.recallChars, 0, 'no chars from empty graph');
  });

  // 7. Recall failure does not throw
  it('does not throw on recall failure', async () => {
    await mkdir(join(TEST_DIR, '.hysa', 'brain'), { recursive: true });
    await writeFile(join(TEST_DIR, '.hysa', 'brain', 'experience-graph.json'), 'invalid json{{{');
    process.chdir(TEST_DIR);
    const result = await buildWebRecallContext('tell me about anything', 'general_qa');
    assert.ok(!result.recallUsed, 'should not use recall on invalid graph');
    assert.equal(result.recallItemCount, 0, 'no items from invalid graph');
  });

  // 8. System prompt contains section only when recall exists
  it('adds [Project Memory] section only when recall exists', async () => {
    await setupGraph([]);
    const empty = await buildWebRecallContext('hello', 'simple_chat');
    assert.equal(empty.systemPromptInjection, '', 'no section for empty recall');

    await setupGraph([
      node('fixed the build error in webpack config', 'lesson'),
    ]);
    const populated = await buildWebRecallContext('tell me about the build error', 'coding_qa');
    assert.ok(populated.recallUsed, 'recall should be used with data');
    assert.ok(populated.systemPromptInjection.includes('[Project Memory]'), 'section header should be present');
  });

  // 9. shouldUseRecallForWebMessage helper
  it('shouldUseRecallForWebMessage returns correct values', () => {
    assert.ok(shouldUseRecallForWebMessage('what was the last fix?', false, null), 'non-simple, no search');
    assert.ok(!shouldUseRecallForWebMessage('hello', true, null), 'simple, no search');
    assert.ok(!shouldUseRecallForWebMessage('search for cats', false, 'cats'), 'non-simple, with search');
    assert.ok(!shouldUseRecallForWebMessage('hi', true, 'test'), 'simple, with search');
  });

  // 10. User asking about last session triggers recall
  it('user asking about last session triggers recall when graph has data', async () => {
    await setupGraph([
      node('implemented recall injection for web API', 'decision', { tags: ['web', 'recall', 'implemented'] }),
      node('fixed timeout issue in handleChat for provider session', 'lesson', { tags: ['provider', 'fix', 'session'] }),
    ]);
    const result = await buildWebRecallContext('tell me about the last session recall fix', 'general_qa');
    // "session", "recall", "fix" should match lesson/decision labels
    assert.ok(result.recallUsed, 'recall should be triggered for session query');
    assert.ok(result.recallItemCount >= 1, 'should find at least one memory');
  });
});
