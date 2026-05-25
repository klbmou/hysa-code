import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const TEST_DIR = join(process.cwd(), '.hysa-test-context');
let origCwd = process.cwd();

async function setupTestBrain(seedData?: boolean): Promise<void> {
  await mkdir(TEST_DIR, { recursive: true });
  process.chdir(TEST_DIR);
  const brainDir = join(TEST_DIR, '.hysa', 'brain');
  await mkdir(brainDir, { recursive: true });

  const nodes: any[] = [];

  if (seedData) {
    const { randomUUID } = await import('node:crypto');
    const now = new Date();
    const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000).toISOString();

    // Decision: use React
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

    // Lesson: Ollama RAM
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

    // Low importance event (should be filtered)
    nodes.push({
      id: randomUUID().slice(0, 8),
      kind: 'event',
      label: 'test_passed:foo-test',
      summary: 'Test foo-test passed',
      createdAt: daysAgo(15),
      importance: 10,
      confidence: 90,
      source: 'command',
      tags: ['test'],
    });
  }

  await writeFile(join(brainDir, 'experience-graph.json'), JSON.stringify({
    version: 2,
    updatedAt: new Date().toISOString(),
    nodes,
    edges: [],
  }));

  await writeFile(join(brainDir, 'experience-log.jsonl'), '');
  await writeFile(join(brainDir, 'lessons.md'), '# Lessons Learned\n\n');
  await writeFile(join(brainDir, 'decisions.md'), '# Design Decisions\n\n');
  await writeFile(join(brainDir, 'README.md'), '# Test Brain\n');
  await writeFile(join(brainDir, 'project-map.json'), JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    importantFiles: {},
    modules: {},
    commands: {},
    knownSystems: [],
  }));
}

async function teardownTestBrain(): Promise<void> {
  process.chdir(origCwd);
  await rm(TEST_DIR, { recursive: true, force: true }).catch(() => {});
}

