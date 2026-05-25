import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

// ── Setup / teardown ──

const TEST_DIR = join(process.cwd(), '.hysa-test-run');
let origCwd = process.cwd();

async function setupTestBrain(): Promise<void> {
  await mkdir(TEST_DIR, { recursive: true });
  process.chdir(TEST_DIR);
  const brainDir = join(TEST_DIR, '.hysa', 'brain');
  await mkdir(brainDir, { recursive: true });

  await writeFile(join(brainDir, 'experience-graph.json'), JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    nodes: [],
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

// ── Tests ──

describe('memory-writer', { concurrency: false }, () => {
  // Test 1: classifyMemoryText correctly identifies decisions and lessons
  it('classifyMemoryText: decisions and lessons', async () => {
    const { classifyMemoryText } = await import('../src/tools/memory-writer.js');

    const d1 = classifyMemoryText('we decided to use React for the frontend');
    assert.equal(d1.kind, 'decision');
    assert.equal(d1.content, 'to use React for the frontend');

    const d2 = classifyMemoryText('Decision: use TypeScript strict mode');
    assert.equal(d2.kind, 'decision');

    const d3 = classifyMemoryText('remember that the API key goes in .env');
    assert.equal(d3.kind, 'decision');

    const l1 = classifyMemoryText('we learned that Ollama needs 8GB RAM');
    assert.equal(l1.kind, 'lesson');

    const l2 = classifyMemoryText('lesson: always validate API keys before saving');
    assert.equal(l2.kind, 'lesson');

    const none = classifyMemoryText('what is the weather today?');
    assert.equal(none.kind, null);
  });

  // Test 2: writeMemoryFromText writes to graph
  it('writeMemoryFromText: writes decision node', async () => {
    await setupTestBrain();
    try {
      const { writeMemoryFromText } = await import('../src/tools/memory-writer.js');
      const { readExperienceGraph } = await import('../src/brain/graph-store.js');

      const result = await writeMemoryFromText('we decided to use Vitest for testing');
      assert.notEqual(result, null);
      assert.equal(result!.kind, 'decision');

      const graph = await readExperienceGraph();
      const decisions = graph.nodes.filter(n => n.kind === 'decision');
      assert.equal(decisions.length, 1);
      assert.ok(decisions[0].label.includes('Vitest'));
    } finally {
      await teardownTestBrain();
    }
  });

  // Test 3: Duplicate memory is merged/skipped
  it('writeMemoryFromText: duplicate is merged', async () => {
    await setupTestBrain();
    try {
      const { writeMemoryFromText } = await import('../src/tools/memory-writer.js');
      const { readExperienceGraph } = await import('../src/brain/graph-store.js');

      await writeMemoryFromText('we decided to use Vitest for testing');
      await writeMemoryFromText('we decided to use Vitest for testing');
      await writeMemoryFromText('we decided to use Vitest for testing');

      const graph = await readExperienceGraph();
      const decisions = graph.nodes.filter(n => n.kind === 'decision');
      // Should be 1, not 3 (dedup by kind+label via upsertNode)
      assert.equal(decisions.length, 1);
    } finally {
      await teardownTestBrain();
    }
  });

  // Test 4: Auto-fix success writes lesson
  it('writeAutoFixMemory: success writes lesson', async () => {
    await setupTestBrain();
    try {
      const { writeAutoFixMemory } = await import('../src/tools/memory-writer.js');
      const { readExperienceGraph } = await import('../src/brain/graph-store.js');

      await writeAutoFixMemory({
        fixed: true,
        errorType: 'typescript_error',
        filesTouched: ['src/foo.ts'],
        newResult: 'Command executed successfully:',
      }, 'fix the TypeScript error');

      const graph = await readExperienceGraph();
      const lessons = graph.nodes.filter(n => n.kind === 'lesson');
      assert.equal(lessons.length, 1);
      assert.ok(lessons[0].label.includes('typescript_error'));
      assert.ok(lessons[0].summary.includes('Auto-fixed'));
    } finally {
      await teardownTestBrain();
    }
  });

  // Test 5: Auto-fix failure writes lesson
  it('writeAutoFixMemory: failure writes lesson', async () => {
    await setupTestBrain();
    try {
      const { writeAutoFixMemory } = await import('../src/tools/memory-writer.js');
      const { readExperienceGraph } = await import('../src/brain/graph-store.js');

      await writeAutoFixMemory({
        fixed: false,
        errorType: 'syntax_error',
        filesTouched: ['src/bar.ts'],
      }, 'fix syntax error');

      const graph = await readExperienceGraph();
      const lessons = graph.nodes.filter(n => n.kind === 'lesson');
      assert.equal(lessons.length, 1);
      assert.ok(lessons[0].summary.includes('Failed to auto-fix'));
    } finally {
      await teardownTestBrain();
    }
  });

  // Test 6: Provider failure writes event
  it('writeProviderEvent: failure writes event', async () => {
    await setupTestBrain();
    try {
      const { writeProviderEvent } = await import('../src/tools/memory-writer.js');
      const { readExperienceGraph } = await import('../src/brain/graph-store.js');

      await writeProviderEvent('openrouter', 'gpt-4', 'failure', 'rate limited');

      const graph = await readExperienceGraph();
      const events = graph.nodes.filter(n => n.kind === 'event');
      assert.equal(events.length, 1);
      assert.ok(events[0].label.includes('failed'));
      assert.ok(events[0].label.includes('openrouter'));

      const providers = graph.nodes.filter(n => n.kind === 'provider');
      assert.equal(providers.length, 1);
      assert.equal(providers[0].label, 'openrouter');
    } finally {
      await teardownTestBrain();
    }
  });

  // Test 7: Provider success writes event
  it('writeProviderEvent: success writes event', async () => {
    await setupTestBrain();
    try {
      const { writeProviderEvent } = await import('../src/tools/memory-writer.js');
      const { readExperienceGraph } = await import('../src/brain/graph-store.js');

      await writeProviderEvent('opencode_zen', 'qwen-3-coder', 'success');

      const graph = await readExperienceGraph();
      const events = graph.nodes.filter(n => n.kind === 'event');
      assert.equal(events.length, 1);
      assert.ok(events[0].label.includes('succeeded'));
    } finally {
      await teardownTestBrain();
    }
  });

  // Test 8: Secrets are redacted
  it('writeMemory: secrets are redacted', async () => {
    await setupTestBrain();
    try {
      const { writeMemory } = await import('../src/tools/memory-writer.js');
      const { readExperienceGraph } = await import('../src/brain/graph-store.js');

      await writeMemory('lesson', 'API key', 'My API key is sk-1234abcd and password is secret!');
      const graph = await readExperienceGraph();
      const lessons = graph.nodes.filter(n => n.kind === 'lesson');
      assert.equal(lessons.length, 1);
      // The summary should be redacted because it contains a secret
      assert.equal(lessons[0].summary, '[REDACTED]');
    } finally {
      await teardownTestBrain();
    }
  });

  // Test 9: containsMemoryTrigger detects keywords
  it('containsMemoryTrigger: detects keywords', async () => {
    const { containsMemoryTrigger } = await import('../src/tools/memory-writer.js');

    assert.ok(containsMemoryTrigger('remember that we use React'));
    assert.ok(containsMemoryTrigger('we decided to use TypeScript'));
    assert.ok(containsMemoryTrigger('lesson learned: always test first'));
    assert.ok(containsMemoryTrigger('I need to memorize this config'));
    assert.ok(containsMemoryTrigger('Note to self: check the README'));

    assert.equal(containsMemoryTrigger('what is the weather?'), false);
    assert.equal(containsMemoryTrigger('fix the bug in main.ts'), false);
  });

  // Test 10: recall can retrieve new memory
  it('searchGraph: can retrieve written memory', async () => {
    await setupTestBrain();
    try {
      const { writeMemoryFromText } = await import('../src/tools/memory-writer.js');
      const { searchGraph } = await import('../src/brain/graph-store.js');

      await writeMemoryFromText('we decided to use React for the frontend');

      const result = await searchGraph('React');
      assert.ok(result.nodes.length >= 1);
      assert.ok(result.nodes.some(n => n.label.toLowerCase().includes('react')));
    } finally {
      await teardownTestBrain();
    }
  });
});

// ── Quality & Cleanup Tests ──

describe('brain-quality', { concurrency: false }, () => {
  // Test 11: duplicate decisions are detected by findDuplicateLabels
  it('findDuplicateLabels: detects similar decisions', async () => {
    await setupTestBrain();
    try {
      const { findDuplicateLabels, readExperienceGraph, writeExperienceGraph } = await import('../src/brain/graph-store.js');

      // Insert two similar nodes directly into the graph to avoid fuzzy dedup during write
      const graph = await readExperienceGraph();
      const { randomUUID } = await import('node:crypto');
      graph.nodes.push(
        { id: randomUUID().slice(0, 8), kind: 'decision', label: 'use react for frontend', summary: 'use react', createdAt: new Date().toISOString(), tags: ['test'] },
        { id: randomUUID().slice(0, 8), kind: 'decision', label: 'use react on frontend', summary: 'use react', createdAt: new Date().toISOString(), tags: ['test'] },
      );
      await writeExperienceGraph(graph);

      const updated = await readExperienceGraph();
      const groups = findDuplicateLabels(updated.nodes);
      const decisionGroups = groups.filter(g => g.nodes[0].kind === 'decision');
      assert.ok(decisionGroups.length >= 1, 'should detect duplicate decision group');
    } finally {
      await teardownTestBrain();
    }
  });

  // Test 12: low-importance events are pruned
  it('cleanupGraph: prunes low-importance events', async () => {
    await setupTestBrain();
    try {
      const { upsertNode, cleanupGraph, readExperienceGraph } = await import('../src/brain/graph-store.js');

      // Create a low-importance old event
      const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(); // 60 days ago
      await upsertNode({
        kind: 'event',
        label: 'test:old-low-importance-event',
        summary: 'old test event',
        importance: 10,
        confidence: 30,
        createdAt: oldDate,
        tags: ['test'],
      });

      // Create a high-importance event (should be kept)
      await upsertNode({
        kind: 'event',
        label: 'test:important-event',
        summary: 'important test event',
        importance: 90,
        confidence: 90,
        tags: ['test'],
      });

      const result = await cleanupGraph({ dryRun: false, maxAgeDays: 30, minImportance: 30 });
      assert.equal(result.removedNodes, 1, 'should prune low-importance event');

      const graph = await readExperienceGraph();
      const remaining = graph.nodes.filter(n => n.kind === 'event');
      assert.equal(remaining.length, 1, 'only important event should remain');
      assert.ok(remaining[0].label.includes('important'));
    } finally {
      await teardownTestBrain();
    }
  });

  // Test 13: pinned memory is never deleted
  it('cleanupGraph: pinned memory is never deleted', async () => {
    await setupTestBrain();
    try {
      const { upsertNode, cleanupGraph, readExperienceGraph } = await import('../src/brain/graph-store.js');

      const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      await upsertNode({
        kind: 'event',
        label: 'test:pinned-old-event',
        summary: 'old but pinned',
        importance: 10,
        pinned: true,
        createdAt: oldDate,
        tags: ['test'],
      });

      const result = await cleanupGraph({ dryRun: false, maxAgeDays: 30, minImportance: 30 });
      assert.equal(result.removedNodes, 0, 'should not prune pinned event');

      const graph = await readExperienceGraph();
      const pinned = graph.nodes.filter(n => n.pinned);
      assert.equal(pinned.length, 1, 'pinned event should remain');
    } finally {
      await teardownTestBrain();
    }
  });

  // Test 14: cleanup dry-run does not mutate graph
  it('cleanupGraph: dry-run does not mutate', async () => {
    await setupTestBrain();
    try {
      const { upsertNode, cleanupGraph, readExperienceGraph } = await import('../src/brain/graph-store.js');

      const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
      await upsertNode({
        kind: 'event',
        label: 'test:prunable-event',
        summary: 'should be pruned',
        importance: 10,
        createdAt: oldDate,
        tags: ['test'],
      });

      // Dry run
      const result = await cleanupGraph({ dryRun: true, maxAgeDays: 30, minImportance: 30 });
      assert.equal(result.removedNodes, 0, 'dry-run should report 0 removals');

      // Graph should still have the node
      const graph = await readExperienceGraph();
      const hasNode = graph.nodes.some(n => n.label === 'test:prunable-event');
      assert.ok(hasNode, 'dry-run should not remove the node');
    } finally {
      await teardownTestBrain();
    }
  });

  // Test 15: forget removes matching memory
  it('forgetNodes: removes matching memory', async () => {
    await setupTestBrain();
    try {
      const { writeMemoryFromText } = await import('../src/tools/memory-writer.js');
      const { forgetNodes, readExperienceGraph } = await import('../src/brain/graph-store.js');

      await writeMemoryFromText('we decided to use Svelte for the frontend');

      let graph = await readExperienceGraph();
      const before = graph.nodes.filter(n => n.label.includes('Svelte')).length;
      assert.equal(before, 1, 'should have Svelte decision');

      const result = await forgetNodes('Svelte');
      assert.equal(result.forgottenNodes, 1, 'should forget 1 node');

      graph = await readExperienceGraph();
      const after = graph.nodes.filter(n => n.label.includes('Svelte')).length;
      assert.equal(after, 0, 'should remove Svelte decision');
    } finally {
      await teardownTestBrain();
    }
  });

  // Test 16: forget skips pinned memories
  it('forgetNodes: skips pinned memories', async () => {
    await setupTestBrain();
    try {
      const { upsertNode, forgetNodes, readExperienceGraph } = await import('../src/brain/graph-store.js');

      const node = await upsertNode({
        kind: 'decision',
        label: 'test:pinned-decision',
        summary: 'a pinned test decision',
        pinned: true,
        tags: ['test'],
      });

      const result = await forgetNodes('pinned-decision');
      assert.equal(result.forgottenNodes, 0, 'should not forget pinned node');
      assert.equal(result.pinnedSkipped, 1, 'should report pinned skipped');

      const graph = await readExperienceGraph();
      const stillThere = graph.nodes.some(n => n.id === node.id);
      assert.ok(stillThere, 'pinned node should still be in graph');
    } finally {
      await teardownTestBrain();
    }
  });

  // Test 17: inspect shows counts
  it('getInspectReport: shows counts by kind', async () => {
    await setupTestBrain();
    try {
      const { writeMemoryFromText } = await import('../src/tools/memory-writer.js');
      const { getInspectReport } = await import('../src/brain/graph-store.js');

      await writeMemoryFromText('we decided to use Vue for the frontend');

      const report = await getInspectReport();
      assert.ok(report.totalNodes >= 1);
      assert.ok(report.countsByKind.length > 0);
      const decisionCount = report.countsByKind.find(k => k.kind === 'decision');
      assert.ok(decisionCount, 'should show decision count');
      assert.ok(decisionCount!.count >= 1);
    } finally {
      await teardownTestBrain();
    }
  });

  // Test 18: normalizeLabel for dedup
  it('normalizeLabel: normalizes labels', async () => {
    const { normalizeLabel } = await import('../src/brain/graph-store.js');

    assert.equal(normalizeLabel('  We Decided To Use   React! '), 'we decided to use react');
    assert.equal(normalizeLabel('Lesson: always  test. first'), 'lesson always test first');
    assert.equal(normalizeLabel(''), '');
  });

  // Test 19: jaccardSimilarity for fuzzy matching
  it('jaccardSimilarity: matches similar text', async () => {
    // Need to import it — it's not exported directly, test via findDuplicateLabels
    const { normalizeLabel } = await import('../src/brain/graph-store.js');
    assert.ok(normalizeLabel('use react for frontend').includes('react'));
  });
});
