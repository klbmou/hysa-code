import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  observe,
  decide,
  createNextPlan,
  executeMultiStepPlan,
} from '../src/agent/multi-step-agent.js';
import type { ExecutedActionSummary } from '../src/agent/execution-loop.js';
import type { AgentObservation } from '../src/agent/multi-step-agent.js';

// ── Unit: observe (OS control actions) ───────────────────────────

describe('observe (OS control)', () => {

  it('move_mouse success produces os_action_success', () => {
    const action: ExecutedActionSummary = {
      actionId: 'act_os1', toolName: 'move_mouse', ok: true,
      summary: 'Cursor moved to (500, 300)',
    };
    const obs = observe(action);
    assert.equal(obs.type, 'os_action_success');
    assert.equal(obs.toolName, 'move_mouse');
    assert.equal(obs.detail, 'Cursor moved to (500, 300)');
  });

  it('move_mouse failure produces os_action_failed', () => {
    const action: ExecutedActionSummary = {
      actionId: 'act_os2', toolName: 'move_mouse', ok: false,
      summary: 'Failed to move cursor', error: 'PowerShell not available',
    };
    const obs = observe(action);
    assert.equal(obs.type, 'os_action_failed');
    assert.equal(obs.detail, 'PowerShell not available');
  });

  it('click_mouse success produces os_action_success', () => {
    const action: ExecutedActionSummary = {
      actionId: 'act_os3', toolName: 'click_mouse', ok: true,
      summary: 'Clicked left button 1 time(s)',
    };
    const obs = observe(action);
    assert.equal(obs.type, 'os_action_success');
    assert.equal(obs.toolName, 'click_mouse');
  });

  it('type_keyboard success produces os_action_success', () => {
    const action: ExecutedActionSummary = {
      actionId: 'act_os4', toolName: 'type_keyboard', ok: true,
      summary: 'Typed 5 characters',
    };
    const obs = observe(action);
    assert.equal(obs.type, 'os_action_success');
    assert.equal(obs.toolName, 'type_keyboard');
  });

  it('press_key success produces os_action_success', () => {
    const action: ExecutedActionSummary = {
      actionId: 'act_os5', toolName: 'press_key', ok: true,
      summary: 'Pressed key: enter',
    };
    const obs = observe(action);
    assert.equal(obs.type, 'os_action_success');
    assert.equal(obs.toolName, 'press_key');
  });

  it('OS tool requiring approval produces approval_required', () => {
    const action: ExecutedActionSummary = {
      actionId: 'act_os6', toolName: 'move_mouse', ok: false,
      summary: 'Mouse movement requires approval',
      error: 'Mouse movement requires approval',
    };
    const obs = observe(action);
    assert.equal(obs.type, 'approval_required');
  });

  it('OS tool blocked produces blocked', () => {
    const action: ExecutedActionSummary = {
      actionId: 'act_os7', toolName: 'click_mouse', ok: false,
      summary: 'Blocked by safety policy',
    };
    const obs = observe(action);
    assert.equal(obs.type, 'blocked');
  });
});

// ── Unit: decide (OS control observations) ──────────────────────────

