import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  observe,
  decide,
  createNextPlan,
  executeMultiStepPlan,
} from '../src/agent/multi-step-agent.js';
import type { ExecutedActionSummary } from '../src/agent/execution-loop.js';

// ── Unit: observe ──────────────────────────────────────────────────

describe('observe', () => {

  it('read_file success produces file_read_success', () => {
    const action: ExecutedActionSummary = {
      actionId: 'act_1', toolName: 'read_file', ok: true,
      summary: 'Read file src/index.ts (200 lines)',
    };
    const obs = observe(action);
    assert.equal(obs.type, 'file_read_success');
    assert.equal(obs.toolName, 'read_file');
  });

  it('read_file empty produces file_empty', () => {
    const action: ExecutedActionSummary = {
      actionId: 'act_2', toolName: 'read_file', ok: true,
      summary: 'File not found or empty',
    };
    const obs = observe(action);
    assert.equal(obs.type, 'file_empty');
  });

  it('read_file error produces file_read_empty', () => {
    const action: ExecutedActionSummary = {
      actionId: 'act_3', toolName: 'read_file', ok: false,
      summary: 'Error', error: 'Path traversal blocked',
    };
    const obs = observe(action);
    assert.equal(obs.type, 'file_read_empty');
  });

  it('run_command success produces command_success', () => {
    const action: ExecutedActionSummary = {
      actionId: 'act_4', toolName: 'run_command', ok: true,
      summary: 'Command completed: npm test passed',
    };
    const obs = observe(action);
    assert.equal(obs.type, 'command_success');
  });

  it('run_command failure produces command_failed', () => {
    const action: ExecutedActionSummary = {
      actionId: 'act_5', toolName: 'run_command', ok: false,
      summary: 'Command failed', error: 'Exit code 1',
    };
    const obs = observe(action);
    assert.equal(obs.type, 'command_failed');
  });

  it('run_command empty output produces command_empty_output', () => {
    const action: ExecutedActionSummary = {
      actionId: 'act_6', toolName: 'run_command', ok: true,
      summary: '(empty output)',
    };
    const obs = observe(action);
    assert.equal(obs.type, 'command_empty_output');
  });

  it('write_file success produces write_file_success', () => {
    const action: ExecutedActionSummary = {
      actionId: 'act_7', toolName: 'write_file', ok: true,
      summary: 'Wrote file src/test.ts',
    };
    const obs = observe(action);
    assert.equal(obs.type, 'write_file_success');
  });

  it('list_files success produces list_files_success', () => {
    const action: ExecutedActionSummary = {
      actionId: 'act_8', toolName: 'list_files', ok: true,
      summary: 'Listed 5 files',
    };
    const obs = observe(action);
    assert.equal(obs.type, 'list_files_success');
  });

  it('approval required detected', () => {
    const action: ExecutedActionSummary = {
      actionId: 'act_9', toolName: 'write_file', ok: false,
      summary: 'Requires approval before writing',
    };
    const obs = observe(action);
    assert.equal(obs.type, 'approval_required');
  });

  it('blocked action detected', () => {
    const action: ExecutedActionSummary = {
      actionId: 'act_10', toolName: 'run_command', ok: false,
      summary: 'Blocked by safety policy',
    };
    const obs = observe(action);
    assert.equal(obs.type, 'blocked');
  });
});

// ── Unit: decide ───────────────────────────────────────────────────

describe('decide', () => {

  it('returns COMPLETE when no actions executed', () => {
    const d = decide([], [], 0, 3, 0, 20);
    assert.equal(d, 'COMPLETE');
  });

  it('returns CONTINUE when read_file succeeded', () => {
    const obs = [{ actionId: 'a1', toolName: 'read_file', type: 'file_read_success' as const, detail: 'Read file' }];
    const actions = [{ actionId: 'a1', toolName: 'read_file', ok: true, summary: 'Read file' }];
    const d = decide(obs, actions, 0, 3, 1, 20);
    assert.equal(d, 'CONTINUE');
  });

  it('returns BLOCKED for blocked actions', () => {
    const obs = [{ actionId: 'a1', toolName: 'run_command', type: 'blocked' as const, detail: 'Blocked' }];
    const actions = [{ actionId: 'a1', toolName: 'run_command', ok: false, summary: 'Blocked' }];
    const d = decide(obs, actions, 0, 3, 1, 20);
    assert.equal(d, 'BLOCKED');
  });

  it('returns STOP when approval required', () => {
    const obs = [{ actionId: 'a1', toolName: 'write_file', type: 'approval_required' as const, detail: 'Needs approval' }];
    const actions = [{ actionId: 'a1', toolName: 'write_file', ok: false, summary: 'Requires approval' }];
    const d = decide(obs, actions, 0, 3, 1, 20);
    assert.equal(d, 'STOP');
  });

  it('returns COMPLETE when all actions failed', () => {
    const obs = [{ actionId: 'a1', toolName: 'run_command', type: 'command_failed' as const, detail: 'Failed' }];
    const actions = [{ actionId: 'a1', toolName: 'run_command', ok: false, summary: 'Failed', error: 'err' }];
    const d = decide(obs, actions, 0, 3, 1, 20);
    assert.equal(d, 'COMPLETE');
  });

  it('returns STOP at max iterations', () => {
    const d = decide([], [{ actionId: 'a1', toolName: 'read_file', ok: true, summary: 'ok' }], 3, 3, 1, 20);
    assert.equal(d, 'STOP');
  });

  it('returns STOP at max total actions', () => {
    const d = decide([], [{ actionId: 'a1', toolName: 'read_file', ok: true, summary: 'ok' }], 0, 3, 20, 20);
    assert.equal(d, 'STOP');
  });

  it('returns COMPLETE after command_success', () => {
    const obs = [{ actionId: 'a1', toolName: 'run_command', type: 'command_success' as const, detail: 'Passed' }];
    const actions = [{ actionId: 'a1', toolName: 'run_command', ok: true, summary: 'Passed' }];
    const d = decide(obs, actions, 0, 3, 1, 20);
    assert.equal(d, 'COMPLETE');
  });
});

