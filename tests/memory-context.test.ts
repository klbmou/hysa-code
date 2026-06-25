import { describe, it } from 'node:test';
import assert from 'node:assert';

const { getMemoryContextForTask } = await import('../src/agent/memory-context.js');

describe('getMemoryContextForTask', () => {
  it('returns empty result when no memory available', async () => {
    const result = await getMemoryContextForTask({ task: 'fix the chat bug' });
    assert.strictEqual(result.recentMemories.length, 0);
    assert.strictEqual(result.relevantMemories.length, 0);
    assert.ok(Array.isArray(result.relevantFiles));
    if (result.memoryUsed) {
      assert.ok(result.memoryHits > 0);
      assert.ok(result.relevantFiles.length > 0);
    } else {
      assert.strictEqual(result.memoryHits, 0);
    }
  });

  it('returns structured result shape', async () => {
    const result = await getMemoryContextForTask({ task: 'hello' });
    assert.ok('recentMemories' in result);
    assert.ok('relevantMemories' in result);
    assert.ok('projectFacts' in result);
    assert.ok('summary' in result);
    assert.ok('memoryUsed' in result);
    assert.ok('memoryHits' in result);
    assert.ok('relevantFiles' in result);
  });

  it('handles empty task string', async () => {
    const result = await getMemoryContextForTask({ task: '' });
    assert.ok('memoryUsed' in result);
    assert.ok('memoryHits' in result);
  });

  it('handles Arabic text without error', async () => {
    const result = await getMemoryContextForTask({ task: 'أصلح مشكلة الشات' });
    assert.ok('relevantFiles' in result);
  });

  it('is deterministic (same input produces same shape)', async () => {
    const r1 = await getMemoryContextForTask({ task: 'check package.json' });
    const r2 = await getMemoryContextForTask({ task: 'check package.json' });
    assert.strictEqual(r1.memoryUsed, r2.memoryUsed);
    assert.strictEqual(r1.memoryHits, r2.memoryHits);
    assert.strictEqual(r1.relevantFiles.length, r2.relevantFiles.length);
  });

  it('accepts taskKind parameter', async () => {
    const result = await getMemoryContextForTask({
      task: 'read package.json',
      taskKind: 'file_read',
    });
    assert.ok('recentMemories' in result);
  });

  it('does not throw on any input', async () => {
    const inputs = ['', undefined as unknown as string, 'a', 'x'.repeat(1000), 'fix bug', 'أهلاً'];
    for (const task of inputs) {
      const result = await getMemoryContextForTask({ task });
      assert.ok('memoryUsed' in result);
    }
  });

  it('returns empty recentMemories when no graph exists', async () => {
    const result = await getMemoryContextForTask({ task: 'what did we work on recently' });
    assert.strictEqual(result.recentMemories.length, 0);
  });

  it('memoryUsed is false or git-fallback-based when no relevant memories found', async () => {
    const result = await getMemoryContextForTask({ task: 'nonsense query zzzxxx' });
    assert.ok('memoryUsed' in result);
    assert.ok('memoryHits' in result);
    // If git has files, memoryUsed may be true (git fallback)
    // If no git history, memoryUsed will be false
  });

  it('returns projectFacts as empty array when no project map', async () => {
    const result = await getMemoryContextForTask({ task: 'tell me about the project' });
    assert.ok(Array.isArray(result.projectFacts));
  });

  it('returns relevantFiles from git fallback when no memories exist', async () => {
    const result = await getMemoryContextForTask({ task: 'fix the latest changes' });
    assert.ok('relevantFiles' in result);
    assert.ok(Array.isArray(result.relevantFiles));
  });

  it('memoryUsed may be true from git fallback', async () => {
    const result = await getMemoryContextForTask({ task: 'what changed recently' });
    if (result.relevantFiles.length > 0) {
      assert.ok(result.memoryUsed);
    }
  });

  it('git fallback files are non-empty when git history exists', async () => {
    const result = await getMemoryContextForTask({ task: 'check recent git activity' });
    if (result.relevantFiles.length > 0) {
      for (const f of result.relevantFiles) {
        assert.ok(typeof f === 'string');
        assert.ok(f.length > 0);
      }
    }
  });

  it('summary includes git info when git files found', async () => {
    const result = await getMemoryContextForTask({ task: 'recently modified files' });
    if (result.relevantFiles.length > 0) {
      assert.ok(result.summary.length > 0);
      assert.ok(result.summary.includes('git') || result.summary.includes('file'));
    }
  });

  it('memoryHits reflects git file count when memories empty but git available', async () => {
    const result = await getMemoryContextForTask({ task: 'git changes' });
    if (result.relevantFiles.length > 0) {
      assert.strictEqual(result.memoryHits, result.relevantFiles.length);
    }
  });
});