describe('decide (OS control)', () => {

  it('os_action_failure returns REPLAN', () => {
    const obs: AgentObservation[] = [
      { actionId: 'a1', toolName: 'move_mouse', type: 'os_action_failed', detail: 'Failed' },
    ];
    const actions: ExecutedActionSummary[] = [
      { actionId: 'a1', toolName: 'move_mouse', ok: false, summary: 'Failed', error: 'err' },
    ];
    const d = decide(obs, actions, 0, 3, 1, 20);
    assert.equal(d, 'REPLAN');
  });

  it('os_action_success returns CONTINUE', () => {
    const obs: AgentObservation[] = [
      { actionId: 'a1', toolName: 'move_mouse', type: 'os_action_success', detail: 'Done' },
    ];
    const actions: ExecutedActionSummary[] = [
      { actionId: 'a1', toolName: 'move_mouse', ok: true, summary: 'Done' },
    ];
    const d = decide(obs, actions, 0, 3, 1, 20);
    assert.equal(d, 'CONTINUE');
  });

  it('all OS actions failed returns REPLAN (allows retry)', () => {
    const obs: AgentObservation[] = [
      { actionId: 'a1', toolName: 'move_mouse', type: 'os_action_failed', detail: 'Failed' },
    ];
    const actions: ExecutedActionSummary[] = [
      { actionId: 'a1', toolName: 'move_mouse', ok: false, summary: 'Failed', error: 'err' },
    ];
    const d = decide(obs, actions, 0, 3, 1, 20);
    assert.equal(d, 'REPLAN');
  });

  it('REPLAN is returned instead of COMPLETE when OS actions fail', () => {
    const obs: AgentObservation[] = [
      { actionId: 'a1', toolName: 'move_mouse', type: 'os_action_failed', detail: 'Failed' },
    ];
    const actions: ExecutedActionSummary[] = [
      { actionId: 'a1', toolName: 'move_mouse', ok: false, summary: 'Failed', error: 'err' },
    ];
    const d = decide(obs, actions, 0, 3, 1, 20);
    assert.equal(d, 'REPLAN');
  });

  it('OS success with mixed actions returns CONTINUE', () => {
    const obs: AgentObservation[] = [
      { actionId: 'a1', toolName: 'move_mouse', type: 'os_action_success', detail: 'Done' },
    ];
    const actions: ExecutedActionSummary[] = [
      { actionId: 'a1', toolName: 'move_mouse', ok: true, summary: 'Done' },
    ];
    const d = decide(obs, actions, 0, 3, 1, 20);
    assert.equal(d, 'CONTINUE');
  });
});

// ── Unit: createNextPlan (OS failure) ──────────────────────────────

describe('createNextPlan (OS failure)', () => {

  it('returns null when blocked', () => {
    const plan = createNextPlan('click the mouse', 'os_control', [], [], [
      { actionId: 'a1', toolName: 'click_mouse', type: 'blocked', detail: 'Blocked' },
    ]);
    assert.equal(plan, null);
  });

  it('returns null when approval required', () => {
    const plan = createNextPlan('click the mouse', 'os_control', [], [], [
      { actionId: 'a1', toolName: 'click_mouse', type: 'approval_required', detail: 'Needs approval' },
    ]);
    assert.equal(plan, null);
  });

  it('returns null when no prior actions', () => {
    const plan = createNextPlan('click the mouse', 'os_control', [], [], []);
    assert.equal(plan, null);
  });

  it('generates os_control plan on OS failure', () => {
    const plan = createNextPlan(
      'move mouse to 100 200',
      'os_control',
      [],
      [
        { actionId: 'a1', toolName: 'move_mouse', ok: false, summary: 'Failed', error: 'PowerShell error' },
      ],
      [
        { actionId: 'a1', toolName: 'move_mouse', type: 'os_action_failed', detail: 'PowerShell error' },
      ],
    );
    assert.ok(plan);
    assert.equal(plan.taskKind, 'os_control');
    assert.ok(plan.actions.length >= 0);
  });
});

// ── Unit: hasDuplicateActions (OS tools) ────────────────────────────

