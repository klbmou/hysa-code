import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';

describe('OS Control Tools', () => {
  describe('registration', () => {
    it('registers os control tools', async () => {
      const { listTools } = await import('../src/tools/registry.js');
      const names = listTools().map(t => t.name).sort();
      assert.ok(names.includes('move_mouse'));
      assert.ok(names.includes('click_mouse'));
      assert.ok(names.includes('type_keyboard'));
      assert.ok(names.includes('press_key'));
    });

    it('move_mouse tool has correct metadata', async () => {
      const { getTool } = await import('../src/tools/registry.js');
      const tool = getTool('move_mouse');
      assert.ok(tool);
      assert.equal(tool.name, 'move_mouse');
      assert.equal(tool.description, 'Move the cursor to precise screen coordinates');
      assert.equal(tool.riskLevel, 'review');
      assert.equal(tool.approvalPolicy, 'requires_approval');
    });

    it('click_mouse tool has correct metadata', async () => {
      const { getTool } = await import('../src/tools/registry.js');
      const tool = getTool('click_mouse');
      assert.ok(tool);
      assert.equal(tool.name, 'click_mouse');
      assert.equal(tool.riskLevel, 'review');
      assert.equal(tool.approvalPolicy, 'requires_approval');
    });

    it('type_keyboard tool has correct metadata', async () => {
      const { getTool } = await import('../src/tools/registry.js');
      const tool = getTool('type_keyboard');
      assert.ok(tool);
      assert.equal(tool.name, 'type_keyboard');
      assert.equal(tool.riskLevel, 'review');
      assert.equal(tool.approvalPolicy, 'requires_approval');
    });

    it('press_key tool has correct metadata', async () => {
      const { getTool } = await import('../src/tools/registry.js');
      const tool = getTool('press_key');
      assert.ok(tool);
      assert.equal(tool.name, 'press_key');
      assert.equal(tool.riskLevel, 'review');
      assert.equal(tool.approvalPolicy, 'requires_approval');
    });
  });

  describe('move_mouse', () => {
    it('dry-run returns preview without executing', async () => {
      const { runTool } = await import('../src/tools/registry.js');
      const result = await runTool('move_mouse', { x: 100, y: 200 }, { cwd: '.', source: 'test', dryRun: true });
      assert.ok(result.ok);
      assert.ok(result.summary.includes('DRY-RUN'));
      assert.equal(result.requiresApproval, true);
      assert.ok(result.approvalReason);
    });

    it('rejects execution without approval', async () => {
      const { runTool } = await import('../src/tools/registry.js');
      const result = await runTool('move_mouse', { x: 100, y: 200 }, { cwd: '.', source: 'test' });
      assert.equal(result.ok, false);
      assert.ok(result.error?.includes('requires approval'));
    });

    it('rejects negative coordinates', async () => {
      const { runTool } = await import('../src/tools/registry.js');
      const result = await runTool('move_mouse', { x: -1, y: 100 }, { cwd: '.', source: 'test', approved: true });
      assert.equal(result.ok, false);
      assert.ok(result.summary.includes('Invalid'));
    });

    it('rejects out-of-range coordinates', async () => {
      const { runTool } = await import('../src/tools/registry.js');
      const result = await runTool('move_mouse', { x: 100000, y: 100 }, { cwd: '.', source: 'test', approved: true });
      assert.equal(result.ok, false);
      assert.ok(result.summary.includes('Invalid'));
    });
  });

  describe('click_mouse', () => {
    it('dry-run returns preview', async () => {
      const { runTool } = await import('../src/tools/registry.js');
      const result = await runTool('click_mouse', { button: 'left', count: 1 }, { cwd: '.', source: 'test', dryRun: true });
      assert.ok(result.ok);
      assert.ok(result.summary.includes('DRY-RUN'));
      assert.equal(result.requiresApproval, true);
    });

    it('rejects without approval', async () => {
      const { runTool } = await import('../src/tools/registry.js');
      const result = await runTool('click_mouse', {}, { cwd: '.', source: 'test' });
      assert.equal(result.ok, false);
      assert.ok(result.error?.includes('requires approval'));
    });

    it('defaults to left button single click', async () => {
      const { runTool } = await import('../src/tools/registry.js');
      const result = await runTool('click_mouse', {}, { cwd: '.', source: 'test', dryRun: true });
      assert.ok(result.summary.includes('left'));
      assert.ok(result.summary.includes('1 time'));
    });

    it('rounds and clamps count to 1-100', async () => {
      const { runTool } = await import('../src/tools/registry.js');
      const result = await runTool('click_mouse', { count: 200 }, { cwd: '.', source: 'test', dryRun: true });
      assert.ok(result.summary.includes('100 time'));
    });
  });

  describe('type_keyboard', () => {
    it('dry-run returns preview', async () => {
      const { runTool } = await import('../src/tools/registry.js');
      const result = await runTool('type_keyboard', { text: 'hello world' }, { cwd: '.', source: 'test', dryRun: true });
      assert.ok(result.ok);
      assert.ok(result.summary.includes('DRY-RUN'));
      assert.equal(result.requiresApproval, true);
    });

    it('rejects without approval', async () => {
      const { runTool } = await import('../src/tools/registry.js');
      const result = await runTool('type_keyboard', { text: 'test' }, { cwd: '.', source: 'test' });
      assert.equal(result.ok, false);
      assert.ok(result.error?.includes('requires approval'));
    });

    it('rejects empty text', async () => {
      const { runTool } = await import('../src/tools/registry.js');
      const result = await runTool('type_keyboard', { text: '' }, { cwd: '.', source: 'test', approved: true });
      assert.equal(result.ok, false);
      assert.ok(result.summary.includes('No text'));
    });

    it('truncates text to 500 chars', async () => {
      const { runTool } = await import('../src/tools/registry.js');
      const longText = 'a'.repeat(1000);
      const result = await runTool('type_keyboard', { text: longText }, { cwd: '.', source: 'test', dryRun: true });
      assert.ok(result.ok);
      assert.ok(result.summary.includes('500 characters') || result.summary.includes('500 char'));
    });
  });

  describe('press_key', () => {
    it('dry-run returns preview', async () => {
      const { runTool } = await import('../src/tools/registry.js');
      const result = await runTool('press_key', { key: 'enter' }, { cwd: '.', source: 'test', dryRun: true });
      assert.ok(result.ok);
      assert.ok(result.summary.includes('DRY-RUN'));
      assert.equal(result.requiresApproval, true);
    });

    it('rejects without approval', async () => {
      const { runTool } = await import('../src/tools/registry.js');
      const result = await runTool('press_key', { key: 'escape' }, { cwd: '.', source: 'test' });
      assert.equal(result.ok, false);
      assert.ok(result.error?.includes('requires approval'));
    });

    it('rejects empty key', async () => {
      const { runTool } = await import('../src/tools/registry.js');
      const result = await runTool('press_key', { key: '' }, { cwd: '.', source: 'test', approved: true });
      assert.equal(result.ok, false);
      assert.ok(result.summary.includes('No key'));
    });

    it('accepts common keys', async () => {
      const { runTool } = await import('../src/tools/registry.js');
      for (const key of ['enter', 'tab', 'escape', 'ctrl+s', 'alt+f4', 'shift+a']) {
        const result = await runTool('press_key', { key }, { cwd: '.', source: 'test', dryRun: true });
        assert.ok(result.ok, `Key "${key}" should be accepted in dry-run`);
      }
    });
  });

  describe('planner integration', () => {
    it('classifies mouse move request as os_control', async () => {
      const { planToolActionsForTask, resetActionCounter } = await import('../src/agent/tool-planner.js');
      resetActionCounter();
      const plan = planToolActionsForTask({ userText: 'move the mouse to 500 300' });
      assert.equal(plan.taskKind, 'os_control');
    });

    it('classifies click request as os_control', async () => {
      const { planToolActionsForTask, resetActionCounter } = await import('../src/agent/tool-planner.js');
      resetActionCounter();
      const plan = planToolActionsForTask({ userText: 'click the left mouse button' });
      assert.equal(plan.taskKind, 'os_control');
    });

    it('classifies type request as os_control', async () => {
      const { planToolActionsForTask, resetActionCounter } = await import('../src/agent/tool-planner.js');
      resetActionCounter();
      const plan = planToolActionsForTask({ userText: 'type "hello world" in the input' });
      assert.equal(plan.taskKind, 'os_control');
    });

    it('classifies key press request as os_control', async () => {
      const { planToolActionsForTask, resetActionCounter } = await import('../src/agent/tool-planner.js');
      resetActionCounter();
      const plan = planToolActionsForTask({ userText: 'press enter to submit' });
      assert.equal(plan.taskKind, 'os_control');
    });

    it('proposes move_mouse action for move request', async () => {
      const { planToolActionsForTask, resetActionCounter } = await import('../src/agent/tool-planner.js');
      resetActionCounter();
      const plan = planToolActionsForTask({ userText: 'move mouse to 100 200' });
      const moveActions = plan.actions.filter(a => a.toolName === 'move_mouse');
      assert.ok(moveActions.length > 0);
      assert.equal(moveActions[0].approvalPolicy, 'requires_approval');
      assert.equal(moveActions[0].status, 'requires_approval');
    });

    it('proposes click_mouse action for click request', async () => {
      const { planToolActionsForTask, resetActionCounter } = await import('../src/agent/tool-planner.js');
      resetActionCounter();
      const plan = planToolActionsForTask({ userText: 'right click' });
      const clickActions = plan.actions.filter(a => a.toolName === 'click_mouse');
      assert.ok(clickActions.length > 0);
      assert.equal(clickActions[0].approvalPolicy, 'requires_approval');
      assert.ok(clickActions[0].reason.includes('Right'));
    });

    it('proposes press_key action for hotkey request', async () => {
      const { planToolActionsForTask, resetActionCounter } = await import('../src/agent/tool-planner.js');
      resetActionCounter();
      const plan = planToolActionsForTask({ userText: 'press ctrl+s to save' });
      const keyActions = plan.actions.filter(a => a.toolName === 'press_key');
      assert.ok(keyActions.length > 0);
      assert.equal(keyActions[0].approvalPolicy, 'requires_approval');
    });

    it('marks plan as requiring approval for os_control', async () => {
      const { planToolActionsForTask, resetActionCounter } = await import('../src/agent/tool-planner.js');
      resetActionCounter();
      const plan = planToolActionsForTask({ userText: 'move mouse to 100 200' });
      assert.equal(plan.requiresApproval, true);
    });

    it('proposes type_keyboard action for text typing', async () => {
      const { planToolActionsForTask, resetActionCounter } = await import('../src/agent/tool-planner.js');
      resetActionCounter();
      const plan = planToolActionsForTask({ userText: 'type "select all and copy" in the editor' });
      const typeActions = plan.actions.filter(a => a.toolName === 'type_keyboard');
      assert.ok(typeActions.length > 0);
      assert.equal(typeActions[0].approvalPolicy, 'requires_approval');
    });
  });

  describe('existing tests preserved', () => {
    it('registry still has original 4 tools', async () => {
      const { listTools } = await import('../src/tools/registry.js');
      const names = listTools().map(t => t.name);
      assert.ok(names.includes('list_files'));
      assert.ok(names.includes('read_file'));
      assert.ok(names.includes('write_file'));
      assert.ok(names.includes('run_command'));
    });

    it('planner still classifies simple chat', async () => {
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
  });
});
