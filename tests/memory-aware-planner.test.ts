import { describe, it } from 'node:test';
import assert from 'node:assert';

const { planToolActionsForTask, resetActionCounter } = await import('../src/agent/tool-planner.js');
import type { MemoryContextResult } from '../src/agent/memory-context.js';

function makeMemoryContext(overrides: Partial<MemoryContextResult> = {}): MemoryContextResult {
  return {
    recentMemories: [],
    relevantMemories: [],
    projectFacts: [],
    summary: '',
    memoryUsed: false,
    memoryHits: 0,
    relevantFiles: [],
    ...overrides,
  };
}

describe('memory-aware planner', () => {
  it('produces plan without memory context (backward compat)', () => {
    resetActionCounter();
    const plan = planToolActionsForTask({ userText: 'hello' });
    assert.ok(plan);
    assert.strictEqual(plan.taskKind, 'simple_chat');
    assert.strictEqual(plan.actions.length, 0);
  });

  it('plan has memoryUsed field when memoryContext provided', () => {
    resetActionCounter();
    const memCtx = makeMemoryContext({ memoryUsed: true, memoryHits: 3 });
    const plan = planToolActionsForTask({
      userText: 'fix the chat bug',
      memoryContext: memCtx,
    });
    assert.ok('memoryUsed' in plan);
    assert.ok('memoryHits' in plan);
    assert.ok('memoryReasoning' in plan);
  });

  it('memoryUsed is false when memoryContext has no hits', () => {
    resetActionCounter();
    const memCtx = makeMemoryContext({ memoryUsed: false, memoryHits: 0 });
    const plan = planToolActionsForTask({
      userText: 'check package.json',
      memoryContext: memCtx,
    });
    assert.strictEqual(plan.memoryUsed, false);
    assert.strictEqual(plan.memoryHits, 0);
  });

  it('memoryHits appears in plan output', () => {
    resetActionCounter();
    const memCtx = makeMemoryContext({ memoryUsed: true, memoryHits: 5 });
    const plan = planToolActionsForTask({
      userText: 'read file src/index.ts',
      memoryContext: memCtx,
    });
    assert.strictEqual(plan.memoryHits, 5);
  });

  it('memoryReasoning contains explanation when files provided', () => {
    resetActionCounter();
    const memCtx = makeMemoryContext({
      memoryUsed: true,
      memoryHits: 2,
      relevantFiles: ['src/web/api.ts', 'src/agent/tool-planner.ts'],
    });
    const plan = planToolActionsForTask({
      userText: 'fix the chat bug',
      memoryContext: memCtx,
    });
    assert.ok(plan.memoryReasoning);
    assert.ok(plan.memoryReasoning.includes('src/web/api.ts'));
    assert.ok(plan.memoryReasoning.includes('Prioritizing'));
  });

  it('prioritizes memory files over list_files for code_edit', () => {
    resetActionCounter();
    const memCtx = makeMemoryContext({
      memoryUsed: true,
      memoryHits: 1,
      relevantFiles: ['src/web/api.ts', 'src/web/chat.ts'],
    });
    const plan = planToolActionsForTask({
      userText: 'fix the chat bug',
      memoryContext: memCtx,
    });
    const fileActions = plan.actions.filter(a => a.toolName === 'read_file');
    const memFiles = fileActions.filter(a =>
      a.input.path === 'src/web/api.ts' || a.input.path === 'src/web/chat.ts'
    );
    assert.ok(memFiles.length > 0, 'Should propose reading memory-suggested files');
    assert.ok(
      fileActions.some(a => a.reason.includes('Memory')),
      'Read_file reason should mention memory'
    );
  });

  it('prioritizes memory files over list_files for file_read', () => {
    resetActionCounter();
    const memCtx = makeMemoryContext({
      memoryUsed: true,
      memoryHits: 2,
      relevantFiles: ['src/config/keys.ts'],
    });
    const plan = planToolActionsForTask({
      userText: 'show the configuration file',
      memoryContext: memCtx,
    });
    const readFileActions = plan.actions.filter(a => a.toolName === 'read_file');
    const hasMemFile = readFileActions.some(a => a.input.path === 'src/config/keys.ts');
    assert.ok(hasMemFile, 'Should read memory-suggested file');
    const hasListFiles = plan.actions.some(a => a.toolName === 'list_files');
    assert.ok(!hasListFiles, 'Should not fall back to list_files when memory has files');
  });

  it('prioritizes memory files over list_files for debug_error', () => {
    resetActionCounter();
    const memCtx = makeMemoryContext({
      memoryUsed: true,
      memoryHits: 1,
      relevantFiles: ['src/utils/logger.ts'],
    });
    const plan = planToolActionsForTask({
      userText: 'debug the error in src/utils/logger.ts',
      memoryContext: memCtx,
    });
    const readFileActions = plan.actions.filter(a => a.toolName === 'read_file');
    const hasMemFile = readFileActions.some(a => a.input.path === 'src/utils/logger.ts');
    assert.ok(hasMemFile, 'Should read memory-suggested file for debug');
  });

  it('falls back to list_files when memoryContext has no relevantFiles', () => {
    resetActionCounter();
    const memCtx = makeMemoryContext({ memoryUsed: true, memoryHits: 0, relevantFiles: [] });
    const plan = planToolActionsForTask({
      userText: 'fix the chat bug',
      memoryContext: memCtx,
    });
    const listFiles = plan.actions.filter(a => a.toolName === 'list_files');
    assert.ok(listFiles.length > 0, 'Should fall back to list_files');
  });

  it('memoryReasoning mentions memory checked but no hits', () => {
    resetActionCounter();
    const memCtx = makeMemoryContext({ memoryUsed: true, memoryHits: 0 });
    const plan = planToolActionsForTask({
      userText: 'hello',
      memoryContext: memCtx,
    });
    assert.ok(plan.memoryReasoning);
    assert.ok(plan.memoryReasoning.includes('no relevant'));
  });

  it('memoryReasoning undefined when no memoryContext', () => {
    resetActionCounter();
    const plan = planToolActionsForTask({ userText: 'hello' });
    assert.strictEqual(plan.memoryReasoning, undefined);
    assert.strictEqual(plan.memoryUsed, undefined);
    assert.strictEqual(plan.memoryHits, undefined);
  });

  it('memoryUsed propagates through multi-step agent', async () => {
    resetActionCounter();
    const { executeMultiStepPlan } = await import('../src/agent/multi-step-agent.js');
    const result = await executeMultiStepPlan({
      userText: 'hello',
      source: 'test',
      maxIterations: 1,
    });
    assert.ok('memoryUsed' in result);
    assert.ok('memoryHits' in result);
  });

  it('is deterministic with same memory input', () => {
    resetActionCounter();
    const memCtx1 = makeMemoryContext({
      memoryUsed: true,
      memoryHits: 2,
      relevantFiles: ['src/web/api.ts'],
    });
    resetActionCounter();
    const plan1 = planToolActionsForTask({
      userText: 'fix chat bug',
      memoryContext: memCtx1,
    });

    resetActionCounter();
    const memCtx2 = makeMemoryContext({
      memoryUsed: true,
      memoryHits: 2,
      relevantFiles: ['src/web/api.ts'],
    });
    resetActionCounter();
    const plan2 = planToolActionsForTask({
      userText: 'fix chat bug',
      memoryContext: memCtx2,
    });

    assert.strictEqual(plan1.actions.length, plan2.actions.length);
    assert.strictEqual(plan1.memoryUsed, plan2.memoryUsed);
    assert.strictEqual(plan1.memoryHits, plan2.memoryHits);
    for (let i = 0; i < plan1.actions.length; i++) {
      assert.strictEqual(plan1.actions[i].toolName, plan2.actions[i].toolName);
      assert.strictEqual(plan1.actions[i].input.path, plan2.actions[i].input.path);
    }
  });

  it('memory does not override user-specified files', () => {
    resetActionCounter();
    const memCtx = makeMemoryContext({
      memoryUsed: true,
      memoryHits: 2,
      relevantFiles: ['src/web/old.ts'],
    });
    const plan = planToolActionsForTask({
      userText: 'fix the bug in src/web/new.ts',
      memoryContext: memCtx,
    });
    const userFileAction = plan.actions.find(a => a.input.path === 'src/web/new.ts');
    assert.ok(userFileAction, 'User-specified file should still be included');
  });

  it('memory files are filtered for path traversal', () => {
    resetActionCounter();
    const memCtx = makeMemoryContext({
      memoryUsed: true,
      memoryHits: 1,
      relevantFiles: ['/etc/passwd', '../secret', 'src/web/safe.ts'],
    });
    const plan = planToolActionsForTask({
      userText: 'fix the project structure',
      memoryContext: memCtx,
    });
    const fileActions = plan.actions.filter(a => a.toolName === 'read_file');
    const safeAction = fileActions.find(a => a.input.path === 'src/web/safe.ts');
    assert.ok(safeAction, 'Safe path should be included');
    const traversalAction = fileActions.find(a => a.input.path === '/etc/passwd');
    assert.ok(!traversalAction, 'Traversal paths should be excluded');
  });
});