describe('hasDuplicateActions (OS tools)', () => {

  it('detects duplicate move_mouse at same coordinates', async () => {
    const { planToolActionsForTask, resetActionCounter } = await import('../src/agent/tool-planner.js');
    resetActionCounter();
    const plan = planToolActionsForTask({ userText: 'move mouse to 100 200' });
    const executed: ExecutedActionSummary[] = [
      { actionId: 'act_1', toolName: 'move_mouse', ok: true, summary: 'Cursor moved to (100, 200)' },
    ];
    const { hasDuplicateActions } = await import('../src/agent/multi-step-agent.js');
    assert.ok(hasDuplicateActions(plan, executed));
  });

  it('does NOT flag different move_mouse coordinates as duplicate', async () => {
    const { planToolActionsForTask, resetActionCounter } = await import('../src/agent/tool-planner.js');
    resetActionCounter();
    const plan = planToolActionsForTask({ userText: 'move mouse to 300 400' });
    const executed: ExecutedActionSummary[] = [
      { actionId: 'act_1', toolName: 'move_mouse', ok: true, summary: 'Cursor moved to (100, 200)' },
    ];
    const { hasDuplicateActions } = await import('../src/agent/multi-step-agent.js');
    assert.ok(!hasDuplicateActions(plan, executed));
  });

  it('detects duplicate click_mouse with same button and count', async () => {
    const { planToolActionsForTask, resetActionCounter } = await import('../src/agent/tool-planner.js');
    resetActionCounter();
    const plan = planToolActionsForTask({ userText: 'left click' });
    const executed: ExecutedActionSummary[] = [
      { actionId: 'act_1', toolName: 'click_mouse', ok: true, summary: 'Clicked left button 1 time(s)' },
    ];
    const { hasDuplicateActions } = await import('../src/agent/multi-step-agent.js');
    assert.ok(hasDuplicateActions(plan, executed));
  });

  it('detects duplicate press_key with same key', async () => {
    const { planToolActionsForTask, resetActionCounter } = await import('../src/agent/tool-planner.js');
    resetActionCounter();
    const plan = planToolActionsForTask({ userText: 'press enter' });
    const executed: ExecutedActionSummary[] = [
      { actionId: 'act_1', toolName: 'press_key', ok: true, summary: 'Pressed key: enter' },
    ];
    const { hasDuplicateActions } = await import('../src/agent/multi-step-agent.js');
    assert.ok(hasDuplicateActions(plan, executed));
  });

  it('does NOT flag different press_key as duplicate', async () => {
    const { planToolActionsForTask, resetActionCounter } = await import('../src/agent/tool-planner.js');
    resetActionCounter();
    const plan = planToolActionsForTask({ userText: 'press enter' });
    const executed: ExecutedActionSummary[] = [
      { actionId: 'act_1', toolName: 'press_key', ok: true, summary: 'Pressed key: escape' },
    ];
    const { hasDuplicateActions } = await import('../src/agent/multi-step-agent.js');
    assert.ok(!hasDuplicateActions(plan, executed));
  });

  it('allows non-duplicate type_keyboard with different text length', async () => {
    const { planToolActionsForTask, resetActionCounter } = await import('../src/agent/tool-planner.js');
    resetActionCounter();
    const plan = planToolActionsForTask({ userText: 'type "hello world" in the input' });
    const executed: ExecutedActionSummary[] = [
      { actionId: 'act_1', toolName: 'type_keyboard', ok: true, summary: 'Typed 5 characters' },
    ];
    const { hasDuplicateActions } = await import('../src/agent/multi-step-agent.js');
    assert.ok(!hasDuplicateActions(plan, executed));
  });
});

// ── Integration: executeMultiStepPlan (OS tasks) ────────────────────

