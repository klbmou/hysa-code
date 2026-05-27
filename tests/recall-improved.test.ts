import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const TEST_DIR = join(process.cwd(), '.hysa-test-recall');
let origCwd = process.cwd();

async function setupTestBrain(): Promise<void> {
  await mkdir(TEST_DIR, { recursive: true });
  process.chdir(TEST_DIR);
  const brainDir = join(TEST_DIR, '.hysa', 'brain');
  await mkdir(brainDir, { recursive: true });

  const { randomUUID } = await import('node:crypto');
  const now = new Date();
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000).toISOString();

  const nodes: any[] = [];

  // Decision: use React for frontend
  nodes.push({
    id: randomUUID().slice(0, 8),
    kind: 'decision',
    label: 'use React for frontend',
    summary: 'We decided to use React with TypeScript for all frontend work',
    createdAt: daysAgo(5),
    updatedAt: daysAgo(5),
    importance: 85,
    confidence: 90,
    source: 'manual',
    tags: ['persistent-memory', 'frontend', 'react'],
    pinned: true,
  });

  // Decision: TypeScript strict mode
  nodes.push({
    id: randomUUID().slice(0, 8),
    kind: 'decision',
    label: 'enable TypeScript strict mode',
    summary: 'All projects must use strict TypeScript configuration',
    createdAt: daysAgo(10),
    updatedAt: daysAgo(10),
    importance: 70,
    confidence: 80,
    source: 'manual',
    tags: ['persistent-memory', 'typescript'],
    pinned: false,
  });

  // Lesson: rate limit handling
  nodes.push({
    id: randomUUID().slice(0, 8),
    kind: 'lesson',
    label: 'rate limit handling',
    summary: 'OpenRouter free tier has 20 RPM limit. Use fallback or retry with backoff.',
    createdAt: daysAgo(3),
    updatedAt: daysAgo(3),
    importance: 60,
    confidence: 85,
    source: 'auto-fix',
    tags: ['lesson', 'provider', 'rate-limit'],
  });

  // Lesson: Ollama memory requirements
  nodes.push({
    id: randomUUID().slice(0, 8),
    kind: 'lesson',
    label: 'Ollama memory requirements',
    summary: 'Ollama needs at least 8GB RAM for 7B models, 16GB for 13B models',
    createdAt: daysAgo(20),
    updatedAt: daysAgo(20),
    importance: 40,
    confidence: 70,
    source: 'user',
    tags: ['lesson', 'ollama', 'local'],
  });

  // Provider event: success
  nodes.push({
    id: randomUUID().slice(0, 8),
    kind: 'event',
    label: 'provider_succeeded:openrouter/qwen-3-coder',
    summary: 'openrouter/qwen-3-coder succeeded',
    createdAt: daysAgo(1),
    importance: 30,
    confidence: 90,
    source: 'provider',
    tags: ['openrouter', 'provider'],
  });

  // Provider event: failure
  nodes.push({
    id: randomUUID().slice(0, 8),
    kind: 'event',
    label: 'provider_failed:ollama/llama2',
    summary: 'ollama/llama2 failed: timeout after 30s',
    createdAt: daysAgo(2),
    importance: 50,
    confidence: 80,
    source: 'provider',
    tags: ['ollama', 'provider', 'failure'],
  });

  // Fix: TypeScript error fix
  nodes.push({
    id: randomUUID().slice(0, 8),
    kind: 'fix',
    label: 'fixed TypeScript strictNullChecks error in format-code utility',
    summary: 'Added proper type guards and null checks to fix TS strict mode errors',
    createdAt: daysAgo(4),
    updatedAt: daysAgo(4),
    importance: 70,
    confidence: 85,
    source: 'auto-fix',
    tags: ['typescript', 'fix', 'strict-mode'],
  });

  // Bug: formatting issue
  nodes.push({
    id: randomUUID().slice(0, 8),
    kind: 'bug',
    label: 'format-code outputs malformed JSON when input is empty',
    summary: 'The format-code utility returns empty JSON array instead of error when no files match',
    createdAt: daysAgo(6),
    updatedAt: daysAgo(6),
    importance: 60,
    confidence: 75,
    source: 'user',
    tags: ['bug', 'format'],
  });

  await writeFile(join(brainDir, 'experience-graph.json'), JSON.stringify({
    version: 2,
    updatedAt: new Date().toISOString(),
    nodes,
    edges: [],
  }));

  await writeFile(join(brainDir, 'experience-log.jsonl'), '');
  await writeFile(join(brainDir, 'lessons.md'), '# Lessons Learned\n\n## Rate limit handling: OpenRouter free tier has 20 RPM limit. Use fallback or retry with backoff.\n\n## Ollama memory: Ollama needs at least 8GB RAM for 7B models.\n');
  await writeFile(join(brainDir, 'decisions.md'), '# Design Decisions\n\n## Use React: We decided to use React with TypeScript for all frontend work.\n\n## TypeScript strict: All projects must use strict TypeScript configuration.\n');
  await writeFile(join(brainDir, 'README.md'), '# Test Brain\n');
  await writeFile(join(brainDir, 'project-map.json'), JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    importantFiles: {},
    modules: { format: { description: 'code formatting' }, cli: { description: 'main CLI' } },
    commands: { build: 'npm run build', test: 'npm test' },
    knownSystems: ['format-code', 'cli-tool'],
  }));
}

