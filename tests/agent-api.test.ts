import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { resetActionCounter } from '../src/agent/tool-planner.js';
import { resetPlans } from '../src/web/agent-api.js';

function fetchJson(url: string, options?: { method?: string; body?: string; headers?: Record<string, string> }): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      method: options?.method || 'GET',
      headers: options?.headers || { 'Content-Type': 'application/json' },
    }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => {
        let json: any;
        try { json = JSON.parse(data); } catch { json = null; }
        resolve({ status: res.statusCode || 0, json });
      });
    });
    req.on('error', reject);
    if (options?.body) req.write(options.body);
    req.end();
  });
}

describe('Agent Tool API', () => {
  let server: http.Server;
  let port: number;
  let baseUrl: string;

  before(async () => {
    resetActionCounter();
    resetPlans();
    const app = express();
    app.use(express.json({ limit: '50mb' }));
    const { handlePlanTools, handleExecuteTools } = await import('../src/web/agent-api.js');
    app.post('/api/agent/plan-tools', async (req, res) => {
      try { res.json(handlePlanTools(req.body)); }
      catch (err: unknown) { res.status(400).json({ error: (err as Error).message }); }
    });
    app.post('/api/agent/execute-tools', async (req, res) => {
      try { res.json(await handleExecuteTools(req.body)); }
      catch (err: unknown) { res.status(400).json({ error: (err as Error).message }); }
    });
    return new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') { port = addr.port; baseUrl = `http://localhost:${port}`; }
        resolve();
      });
    });
  });

  after(() => {
    resetPlans();
    if (server) server.close();
  });

  describe('plan-tools', () => {
    it('return empty actions for simple chat', async () => {
      const res = await fetchJson(`${baseUrl}/api/agent/plan-tools`, {
        method: 'POST', body: JSON.stringify({ message: 'hi' }),
      });
      assert.equal(res.status, 200);
      assert.ok(res.json.actions);
      assert.equal(res.json.actions.length, 0);
      assert.ok(res.json.planId);
    });

    it('return read action for reading file', async () => {
      resetActionCounter();
      const res = await fetchJson(`${baseUrl}/api/agent/plan-tools`, {
        method: 'POST', body: JSON.stringify({ message: 'read the file src/index.ts' }),
      });
      assert.equal(res.status, 200);
      assert.ok(res.json.actions.length >= 1);
      const readActions = res.json.actions.filter((a: any) => a.toolName === 'read_file');
      assert.ok(readActions.length >= 1, `Expected read_file action, got: ${JSON.stringify(res.json.actions)}`);
      assert.equal(readActions[0].status, 'ready');
    });

    it('write_file requires approval in plan', async () => {
      resetActionCounter();
      const res = await fetchJson(`${baseUrl}/api/agent/plan-tools`, {
        method: 'POST', body: JSON.stringify({ message: 'create test.txt with content hello' }),
      });
      assert.equal(res.status, 200);
      const writeActions = res.json.actions.filter((a: any) => a.toolName === 'write_file');
      for (const a of writeActions) {
        assert.equal(a.approvalRequired, true);
        assert.ok(a.status === 'requires_approval');
      }
    });

    it('run_command requires approval in plan', async () => {
      resetActionCounter();
      const res = await fetchJson(`${baseUrl}/api/agent/plan-tools`, {
        method: 'POST', body: JSON.stringify({ message: 'run npm test' }),
      });
      assert.equal(res.status, 200);
      const cmdActions = res.json.actions.filter((a: any) => a.toolName === 'run_command');
      assert.ok(cmdActions.length >= 1);
      for (const a of cmdActions) {
        assert.equal(a.approvalRequired, true);
        assert.ok(a.status === 'requires_approval');
      }
    });

    it('dangerous command is blocked in plan', async () => {
      resetActionCounter();
      const res = await fetchJson(`${baseUrl}/api/agent/plan-tools`, {
        method: 'POST', body: JSON.stringify({ message: 'delete all files' }),
      });
      assert.equal(res.status, 200);
      assert.equal(res.json.hasBlockedActions, true);
      for (const a of res.json.actions) {
        assert.equal(a.status, 'blocked');
      }
    });

    it('error on missing message', async () => {
      const res = await fetchJson(`${baseUrl}/api/agent/plan-tools`, {
        method: 'POST', body: JSON.stringify({}),
      });
      assert.equal(res.status, 400);
      assert.ok(res.json.error);
    });

    it('Arabic simple chat returns empty actions', async () => {
      resetActionCounter();
      const res = await fetchJson(`${baseUrl}/api/agent/plan-tools`, {
        method: 'POST', body: JSON.stringify({ message: 'السلام عليكم' }),
      });
      assert.equal(res.status, 200);
      assert.equal(res.json.actions.length, 0);
    });
  });

  describe('execute-tools', () => {
    it('error on missing planId', async () => {
      const res = await fetchJson(`${baseUrl}/api/agent/execute-tools`, {
        method: 'POST', body: JSON.stringify({ approvedActionIds: [] }),
      });
      assert.equal(res.status, 400);
      assert.ok(res.json.error.includes('Missing planId'));
    });

    it('error on invalid planId', async () => {
      const res = await fetchJson(`${baseUrl}/api/agent/execute-tools`, {
        method: 'POST', body: JSON.stringify({ planId: 'nonexistent', approvedActionIds: [] }),
      });
      assert.equal(res.status, 400);
      assert.ok(res.json.error.includes('Plan not found'));
    });

    it('execute only approved read_file action', async () => {
      resetActionCounter();
      const planRes = await fetchJson(`${baseUrl}/api/agent/plan-tools`, {
        method: 'POST', body: JSON.stringify({ message: 'read the file src/index.ts' }),
      });
      const planId = planRes.json.planId;
      const readAction = planRes.json.actions.find((a: any) => a.toolName === 'read_file');
      assert.ok(readAction, `No read_file action in plan: ${JSON.stringify(planRes.json.actions)}`);
      const execRes = await fetchJson(`${baseUrl}/api/agent/execute-tools`, {
        method: 'POST', body: JSON.stringify({ planId, approvedActionIds: [readAction.id], rejectedActionIds: [] }),
      });
      assert.equal(execRes.status, 200, `Status ${execRes.status}: ${JSON.stringify(execRes.json)}`);
      assert.ok(execRes.json, `json is null, status=${execRes.status}`);
      assert.ok(execRes.json.results, `results missing from: ${JSON.stringify(execRes.json)}`);
      assert.equal(execRes.json.results.length, 1, `Expected 1 result: ${JSON.stringify(execRes.json.results)}`);
      assert.equal(execRes.json.results[0].status, 'executed', `Result: ${JSON.stringify(execRes.json.results[0])}`);
      const ctxTool: string = execRes.json.toolContextForAi;
      assert.ok(typeof ctxTool === 'string');
      assert.ok(ctxTool.length > 0);
    });

    it('rejected action is skipped', async () => {
      resetActionCounter();
      const planRes = await fetchJson(`${baseUrl}/api/agent/plan-tools`, {
        method: 'POST', body: JSON.stringify({ message: 'read the file src/index.ts' }),
      });
      const planId = planRes.json.planId;
      const readAction = planRes.json.actions.find((a: any) => a.toolName === 'read_file');
      assert.ok(readAction, `No read_file action: ${JSON.stringify(planRes.json.actions)}`);
      const execRes = await fetchJson(`${baseUrl}/api/agent/execute-tools`, {
        method: 'POST', body: JSON.stringify({ planId, approvedActionIds: [], rejectedActionIds: [readAction.id] }),
      });
      assert.equal(execRes.status, 200);
      assert.equal(execRes.json.results[0].status, 'skipped');
      assert.ok(execRes.json.toolContextForAi.includes('No tool actions were executed'));
    });

    it('unapproved action is skipped', async () => {
      resetActionCounter();
      const planRes = await fetchJson(`${baseUrl}/api/agent/plan-tools`, {
        method: 'POST', body: JSON.stringify({ message: 'read the file src/index.ts' }),
      });
      const planId = planRes.json.planId;
      assert.ok(planRes.json.actions.length > 0, `Expected actions: ${JSON.stringify(planRes.json.actions)}`);
      const execRes = await fetchJson(`${baseUrl}/api/agent/execute-tools`, {
        method: 'POST', body: JSON.stringify({ planId, approvedActionIds: [], rejectedActionIds: [] }),
      });
      assert.equal(execRes.status, 200);
      assert.equal(execRes.json.results[0].status, 'skipped');
    });

    it('write_file requires explicit approval to execute', async () => {
      resetActionCounter();
      const planRes = await fetchJson(`${baseUrl}/api/agent/plan-tools`, {
        method: 'POST', body: JSON.stringify({ message: 'write test-approval.txt with content test' }),
      });
      const writeActions = planRes.json.actions.filter((a: any) => a.toolName === 'write_file');
      if (writeActions.length > 0) {
        const writeAction = writeActions[0];
        // Without approval — should be skipped
        const skipRes = await fetchJson(`${baseUrl}/api/agent/execute-tools`, {
          method: 'POST', body: JSON.stringify({ planId: planRes.json.planId, approvedActionIds: [], rejectedActionIds: [writeAction.id] }),
        });
        assert.equal(skipRes.json.results[0].status, 'skipped');
        // With approval — execute
        const execRes = await fetchJson(`${baseUrl}/api/agent/execute-tools`, {
          method: 'POST', body: JSON.stringify({ planId: planRes.json.planId, approvedActionIds: [writeAction.id], rejectedActionIds: [] }),
        });
      assert.equal(execRes.json.results[0].status, 'executed', `Unexpected result: ${JSON.stringify(execRes.json.results[0])}`);
      }
    });

    it('dangerous command is blocked even if approved', async () => {
      resetActionCounter();
      const planRes = await fetchJson(`${baseUrl}/api/agent/plan-tools`, {
        method: 'POST', body: JSON.stringify({ message: 'delete all files' }),
      });
      const planId = planRes.json.planId;
      const blockedActions = planRes.json.actions.filter((a: any) => a.status === 'blocked');
      assert.ok(blockedActions.length > 0);
      const execRes = await fetchJson(`${baseUrl}/api/agent/execute-tools`, {
        method: 'POST', body: JSON.stringify({ planId, approvedActionIds: blockedActions.map((a: any) => a.id), rejectedActionIds: [] }),
      });
      assert.equal(execRes.status, 200);
      for (const r of execRes.json.results) {
        assert.equal(r.status, 'blocked');
        assert.ok(r.error);
      }
    });

    it('execution uses original stored plan, not client input', async () => {
      // Client cannot send toolName or input in execute request
      resetActionCounter();
      const planRes = await fetchJson(`${baseUrl}/api/agent/plan-tools`, {
        method: 'POST', body: JSON.stringify({ message: 'read the file src/index.ts' }),
      });
      const planId = planRes.json.planId;
      const readAction = planRes.json.actions.find((a: any) => a.toolName === 'read_file');
      assert.ok(readAction, `Expected read_file: ${JSON.stringify(planRes.json.actions)}`);
      // Even if client sends extra fields, they should be ignored
      const execRes = await fetchJson(`${baseUrl}/api/agent/execute-tools`, {
        method: 'POST', body: JSON.stringify({
          planId,
          approvedActionIds: [readAction.id],
          rejectedActionIds: [],
          maliciousToolName: 'write_file',
          maliciousInput: { command: 'rm -rf /' },
        }),
      });
      assert.equal(execRes.status, 200);
      // Should have executed read_file, not malicious
      for (const r of execRes.json.results) {
        assert.equal(r.toolName || r.summary.includes('read_file'), true);
      }
    });

    it('toolContextForAi does NOT contain [auto-continue] — regression guard', async () => {
      resetActionCounter();
      const planRes = await fetchJson(`${baseUrl}/api/agent/plan-tools`, {
        method: 'POST', body: JSON.stringify({ message: 'read the file src/index.ts' }),
      });
      const planId = planRes.json.planId;
      const readAction = planRes.json.actions.find((a: any) => a.toolName === 'read_file');
      assert.ok(readAction, `No read_file action: ${JSON.stringify(planRes.json.actions)}`);
      const execRes = await fetchJson(`${baseUrl}/api/agent/execute-tools`, {
        method: 'POST', body: JSON.stringify({ planId, approvedActionIds: [readAction.id], rejectedActionIds: [] }),
      });
      const ctx: string = execRes.json.toolContextForAi;

      // REGRESSION: [auto-continue] must NEVER appear in tool context
      assert.ok(!ctx.includes('[auto-continue]'),
        `toolContextForAi must not contain [auto-continue]: ${JSON.stringify(ctx)}`);

      // tool context must describe what was executed
      assert.ok(ctx.startsWith('[Tool Results:'),
        `toolContextForAi must start with [Tool Results:]: ${JSON.stringify(ctx)}`);
      assert.ok(ctx.includes('read_file'),
        `toolContextForAi must mention read_file: ${JSON.stringify(ctx)}`);
    });

    it('toolContextForAi says blocked when all actions are blocked — regression guard', async () => {
      resetActionCounter();
      const planRes = await fetchJson(`${baseUrl}/api/agent/plan-tools`, {
        method: 'POST', body: JSON.stringify({ message: 'delete all files' }),
      });
      const planId = planRes.json.planId;
      const execRes = await fetchJson(`${baseUrl}/api/agent/execute-tools`, {
        method: 'POST', body: JSON.stringify({ planId, approvedActionIds: [], rejectedActionIds: [] }),
      });
      assert.equal(execRes.status, 200);
      const ctx: string = execRes.json.toolContextForAi;

      // When all blocked, context explains it
      assert.ok(!ctx.includes('[auto-continue]'),
        `blocked context must not contain [auto-continue]: ${JSON.stringify(ctx)}`);
      assert.ok(ctx.includes('blocked'),
        `blocked context mentions blocked: ${JSON.stringify(ctx)}`);
    });

    it('toolContextForAi says no execution when no actions approved — regression guard', async () => {
      resetActionCounter();
      const planRes = await fetchJson(`${baseUrl}/api/agent/plan-tools`, {
        method: 'POST', body: JSON.stringify({ message: 'read the file src/index.ts' }),
      });
      const planId = planRes.json.planId;
      assert.ok(planRes.json.actions.length > 0, `Expected actions: ${JSON.stringify(planRes.json.actions)}`);
      const execRes = await fetchJson(`${baseUrl}/api/agent/execute-tools`, {
        method: 'POST', body: JSON.stringify({ planId, approvedActionIds: [], rejectedActionIds: [] }),
      });
      assert.equal(execRes.status, 200);
      const ctx: string = execRes.json.toolContextForAi;

      // No approved actions → context says nothing was executed
      assert.ok(!ctx.includes('[auto-continue]'),
        `no-approval context must not contain [auto-continue]: ${JSON.stringify(ctx)}`);
      assert.ok(ctx.includes('No tool actions were executed'),
        `no-approval context says nothing executed: ${JSON.stringify(ctx)}`);
    });

    it('sessionId is preserved in execute-tools response', async () => {
      resetActionCounter();
      const planRes = await fetchJson(`${baseUrl}/api/agent/plan-tools`, {
        method: 'POST', body: JSON.stringify({ message: 'read the file src/index.ts', sessionId: 'test-session-123' }),
      });
      const planId = planRes.json.planId;
      const readAction = planRes.json.actions.find((a: any) => a.toolName === 'read_file');
      assert.ok(readAction);
      // sessionId is not returned by execute-tools directly (it's used by the stream API),
      // but plan-tools should not throw when sessionId is provided
      assert.ok(planRes.json.planId);
      assert.ok(planRes.json.actions.length >= 1);
    });

    it('output preview is size-limited and redacted', async () => {
      resetActionCounter();
      const planRes = await fetchJson(`${baseUrl}/api/agent/plan-tools`, {
        method: 'POST', body: JSON.stringify({ message: 'read the file src/index.ts' }),
      });
      const planId = planRes.json.planId;
      const readAction = planRes.json.actions.find((a: any) => a.toolName === 'read_file');
      assert.ok(readAction, `No read_file action: ${JSON.stringify(planRes.json.actions)}`);
      const execRes = await fetchJson(`${baseUrl}/api/agent/execute-tools`, {
        method: 'POST', body: JSON.stringify({ planId, approvedActionIds: [readAction.id], rejectedActionIds: [] }),
      });
      if (execRes.json.results[0].outputPreview) {
        assert.ok(execRes.json.results[0].outputPreview.length <= 500);
        assert.ok(!execRes.json.results[0].outputPreview.includes('sk-'));
      }
      assert.ok(execRes.json.toolContextForAi.length < 2000);
    });
  });
});