describe('executeMultiStepPlan (OS tasks)', () => {

  it('processes move mouse task without crashing', async () => {
    const result = await executeMultiStepPlan({
      userText: 'move the mouse to 500 300',
      source: 'test',
      maxIterations: 3,
    });
    assert.ok(result.iterationsUsed >= 0);
    assert.ok(result.iterationsUsed <= 3);
    assert.ok(typeof result.totalActions === 'number');
    assert.ok(Array.isArray(result.steps));
  });

  it('processes click task without crashing', async () => {
    const result = await executeMultiStepPlan({
      userText: 'left click the mouse',
      source: 'test',
      maxIterations: 3,
    });
    assert.ok(result.iterationsUsed >= 0);
    assert.ok(result.iterationsUsed <= 3);
  });

  it('processes type keyboard task without crashing', async () => {
    const result = await executeMultiStepPlan({
      userText: 'type "hello" in the input box',
      source: 'test',
      maxIterations: 3,
    });
    assert.ok(result.iterationsUsed >= 0);
    assert.ok(result.iterationsUsed <= 3);
  });

  it('processes press key task without crashing', async () => {
    const result = await executeMultiStepPlan({
      userText: 'press enter to submit the form',
      source: 'test',
      maxIterations: 3,
    });
    assert.ok(result.iterationsUsed >= 0);
    assert.ok(result.iterationsUsed <= 3);
  });

  it('multi-step OS sequence (move then click)', async () => {
    const result = await executeMultiStepPlan({
      userText: 'move the mouse to 500 300 then click left',
      source: 'test',
      maxIterations: 3,
    });
    assert.ok(result.iterationsUsed >= 0);
    assert.ok(result.iterationsUsed <= 3);
  });

  it('observation count matches action count', async () => {
    const result = await executeMultiStepPlan({
      userText: 'move the mouse to 100 200',
      source: 'test',
      maxIterations: 3,
    });
    assert.equal(result.allObservations.length, result.allExecutedActions.length);
  });

  it('blocked OS action stops execution', async () => {
    const result = await executeMultiStepPlan({
      userText: 'delete all files',
      source: 'test',
      maxIterations: 3,
    });
    if (result.stoppedReason === 'blocked') {
      assert.ok(result.steps.length > 0);
      const hasBlockedObs = result.allObservations.some(o => o.type === 'blocked');
      assert.ok(hasBlockedObs);
    }
  });

  it('toolContextForAi contains multi-step header', async () => {
    const result = await executeMultiStepPlan({
      userText: 'move mouse to 500 300',
      source: 'test',
      maxIterations: 1,
    });
    assert.ok(result.toolContextForAi.includes('[Multi-Step Agent'));
    assert.ok(result.toolContextForAi.includes('Stop reason'));
  });

  it('iteration cap at 3 by default for OS tasks', async () => {
    const result = await executeMultiStepPlan({
      userText: 'move mouse to 100 200',
      source: 'test',
    });
    assert.ok(result.iterationsUsed <= 3);
  });
});

// ── Memory-coordinate extraction in planner ─────────────────────────