describe('context-selector', { concurrency: false }, () => {

  // Test 1: simple chat injects no context
  it('simple chat injects no context', async () => {
    await setupTestBrain(true);
    try {
      const { selectContext } = await import('../src/brain/context-selector.js');
      const result = await selectContext({ message: 'hello', taskKind: 'simple_chat', maxItems: 5 });
      assert.equal(result.items.length, 0, 'simple chat should not inject context');
      assert.equal(result.totalChars, 0);
    } finally {
      await teardownTestBrain();
    }
  });

  // Test 2: provider query injects provider memories
  it('provider query injects provider memories', async () => {
    await setupTestBrain(true);
    try {
      const { selectContext } = await import('../src/brain/context-selector.js');
      const result = await selectContext({ message: 'why did the provider fallback fail?', taskKind: 'coding_qa', maxItems: 5 });
      assert.ok(result.items.length > 0, 'provider query should select items');
      // Should have at least one provider-related item
      const providerItems = result.items.filter(i =>
        i.node.kind === 'event' || i.node.label.includes('provider') || i.node.label.includes('ollama') || i.node.label.includes('rate')
      );
      assert.ok(providerItems.length >= 1, 'should include provider-related items');
    } finally {
      await teardownTestBrain();
    }
  });

  // Test 3: code task injects relevant lessons
  it('code task injects relevant lessons/decisions', async () => {
    await setupTestBrain(true);
    try {
      const { selectContext } = await import('../src/brain/context-selector.js');
      const result = await selectContext({ message: 'fix this TypeScript error in React component', taskKind: 'debugging', maxItems: 5 });
      assert.ok(result.items.length > 0, 'code task should select items');
      // Should include TypeScript decision and React decision
      const typeScriptItem = result.items.find(i => i.node.label.includes('TypeScript'));
      const reactItem = result.items.find(i => i.node.label.includes('React'));
      assert.ok(typeScriptItem || reactItem, 'should include relevant decisions');
    } finally {
      await teardownTestBrain();
    }
  });

  // Test 4: token budget is respected
  it('token budget is respected for simple tasks', async () => {
    await setupTestBrain(true);
    try {
      const { selectContext } = await import('../src/brain/context-selector.js');
      const result = await selectContext({ message: 'what decisions did we make about TypeScript?', taskKind: 'coding_qa', maxItems: 5 });
      assert.ok(result.totalChars <= result.budget, `chars ${result.totalChars} should not exceed budget ${result.budget}`);
      assert.ok(result.totalChars > 0, 'should have some chars');
    } finally {
      await teardownTestBrain();
    }
  });

  // Test 5: pinned relevant memory is included
  it('pinned relevant memory is included', async () => {
    await setupTestBrain(true);
    try {
      const { selectContext } = await import('../src/brain/context-selector.js');
      const result = await selectContext({ message: 'what should I use for frontend?', taskKind: 'coding_qa', maxItems: 5 });
      const pinnedItem = result.items.find(i => i.node.pinned);
      assert.ok(pinnedItem, 'should include pinned decision');
      assert.ok(pinnedItem!.node.label.includes('React'), 'pinned should be React decision');
    } finally {
      await teardownTestBrain();
    }
  });

  // Test 6: debug explanation lists included/skipped memories
  it('debug explanation lists included and skipped', async () => {
    await setupTestBrain(true);
    try {
      const { selectContext } = await import('../src/brain/context-selector.js');
      const result = await selectContext({ message: 'fix TypeScript error in React', taskKind: 'debugging', maxItems: 5, debug: true });
      assert.ok(result.debugExplanation.length > 0, 'debug should have explanation');
      assert.ok(result.debugExplanation.includes('Selected'), 'should mention selected count');
      assert.ok(result.debugExplanation.includes('total='), 'should include score breakdown');
    } finally {
      await teardownTestBrain();
    }
  });

  // Test 7: detectComplexity returns correct values
  it('detectComplexity: provider queries', async () => {
    const { detectComplexity } = await import('../src/brain/context-selector.js');
    assert.equal(detectComplexity('coding_qa', 'why did provider fail?'), 'provider');
    assert.equal(detectComplexity('code_edit', 'fix bug in main.ts'), 'code');
    assert.equal(detectComplexity('planning', 'design the architecture'), 'planning');
    assert.equal(detectComplexity('simple_chat', 'hello world'), 'simple');
  });

  // Test 8: formatSelectedContext produces formatted output
  it('formatSelectedContext produces formatted output', async () => {
    await setupTestBrain(true);
    try {
      const { selectContext, formatSelectedContext } = await import('../src/brain/context-selector.js');
      const result = await selectContext({ message: 'what about TypeScript?', taskKind: 'coding_qa', maxItems: 5 });
      const formatted = formatSelectedContext(result);
      if (result.items.length > 0) {
        assert.ok(formatted.includes('[Project Memory]'), 'should have header');
        assert.ok(formatted.includes('[Decision]') || formatted.includes('[Lesson]'), 'should have kind tags');
      }
    } finally {
      await teardownTestBrain();
    }
  });

  // Test 9: no items selected for empty graph
  it('empty graph returns no items', async () => {
    await setupTestBrain(false);
    try {
      const { selectContext } = await import('../src/brain/context-selector.js');
      const result = await selectContext({ message: 'any question at all', taskKind: 'coding_qa', maxItems: 5 });
      assert.equal(result.items.length, 0, 'empty graph should return no items');
    } finally {
      await teardownTestBrain();
    }
  });

  // Test 10: low-confidence provider events are skipped unless provider query
  it('low-confidence events skipped for non-provider queries', async () => {
    await setupTestBrain(true);
    try {
      const { selectContext } = await import('../src/brain/context-selector.js');
      // General code question should not include low-importance test events
      const result = await selectContext({ message: 'how do I write React components?', taskKind: 'coding_qa', maxItems: 5 });
      const lowImportance = result.items.filter(i => (i.node.importance ?? 50) < 20);
      assert.equal(lowImportance.length, 0, 'should not include low-importance events');
    } finally {
      await teardownTestBrain();
    }
  });
});