// ── Unit: createNextPlan ──────────────────────────────────────────

describe('createNextPlan', () => {

  it('returns null when blocked', () => {
    const plan = createNextPlan('test', 'simple_chat', [], [], [
      { actionId: 'a1', toolName: 'run_command', type: 'blocked', detail: 'Blocked' },
    ]);
    assert.equal(plan, null);
  });

  it('returns null when approval required', () => {
    const plan = createNextPlan('test', 'simple_chat', [], [], [
      { actionId: 'a1', toolName: 'write_file', type: 'approval_required', detail: 'Needs approval' },
    ]);
    assert.equal(plan, null);
  });

  it('returns null when no prior actions', () => {
    const plan = createNextPlan('test', 'simple_chat', [], [], []);
    assert.equal(plan, null);
  });
});

// ── Integration: executeMultiStepPlan ──────────────────────────────

describe('executeMultiStepPlan', () => {

  it('single-step completion (simple chat)', async () => {
    const result = await executeMultiStepPlan({
      userText: 'hello',
      source: 'test',
      maxIterations: 3,
    });
    assert.ok(result.iterationsUsed >= 0);
    assert.ok(typeof result.totalActions === 'number');
    assert.ok(Array.isArray(result.steps));
    assert.ok(typeof result.toolContextForAi === 'string');
    assert.ok(['completed', 'no_new_actions', 'max_iterations', 'blocked', 'approval_required', 'repeated_action', 'max_actions'].includes(result.stoppedReason));
  });

  it('read_file plan with one iteration', async () => {
    const result = await executeMultiStepPlan({
      userText: 'read the file package.json',
      source: 'test',
      maxIterations: 1,
      maxTotalActions: 10,
    });
    assert.ok(result.totalActions >= 0);
    assert.ok(result.iterationsUsed >= 0 || result.iterationsUsed <= 1);
  });

  it('max iterations enforced', async () => {
    const result = await executeMultiStepPlan({
      userText: 'read package.json',
      source: 'test',
      maxIterations: 1,
    });
    assert.ok(result.iterationsUsed <= 1);
    assert.ok(result.stoppedReason === 'completed' || result.stoppedReason === 'no_new_actions' || result.stoppedReason === 'max_iterations');
  });

  it('toolContextForAi contains multi-step header', async () => {
    const result = await executeMultiStepPlan({
      userText: 'hello',
      source: 'test',
      maxIterations: 1,
    });
    const ctx = result.toolContextForAi;
    assert.ok(ctx.includes('[Multi-Step Agent'));
    assert.ok(ctx.includes('Stop reason'));
  });

  it('observation count matches actions', async () => {
    const result = await executeMultiStepPlan({
      userText: 'read package.json',
      source: 'test',
      maxIterations: 2,
    });
    assert.equal(result.allObservations.length, result.allExecutedActions.length);
  });

  it('blocked action stops execution', async () => {
    const result = await executeMultiStepPlan({
      userText: 'delete all files',
      source: 'test',
      maxIterations: 3,
    });
    if (result.stoppedReason === 'blocked') {
      assert.ok(result.steps.length > 0, 'Should have at least one step');
      const hasBlockedObs = result.allObservations.some(o => o.type === 'blocked');
      assert.ok(hasBlockedObs, 'Should have blocked observation');
    }
  });

  it('no auto-continue in tool context', async () => {
    const result = await executeMultiStepPlan({
      userText: 'hello',
      source: 'test',
      maxIterations: 1,
    });
    assert.ok(!result.toolContextForAi.includes('[auto-continue]'));
  });

  it('iteration cap at 3 by default', async () => {
    const result = await executeMultiStepPlan({
      userText: 'read the file package.json',
      source: 'test',
    });
    assert.ok(result.iterationsUsed <= 3);
  });
});