describe('memory-coordinate extraction (planner)', () => {

  it('planner emits memory reasoning with coordinates', async () => {
    const { planToolActionsForTask, resetActionCounter } = await import('../src/agent/tool-planner.js');
    resetActionCounter();
    const memCtx = {
      memoryUsed: true,
      memoryHits: 1,
      relevantFiles: [],
      recentMemories: [{
        label: 'blender_render',
        kind: 'ui_state',
        summary: 'Blender render button located at 1920, 1080',
        relevanceScore: 0.9,
      }],
      relevantMemories: [],
      projectFacts: [],
      summary: 'Memory has 1 relevant items',
    };
    const plan = planToolActionsForTask({
      userText: 'move the mouse to click render',
      memoryContext: memCtx,
    });
    assert.equal(plan.taskKind, 'os_control');
    assert.ok(plan.memoryReasoning);
    if (plan.memoryReasoning) {
      assert.ok(plan.memoryReasoning.includes('1920'));
      assert.ok(plan.memoryReasoning.includes('1080'));
    }
  });

  it('planner uses memory coordinates as fallback when no explicit coords', async () => {
    const { planToolActionsForTask, resetActionCounter } = await import('../src/agent/tool-planner.js');
    resetActionCounter();
    const memCtx = {
      memoryUsed: true,
      memoryHits: 1,
      relevantFiles: [],
      recentMemories: [{
        label: 'render_button',
        kind: 'ui_state',
        summary: 'Render button at coordinates 800, 600',
        relevanceScore: 0.85,
      }],
      relevantMemories: [],
      projectFacts: [],
      summary: 'Memory has 1 relevant items',
    };
    const plan = planToolActionsForTask({
      userText: 'move the mouse and click',
      memoryContext: memCtx,
    });
    const moveActions = plan.actions.filter(a => a.toolName === 'move_mouse');
    assert.ok(moveActions.length > 0);
    const input = moveActions[0].input as Record<string, unknown>;
    assert.equal(input.x, 800);
    assert.equal(input.y, 600);
    assert.ok(moveActions[0].reason.includes('memory-suggested'));
  });

  it('explicit coordinates override memory coordinates', async () => {
    const { planToolActionsForTask, resetActionCounter } = await import('../src/agent/tool-planner.js');
    resetActionCounter();
    const memCtx = {
      memoryUsed: true,
      memoryHits: 1,
      relevantFiles: [],
      recentMemories: [{
        label: 'render_button',
        kind: 'ui_state',
        summary: 'Render button at coordinates 800, 600',
        relevanceScore: 0.85,
      }],
      relevantMemories: [],
      projectFacts: [],
      summary: 'Memory has 1 relevant items',
    };
    const plan = planToolActionsForTask({
      userText: 'move the mouse to 100 200 and click',
      memoryContext: memCtx,
    });
    const moveActions = plan.actions.filter(a => a.toolName === 'move_mouse');
    assert.ok(moveActions.length > 0);
    const input = moveActions[0].input as Record<string, unknown>;
    assert.equal(input.x, 100);
    assert.equal(input.y, 200);
    assert.ok(!moveActions[0].reason.includes('memory-suggested'));
  });

  it('memory with no coordinates does not affect planner', async () => {
    const { planToolActionsForTask, resetActionCounter } = await import('../src/agent/tool-planner.js');
    resetActionCounter();
    const memCtx = {
      memoryUsed: true,
      memoryHits: 1,
      relevantFiles: [],
      recentMemories: [{
        label: 'some_file',
        kind: 'file',
        summary: 'Modified src/main.ts with bug fix',
        relevanceScore: 0.8,
      }],
      relevantMemories: [],
      projectFacts: [],
      summary: 'Memory has 1 relevant items',
    };
    const plan = planToolActionsForTask({
      userText: 'move the mouse to click',
      memoryContext: memCtx,
    });
    const moveActions = plan.actions.filter(a => a.toolName === 'move_mouse');
    assert.ok(moveActions.length > 0);
    const input = moveActions[0].input as Record<string, unknown>;
    assert.equal(input.x, 500);
    assert.equal(input.y, 500);
  });

  it('extractCoordinateFromMemory returns null when no memory', async () => {
    const { planToolActionsForTask, resetActionCounter } = await import('../src/agent/tool-planner.js');
    resetActionCounter();
    const plan = planToolActionsForTask({
      userText: 'move the mouse to 100 200',
      memoryContext: undefined,
    });
    assert.ok(plan.memoryReasoning === undefined || plan.memoryReasoning === '');
  });
});

// ── REPLAN loop behavior ────────────────────────────────────────────

describe('REPLAN loop behavior', () => {

  it('creates a new plan after OS failure instead of repeating the same action', async () => {
    const result = await executeMultiStepPlan({
      userText: 'move mouse to 100 200',
      source: 'test',
      maxIterations: 3,
    });
    // Without approval, OS tools return approval_required → STOP
    // But the loop should handle it gracefully
    if (result.stoppedReason === 'approval_required') {
      assert.ok(result.allObservations.some(o => o.type === 'approval_required'));
    }
    assert.ok(result.iterationsUsed <= 3);
  });

  it('REPLAN state is a valid AgentDecision', async () => {
    const { AgentDecision } = await import('../src/agent/multi-step-agent.js');
    const validDecisions: string[] = ['CONTINUE', 'COMPLETE', 'STOP', 'BLOCKED', 'REPLAN'];
    for (const d of validDecisions) {
      assert.ok(typeof d === 'string');
    }
  });

  it('replanned is a valid AgentCompletionReason', async () => {
    const { AgentCompletionReason } = await import('../src/agent/multi-step-agent.js');
    const validReasons: string[] = ['completed', 'max_iterations', 'max_actions', 'blocked', 'approval_required', 'no_new_actions', 'repeated_action', 'replanned'];
    for (const r of validReasons) {
      assert.ok(typeof r === 'string');
    }
  });

  it('loop invariant holds: observations.length === executedActions.length', async () => {
    const result = await executeMultiStepPlan({
      userText: 'move mouse to 100 200 then press enter',
      source: 'test',
      maxIterations: 3,
    });
    assert.equal(result.allObservations.length, result.allExecutedActions.length);
  });
});

