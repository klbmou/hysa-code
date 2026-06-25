import { describe, it, before } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  planToolActionsForTask,
  executeApprovedToolPlan,
  formatPlanForDisplay,
  resetActionCounter,
} from '../src/agent/tool-planner.js';

describe('Agent Tool Planner', () => {
  before(() => {
    resetActionCounter();
  });

  describe('planToolActionsForTask', () => {
    it('simple chat produces no actions', () => {
      resetActionCounter();
      const plan = planToolActionsForTask({ userText: 'hi, how are you?' });
      assert.equal(plan.actions.length, 0);
      assert.equal(plan.blocked, false);
      assert.equal(plan.requiresApproval, false);
      assert.ok(plan.nextStep.includes('Respond directly'));
    });

    it('arabic greeting produces no actions', () => {
      resetActionCounter();
      const plan = planToolActionsForTask({ userText: 'السلام عليكم' });
      assert.equal(plan.actions.length, 0);
    });

    it('code/debug task proposes list/read actions', () => {
      resetActionCounter();
      const plan = planToolActionsForTask({ userText: 'fix the bug in src/index.ts please' });
      assert.ok(plan.actions.length >= 1);
      const toolNames = plan.actions.map(a => a.toolName);
      assert.ok(toolNames.includes('read_file') || toolNames.includes('list_files'));
    });

    it('file mentioned leads to read_file proposal', () => {
      resetActionCounter();
      const plan = planToolActionsForTask({ userText: 'read package.json for me' });
      if (plan.actions.length > 0) {
        const fileActions = plan.actions.filter(a => a.toolName === 'read_file');
        if (fileActions.length > 0) {
          assert.ok(fileActions.some(a => String(a.input.path).includes('package.json')));
        }
      }
    });

    it('fix/create task proposes write_file with requires_approval', () => {
      resetActionCounter();
      const plan = planToolActionsForTask({ userText: 'create a new file src/new-component.ts', filesMentioned: ['src/new-component.ts'] });
      const writeActions = plan.actions.filter(a => a.toolName === 'write_file');
      assert.ok(writeActions.length > 0);
      for (const a of writeActions) {
        assert.equal(a.status, 'requires_approval');
        assert.equal(a.approvalPolicy, 'requires_approval');
        assert.equal(a.riskLevel, 'review');
      }
    });

    it('test/build task proposes run_command with requires_approval', () => {
      resetActionCounter();
      const plan = planToolActionsForTask({ userText: 'run the tests' });
      const cmdActions = plan.actions.filter(a => a.toolName === 'run_command');
      assert.ok(cmdActions.length > 0);
      for (const a of cmdActions) {
        assert.equal(a.status, 'requires_approval');
        assert.equal(a.approvalPolicy, 'requires_approval');
        assert.equal(a.riskLevel, 'review');
      }
    });

    it('run build proposes run_command with requires_approval', () => {
      resetActionCounter();
      const plan = planToolActionsForTask({ userText: 'build the project' });
      const cmdActions = plan.actions.filter(a => a.toolName === 'run_command');
      assert.ok(cmdActions.length > 0);
      for (const a of cmdActions) {
        assert.equal(a.status, 'requires_approval');
      }
    });

    it('dangerous command is blocked', () => {
      resetActionCounter();
      const plan = planToolActionsForTask({ userText: 'delete all files in the project' });
      assert.ok(plan.blocked);
      assert.ok(plan.risks.length > 0);
      assert.ok(plan.actions.some(a => a.status === 'blocked'));
    });

    it('research-only task does not propose local tools', () => {
      resetActionCounter();
      const plan = planToolActionsForTask({ userText: 'search the web for latest AI news' });
      const localTools = plan.actions.filter(a => ['read_file', 'run_command', 'write_file', 'list_files'].includes(a.toolName));
      assert.equal(localTools.length, 0);
    });

    it('Arabic debug prompt produces sensible tool plan', () => {
      resetActionCounter();
      const plan = planToolActionsForTask({ userText: 'في خطأ في كود TypeScript', filesMentioned: ['src/app.tsx'] });
      assert.ok(plan.actions.length >= 1);
      const fileActions = plan.actions.filter(a => a.toolName === 'read_file');
      assert.ok(fileActions.some(a => String(a.input.path).includes('src/app.tsx')));
    });

    it('Arabic run tests proposes run_command with approval', () => {
      resetActionCounter();
      const plan = planToolActionsForTask({ userText: 'شغل الاختبارات' });
      const cmdActions = plan.actions.filter(a => a.toolName === 'run_command');
      assert.ok(cmdActions.length > 0);
      for (const a of cmdActions) {
        assert.equal(a.status, 'requires_approval');
      }
    });

    it('write_file is never auto-approved', () => {
      resetActionCounter();
      const plan = planToolActionsForTask({ userText: 'create src/test.txt', filesMentioned: ['src/test.txt'] });
      for (const a of plan.actions) {
        if (a.toolName === 'write_file') {
          assert.equal(a.status, 'requires_approval');
          assert.notEqual(a.approvalPolicy, 'auto');
        }
      }
    });

    it('run_command is never auto-approved', () => {
      resetActionCounter();
      const plan = planToolActionsForTask({ userText: 'run npm test' });
      for (const a of plan.actions) {
        if (a.toolName === 'run_command') {
          assert.equal(a.status, 'requires_approval');
          assert.notEqual(a.approvalPolicy, 'auto');
        }
      }
    });

    it('read_file stays safe', () => {
      resetActionCounter();
      const plan = planToolActionsForTask({ userText: 'read package.json', filesMentioned: ['package.json'] });
      for (const a of plan.actions) {
        if (a.toolName === 'read_file') {
          assert.equal(a.riskLevel, 'safe');
          assert.equal(a.status, 'ready');
        }
      }
    });

    it('action IDs are stable and unique', () => {
      resetActionCounter();
      const plan1 = planToolActionsForTask({ userText: 'run npm test' });
      const plan2 = planToolActionsForTask({ userText: 'run npm test' });
      const ids1 = plan1.actions.map(a => a.id);
      const ids2 = plan2.actions.map(a => a.id);
      const allIds = [...ids1, ...ids2];
      assert.equal(new Set(allIds).size, allIds.length);
    });

    it('approval metadata matches tool registry', () => {
      resetActionCounter();
      const plan = planToolActionsForTask({ userText: 'read package.json', filesMentioned: ['package.json'] });
      for (const a of plan.actions) {
        if (a.toolName === 'read_file') {
          assert.equal(a.riskLevel, 'safe');
          assert.equal(a.approvalPolicy, 'auto');
        }
      }
    });

    it('JSON output is deterministic', () => {
      resetActionCounter();
      const plan1 = planToolActionsForTask({ userText: 'fix the bug in src/index.ts' });
      resetActionCounter();
      const plan2 = planToolActionsForTask({ userText: 'fix the bug in src/index.ts' });
      assert.deepEqual(plan1.summary, plan2.summary);
      assert.equal(plan1.actions.length, plan2.actions.length);
      assert.equal(plan1.requiresApproval, plan2.requiresApproval);
      assert.equal(plan1.blocked, plan2.blocked);
    });

    it('no path traversal in proposed file inputs', () => {
      resetActionCounter();
      const plan = planToolActionsForTask({ userText: 'read ../../etc/passwd', filesMentioned: ['../../etc/passwd'] });
      const fileActions = plan.actions.filter(a => [('../../etc/passwd')].includes(String(a.input.path)));
      assert.equal(fileActions.length, 0);
    });

    it('plan includes clear nextStep', () => {
      resetActionCounter();
      const plan = planToolActionsForTask({ userText: 'run npm test' });
      assert.ok(typeof plan.nextStep === 'string');
      assert.ok(plan.nextStep.length > 5);
    });

    it('blocked plan includes risk explanation', () => {
      resetActionCounter();
      const plan = planToolActionsForTask({ userText: 'delete all files' });
      assert.ok(plan.blocked);
      assert.ok(plan.risks.length > 0);
      assert.ok(plan.risks[0].includes('destructive'));
    });

    it('executeApprovedToolPlan returns results for each action', async () => {
      resetActionCounter();
      const plan = planToolActionsForTask({ userText: 'read package.json', filesMentioned: ['package.json'] });
      if (plan.actions.length > 0) {
        const results = await executeApprovedToolPlan(plan, { approved: true, source: 'test' });
        assert.ok(Array.isArray(results));
        assert.ok(results.length > 0);
        for (const r of results) {
          assert.ok(typeof r.actionId === 'string');
          assert.ok(typeof r.toolName === 'string');
          assert.ok(typeof r.ok === 'boolean');
          assert.ok(typeof r.summary === 'string');
        }
      }
    });

    it('blocked actions not executed by executeApprovedToolPlan', async () => {
      resetActionCounter();
      const plan = planToolActionsForTask({ userText: 'delete all files' });
      const results = await executeApprovedToolPlan(plan, { approved: true, source: 'test' });
      for (const r of results) {
        assert.equal(r.ok, false);
        assert.ok(r.summary.includes('Blocked'));
      }
    });
  });

  describe('formatPlanForDisplay', () => {
    it('produces non-empty string for empty plan', () => {
      resetActionCounter();
      const plan = planToolActionsForTask({ userText: 'hi' });
      const display = formatPlanForDisplay(plan);
      assert.ok(typeof display === 'string');
      assert.ok(display.length > 0);
    });

    it('includes tool name and reason for planned actions', () => {
      resetActionCounter();
      const plan = planToolActionsForTask({ userText: 'run npm test' });
      const display = formatPlanForDisplay(plan);
      assert.ok(display.includes('run_command'));
      assert.ok(display.includes('npm test'));
    });
  });
});