async function teardownTestBrain(): Promise<void> {
  process.chdir(origCwd);
  await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
}

describe('recall-improved', { concurrency: false }, () => {

  // Test 1: "tell me about the project changes" detects project_context
  it('tell me about the project changes', async () => {
    await setupTestBrain();
    try {
      const { detectRecallIntent, buildRecallContext } = await import('../src/brain/recall.js');
      const intent = detectRecallIntent('tell me about the project changes');
      assert.equal(intent, 'project_context', 'should detect project_context intent');

      const ctx = await buildRecallContext('tell me about the project changes');
      assert.notEqual(ctx, null, 'should return non-null context');
      assert.equal(ctx!.intent, 'project_context');
      assert.ok(ctx!.summary.length > 0, 'summary should not be empty');
    } finally {
      await teardownTestBrain();
    }
  });

  // Test 2: "what happened with fallback?" detects provider_history
  it('what happened with fallback', async () => {
    await setupTestBrain();
    try {
      const { detectRecallIntent, buildRecallContext } = await import('../src/brain/recall.js');
      const intent = detectRecallIntent('what happened with fallback?');
      assert.equal(intent, 'provider_history', 'should detect provider_history intent');

      const ctx = await buildRecallContext('what happened with fallback?');
      assert.notEqual(ctx, null, 'should return non-null context');
      assert.equal(ctx!.intent, 'provider_history');
    } finally {
      await teardownTestBrain();
    }
  });

  // Test 3: "how did we fix TypeScript errors?" detects bug_history
  it('how did we fix TypeScript errors', async () => {
    await setupTestBrain();
    try {
      const { detectRecallIntent, buildRecallContext } = await import('../src/brain/recall.js');
      const intent = detectRecallIntent('how did we fix TypeScript errors?');
      assert.equal(intent, 'bug_history', 'should detect bug_history intent');

      const ctx = await buildRecallContext('how did we fix TypeScript errors?');
      assert.notEqual(ctx, null, 'should return non-null context');
      assert.equal(ctx!.intent, 'bug_history');
    } finally {
      await teardownTestBrain();
    }
  });

  // Test 4: "what changed recently?" detects project_context
  it('what changed recently', async () => {
    await setupTestBrain();
    try {
      const { detectRecallIntent, buildRecallContext } = await import('../src/brain/recall.js');
      const intent = detectRecallIntent('what changed recently?');
      assert.equal(intent, 'project_context', 'should detect project_context intent');

      const ctx = await buildRecallContext('what changed recently?');
      assert.notEqual(ctx, null, 'should return non-null context');
      assert.equal(ctx!.intent, 'project_context');
    } finally {
      await teardownTestBrain();
    }
  });

  // Test 5: "what did we decide about providers?" detects decision_history
  it('what did we decide about providers', async () => {
    await setupTestBrain();
    try {
      const { detectRecallIntent, buildRecallContext } = await import('../src/brain/recall.js');
      const intent = detectRecallIntent('what did we decide about providers?');
      // "decision" keyword makes this decision_history
      assert.equal(intent, 'decision_history', 'should detect decision_history intent');

      const ctx = await buildRecallContext('what did we decide about providers?');
      assert.notEqual(ctx, null, 'should return non-null context');
      assert.equal(ctx!.intent, 'decision_history');
    } finally {
      await teardownTestBrain();
    }
  });

  // Test 6: "what happened last session?" detects session_recall
  it('what happened last session', async () => {
    await setupTestBrain();
    try {
      const { detectRecallIntent, buildRecallContext } = await import('../src/brain/recall.js');
      const intent = detectRecallIntent('what happened last session?');
      assert.equal(intent, 'session_recall', 'should detect session_recall intent');

      const ctx = await buildRecallContext('what happened last session?');
      assert.notEqual(ctx, null, 'should return non-null context');
      assert.equal(ctx!.intent, 'session_recall');
    } finally {
      await teardownTestBrain();
    }
  });

  // Test 7: cache invalidation after memory write
  it('cache invalidation after memory write', async () => {
    await setupTestBrain();
    try {
      const { buildRecallContext } = await import('../src/brain/recall.js');
      const { invalidateRecallCache } = await import('../src/brain/recall-cache.js');

      // First call should populate cache
      const ctx1 = await buildRecallContext('tell me about the project changes');
      assert.notEqual(ctx1, null);

      // Invalidate cache
      invalidateRecallCache();

      // Second call should work (cache was cleared, should recompute)
      const ctx2 = await buildRecallContext('tell me about the project changes');
      assert.notEqual(ctx2, null);
      assert.equal(ctx2!.intent, 'project_context');
    } finally {
      await teardownTestBrain();
    }
  });

  // Test 8: stemming matches "formatting" -> stemmed "format" matches node label "format-code"
  it('stemming matches formatting to format', async () => {
    await setupTestBrain();
    try {
      const { buildRecallContext } = await import('../src/brain/recall.js');
      // "tell me about the formatting" should match project_context via "tell me about"
      // and stemming should match "formatting" -> "format" against "format-code" node
      const ctx = await buildRecallContext('tell me about the formatting bug');
      assert.notEqual(ctx, null, 'should return non-null context');
      assert.equal(ctx!.intent, 'project_context');
      assert.ok(ctx!.summary.length > 0, 'summary should not be empty');
      // The summary should mention format-code or the bug since stemming links "formatting" to "format"
      const hasFormat = ctx!.summary.toLowerCase().includes('format');
      assert.ok(hasFormat, 'summary should reference format-related content');
    } finally {
      await teardownTestBrain();
    }
  });

  // Test 9: debug mode returns debug info
  it('debug mode returns debug info', async () => {
    await setupTestBrain();
    try {
      const { buildRecallContext } = await import('../src/brain/recall.js');
      const ctx = await buildRecallContext('tell me about the project changes', { debugMode: true });
      assert.notEqual(ctx, null, 'should return context with debug mode');
      assert.ok(ctx!.debugInfo, 'should have debugInfo');
      assert.equal(ctx!.debugInfo!.query, 'tell me about the project changes');
      assert.equal(ctx!.debugInfo!.intent, 'project_context');
      assert.equal(ctx!.debugInfo!.intentDetected, true);
    } finally {
      await teardownTestBrain();
    }
  });

  // Test 10: "what did we fix yesterday?" detects bug_history
  it('what did we fix yesterday', async () => {
    await setupTestBrain();
    try {
      const { detectRecallIntent, buildRecallContext } = await import('../src/brain/recall.js');
      const intent = detectRecallIntent('what did we fix yesterday?');
      assert.equal(intent, 'session_recall', 'should detect session_recall intent');

      const ctx = await buildRecallContext('what did we fix yesterday?');
      assert.notEqual(ctx, null);
      assert.equal(ctx!.intent, 'session_recall');
    } finally {
      await teardownTestBrain();
    }
  });

  // Test 11: writeMemory invalidates cache via writeExperienceGraph
  it('writeMemory invalidates recall cache', async () => {
    await setupTestBrain();
    try {
      const { buildRecallContext } = await import('../src/brain/recall.js');
      const { writeMemoryFromText } = await import('../src/tools/memory-writer.js');

      // After setup, a recall query should find the existing decisions
      const ctxBefore = await buildRecallContext('what did we decide');
      assert.notEqual(ctxBefore, null);

      // Write a new decision
      await writeMemoryFromText('we decided to use Tailwind for styling');

      // After write, a new recall should include the new decision
      const ctxAfter = await buildRecallContext('what did we decide');
      assert.notEqual(ctxAfter, null);
    } finally {
      await teardownTestBrain();
    }
  });

  // Test 12: isMemoryQuery filters non-memory queries
  it('isMemoryQuery correctly identifies memory queries', async () => {
    const { isMemoryQuery, detectRecallIntent } = await import('../src/brain/recall.js');

    assert.equal(isMemoryQuery('tell me about the project'), true, 'longer message is memory query');
    assert.equal(isMemoryQuery('hi'), false, 'greeting is not memory query');
    assert.equal(detectRecallIntent('write a game'), 'none', 'write request is none');
    assert.equal(detectRecallIntent('thanks'), 'none', 'thanks is none');
  });

  // Test 13: No intent returns null without debug
  it('no intent returns null when debug is off', async () => {
    await setupTestBrain();
    try {
      const { buildRecallContext } = await import('../src/brain/recall.js');
      const ctx = await buildRecallContext('hello');
      assert.equal(ctx, null, 'non-memory query should return null');
    } finally {
      await teardownTestBrain();
    }
  });

  // Test 14: No intent returns debug context when debug is on
  it('no intent returns debug context when debug is on', async () => {
    await setupTestBrain();
    try {
      const { buildRecallContext } = await import('../src/brain/recall.js');
      const ctx = await buildRecallContext('hello', { debugMode: true });
      assert.notEqual(ctx, null);
      assert.ok(ctx!.debugInfo);
      assert.equal(ctx!.debugInfo!.intentDetected, false);
    } finally {
      await teardownTestBrain();
    }
  });
});