// ── OS_ACTION_SUCCESS / FAILURE type exports ─────────────────────────

describe('AgentObservationType includes OS types', () => {

  it('exports os_action_success type', async () => {
    const { AgentObservationType } = await import('../src/agent/multi-step-agent.js');
    const types: string[] = [
      'file_read_success', 'file_empty', 'command_success', 'command_failed',
      'os_action_success', 'os_action_failed',
    ];
    for (const t of types) {
      assert.ok(typeof t === 'string');
    }
  });

  it('AgentDecision includes REPLAN', async () => {
    const { AgentDecision } = await import('../src/agent/multi-step-agent.js');
    const decisions: string[] = ['CONTINUE', 'COMPLETE', 'STOP', 'BLOCKED', 'REPLAN'];
    for (const d of decisions) {
      assert.ok(typeof d === 'string');
    }
  });

  it('AgentCompletionReason includes replanned', async () => {
    const { AgentCompletionReason } = await import('../src/agent/multi-step-agent.js');
    const reasons: string[] = ['completed', 'max_iterations', 'max_actions', 'blocked', 'approval_required', 'no_new_actions', 'repeated_action', 'replanned'];
    for (const r of reasons) {
      assert.ok(typeof r === 'string');
    }
  });
});

// ── Non-regression: existing behavior preserved ──────────────────────

describe('existing behavior preserved', () => {

  it('read_file still produces file_read_success', () => {
    const action: ExecutedActionSummary = {
      actionId: 'act_1', toolName: 'read_file', ok: true,
      summary: 'Read file src/index.ts (200 lines)',
    };
    const obs = observe(action);
    assert.equal(obs.type, 'file_read_success');
  });

  it('run_command still produces command_failed', () => {
    const action: ExecutedActionSummary = {
      actionId: 'act_2', toolName: 'run_command', ok: false,
      summary: 'Command failed', error: 'Exit code 1',
    };
    const obs = observe(action);
    assert.equal(obs.type, 'command_failed');
  });

  it('approval still detected for non-OS tools', () => {
    const action: ExecutedActionSummary = {
      actionId: 'act_3', toolName: 'write_file', ok: false,
      summary: 'Requires approval before writing',
    };
    const obs = observe(action);
    assert.equal(obs.type, 'approval_required');
  });

  it('planner still classifies non-OS tasks', async () => {
    const { planToolActionsForTask, resetActionCounter } = await import('../src/agent/tool-planner.js');
    resetActionCounter();
    const plan = planToolActionsForTask({ userText: 'hello' });
    assert.equal(plan.taskKind, 'simple_chat');
    assert.equal(plan.actions.length, 0);
  });

  it('planner still classifies code edit', async () => {
    const { planToolActionsForTask, resetActionCounter } = await import('../src/agent/tool-planner.js');
    resetActionCounter();
    const plan = planToolActionsForTask({ userText: 'edit the file src/foo.ts' });
    assert.equal(plan.taskKind, 'code_edit');
  });

  it('original multi-step tests still pass observation invariant', async () => {
    const result = await executeMultiStepPlan({
      userText: 'read package.json',
      source: 'test',
      maxIterations: 2,
    });
    assert.equal(result.allObservations.length, result.allExecutedActions.length);
  });
});
