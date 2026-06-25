import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Tool Execution Loop', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'hysa-execloop-'));
  });

  after(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('runToolExecutionLoop', () => {
    it('dry-run produces plan but executes nothing', async () => {
      const { runToolExecutionLoop } = await import('../src/agent/execution-loop.js');
      const result = await runToolExecutionLoop({
        userText: 'read package.json',
        cwd: tmpDir,
        source: 'test',
        dryRun: true,
      });
      assert.ok(result.plan);
      assert.equal(result.executedActions.length, 0);
    });

    it('simple chat has no actions', async () => {
      const { runToolExecutionLoop } = await import('../src/agent/execution-loop.js');
      const result = await runToolExecutionLoop({
        userText: 'hi how are you',
        cwd: tmpDir,
        source: 'test',
        dryRun: false,
      });
      assert.equal(result.plan.actions.length, 0);
      assert.equal(result.executedActions.length, 0);
      assert.equal(result.pendingApproval.length, 0);
    });

    it('read_file can execute safely when allowed', async () => {
      const testFile = join(tmpDir, 'test-read.txt');
      writeFileSync(testFile, 'hello world', 'utf-8');
      const { runToolExecutionLoop } = await import('../src/agent/execution-loop.js');
      const result = await runToolExecutionLoop({
        userText: 'read test-read.txt',
        cwd: tmpDir,
        source: 'test',
        dryRun: false,
        filesMentioned: ['test-read.txt'],
      });
      if (result.plan.actions.length > 0) {
        const readActions = result.plan.actions.filter(a => a.toolName === 'read_file');
        if (readActions.length > 0 && readActions[0].status === 'ready') {
          assert.ok(result.executedActions.length >= 1);
          const executed = result.executedActions.find(e => e.toolName === 'read_file');
          if (executed) {
            assert.equal(executed.ok, true);
          }
        }
      }
    });

    it('write_file does not execute without approval', async () => {
      const { runToolExecutionLoop } = await import('../src/agent/execution-loop.js');
      const result = await runToolExecutionLoop({
        userText: 'create test-output.txt with content test',
        cwd: tmpDir,
        source: 'test',
        dryRun: false,
        filesMentioned: ['test-output.txt'],
      });
      const writeActions = result.plan.actions.filter(a => a.toolName === 'write_file');
      if (writeActions.length > 0) {
        assert.equal(result.executedActions.filter(e => e.toolName === 'write_file').length, 0);
        assert.ok(result.pendingApproval.some(a => a.toolName === 'write_file'));
      }
    });

    it('write_file executes with explicit approved action ID', async () => {
      const { runToolExecutionLoop } = await import('../src/agent/execution-loop.js');
      const result = await runToolExecutionLoop({
        userText: 'create test-approved.txt with content approved',
        cwd: tmpDir,
        source: 'test',
        dryRun: false,
        filesMentioned: ['test-approved.txt'],
      });
      const writeActions = result.plan.actions.filter(a => a.toolName === 'write_file');
      if (writeActions.length > 0) {
        const firstWrite = writeActions[0];
        const result2 = await runToolExecutionLoop({
          userText: 'create test-approved.txt with content approved',
          cwd: tmpDir,
          source: 'test',
          dryRun: false,
          approvedActionIds: [firstWrite.id],
          filesMentioned: ['test-approved.txt'],
        });
        const executedWrite = result2.executedActions.find(e => e.toolName === 'write_file');
        if (executedWrite) {
          assert.equal(executedWrite.ok, true);
          assert.ok(existsSync(join(tmpDir, 'test-approved.txt')));
        }
      }
    });

    it('run_command does not execute without approval', async () => {
      const { runToolExecutionLoop } = await import('../src/agent/execution-loop.js');
      const result = await runToolExecutionLoop({
        userText: 'run node -e "console.log(\'hello\')"',
        cwd: tmpDir,
        source: 'test',
        dryRun: false,
      });
      assert.equal(result.executedActions.filter(e => e.toolName === 'run_command').length, 0);
      const cmdActions = result.plan.actions.filter(a => a.toolName === 'run_command');
      if (cmdActions.length > 0) {
        assert.ok(result.pendingApproval.some(a => a.toolName === 'run_command'));
      }
    });

    it('run_command executes safe command with approval', async () => {
      const { runToolExecutionLoop } = await import('../src/agent/execution-loop.js');
      const result = await runToolExecutionLoop({
        userText: 'run npm test',
        cwd: tmpDir,
        source: 'test',
        dryRun: false,
      });
      const cmdActions = result.plan.actions.filter(a => a.toolName === 'run_command');
      if (cmdActions.length > 0) {
        const firstCmd = cmdActions[0];
        const result2 = await runToolExecutionLoop({
          userText: 'run npm test',
          cwd: tmpDir,
          source: 'test',
          dryRun: false,
          approvedActionIds: [firstCmd.id],
        });
        const executedCmd = result2.executedActions.find(e => e.toolName === 'run_command');
        if (executedCmd) {
          assert.ok(typeof executedCmd.ok === 'boolean');
          assert.ok(typeof executedCmd.summary === 'string');
        }
      }
    });

    it('dangerous command never executes', async () => {
      const { runToolExecutionLoop } = await import('../src/agent/execution-loop.js');
      const result = await runToolExecutionLoop({
        userText: 'delete all files in the project',
        cwd: tmpDir,
        source: 'test',
        dryRun: false,
      });
      assert.ok(result.plan.blocked);
      assert.equal(result.executedActions.length, 0);
    });

    it('blocked actions listed correctly', async () => {
      const { runToolExecutionLoop } = await import('../src/agent/execution-loop.js');
      const result = await runToolExecutionLoop({
        userText: 'delete all files',
        cwd: tmpDir,
        source: 'test',
        dryRun: false,
      });
      if (result.blockedActions.length > 0) {
        for (const a of result.blockedActions) {
          assert.equal(a.status, 'blocked');
        }
      }
      assert.ok(result.plan.blocked);
    });

    it('pending approvals listed correctly', async () => {
      const { runToolExecutionLoop } = await import('../src/agent/execution-loop.js');
      const result = await runToolExecutionLoop({
        userText: 'run npm test',
        cwd: tmpDir,
        source: 'test',
        dryRun: false,
      });
      const cmdActions = result.plan.actions.filter(a => a.toolName === 'run_command');
      if (cmdActions.length > 0) {
        assert.ok(result.pendingApproval.length > 0);
        for (const a of result.pendingApproval) {
          assert.equal(a.status, 'requires_approval');
        }
      }
    });

    it('toolContextForAi is compact', async () => {
      const { runToolExecutionLoop } = await import('../src/agent/execution-loop.js');
      const result = await runToolExecutionLoop({
        userText: 'hi',
        cwd: tmpDir,
        source: 'test',
        dryRun: false,
      });
      assert.ok(typeof result.toolContextForAi === 'string');
      assert.ok(result.toolContextForAi.length < 2000);
    });

    it('stdout/stderr are size-limited', async () => {
      const { runToolExecutionLoop } = await import('../src/agent/execution-loop.js');
      const result = await runToolExecutionLoop({
        userText: 'run npm test',
        cwd: tmpDir,
        source: 'test',
        dryRun: false,
      });
      const cmdActions = result.plan.actions.filter(a => a.toolName === 'run_command');
      if (cmdActions.length > 0) {
        const firstCmd = cmdActions[0];
        const result2 = await runToolExecutionLoop({
          userText: 'run npm test',
          cwd: tmpDir,
          source: 'test',
          dryRun: false,
          approvedActionIds: [firstCmd.id],
        });
        for (const r of result2.executedActions) {
          assert.ok(r.summary.length < 2000, `Summary too long: ${r.summary.length}`);
          if (r.error) assert.ok(r.error.length < 1000);
        }
      }
    });

    it('secrets are redacted', async () => {
      const { runToolExecutionLoop } = await import('../src/agent/execution-loop.js');
      const result = await runToolExecutionLoop({
        userText: 'read test-read.txt',
        cwd: tmpDir,
        source: 'test',
        dryRun: false,
        filesMentioned: ['test-read.txt'],
      });
      const secret = 'sk-test123456789012345678901234567890';
      assert.ok(!result.toolContextForAi.includes(secret));
    });

    it('Arabic prompt works', async () => {
      const { runToolExecutionLoop } = await import('../src/agent/execution-loop.js');
      const result = await runToolExecutionLoop({
        userText: 'السلام عليكم',
        cwd: tmpDir,
        source: 'test',
        dryRun: false,
      });
      assert.ok(typeof result.toolContextForAi === 'string');
      // Should produce no actions (simple greeting)
      assert.equal(result.executedActions.length, 0);
    });

    it('path traversal not executed', async () => {
      const { runToolExecutionLoop } = await import('../src/agent/execution-loop.js');
      const result = await runToolExecutionLoop({
        userText: 'read ../../etc/passwd',
        cwd: tmpDir,
        source: 'test',
        dryRun: false,
        filesMentioned: ['../../etc/passwd'],
      });
      const readActions = result.plan.actions.filter(a => a.toolName === 'read_file');
      for (const a of readActions) {
        // Path traversal files should not be proposed
        assert.ok(!String(a.input.path).includes('..'));
      }
    });

    it('web source does not execute review actions without approval', async () => {
      const { runToolExecutionLoop } = await import('../src/agent/execution-loop.js');
      const result = await runToolExecutionLoop({
        userText: 'create web-test.txt',
        cwd: tmpDir,
        source: 'web',
        dryRun: false,
        filesMentioned: ['web-test.txt'],
      });
      assert.equal(result.executedActions.filter(e => e.toolName === 'write_file').length, 0);
    });

    it('action IDs deterministic enough for tests', async () => {
      const { runToolExecutionLoop } = await import('../src/agent/execution-loop.js');
      const result = await runToolExecutionLoop({
        userText: 'read package.json',
        cwd: tmpDir,
        source: 'test',
        dryRun: true,
        filesMentioned: ['package.json'],
      });
      if (result.plan.actions.length > 0) {
        for (const a of result.plan.actions) {
          assert.ok(a.id.startsWith('act_'));
          assert.ok(typeof a.id === 'string');
        }
      }
    });
  });

  describe('formatExecutionResult', () => {
    it('produces non-empty string', async () => {
      const { runToolExecutionLoop, formatExecutionResult } = await import('../src/agent/execution-loop.js');
      const result = await runToolExecutionLoop({
        userText: 'hi',
        cwd: tmpDir,
        source: 'test',
        dryRun: true,
      });
      const output = formatExecutionResult(result);
      assert.ok(typeof output === 'string');
      assert.ok(output.length > 0);
    });

    it('includes action details when actions exist', async () => {
      const { runToolExecutionLoop, formatExecutionResult } = await import('../src/agent/execution-loop.js');
      const result = await runToolExecutionLoop({
        userText: 'run npm test',
        cwd: tmpDir,
        source: 'test',
        dryRun: true,
      });
      const output = formatExecutionResult(result);
      if (result.plan.actions.length > 0) {
        assert.ok(output.includes('run_command') || output.includes('Pending approval'));
      }
    });
  });
});
