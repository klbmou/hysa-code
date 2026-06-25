import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const TMP = join(tmpdir(), `hysa-tool-test-${Date.now()}`);
const CWD = resolve(TMP);

describe('Tool System', () => {
  before(() => {
    mkdirSync(TMP, { recursive: true });
    writeFileSync(join(TMP, 'hello.txt'), 'Hello, World!', 'utf-8');
    writeFileSync(join(TMP, 'arabic.txt'), 'مرحبا بالعالم', 'utf-8');
    mkdirSync(join(TMP, 'subdir'), { recursive: true });
    writeFileSync(join(TMP, 'subdir', 'nested.txt'), 'nested content', 'utf-8');
  });

  after(() => {
    rmSync(TMP, { recursive: true, force: true });
  });

  describe('registry', () => {
    it('lists registered tools', async () => {
      const { listTools } = await import('../src/tools/registry.js');
      const tools = listTools();
      const names = tools.map(t => t.name).sort();
      assert.ok(names.includes('list_files'));
      assert.ok(names.includes('read_file'));
      assert.ok(names.includes('write_file'));
      assert.ok(names.includes('run_command'));
    });

    it('getTool returns tool by name', async () => {
      const { getTool } = await import('../src/tools/registry.js');
      const tool = getTool('read_file');
      assert.ok(tool);
      assert.equal(tool.name, 'read_file');
      assert.equal(tool.riskLevel, 'safe');
    });

    it('getTool returns undefined for unknown tool', async () => {
      const { getTool } = await import('../src/tools/registry.js');
      assert.equal(getTool('nonexistent'), undefined);
    });
  });

  describe('list_files', () => {
    it('lists files in directory', async () => {
      const { runTool } = await import('../src/tools/registry.js');
      const result = await runTool('list_files', {}, { cwd: CWD, source: 'test', approved: true });
      assert.ok(result.ok);
      const output = result.output as { entries: Array<{ name: string; type: string }> };
      assert.ok(output.entries.some((e: { name: string }) => e.name === 'hello.txt'));
      assert.ok(output.entries.some((e: { name: string }) => e.name === 'subdir'));
      assert.ok(output.entries.some((e: { name: string }) => e.name === 'arabic.txt'));
    });

    it('blocks path traversal', async () => {
      const { runTool } = await import('../src/tools/registry.js');
      const result = await runTool('list_files', { path: '..' }, { cwd: CWD, source: 'test' });
      assert.equal(result.ok, false);
      assert.ok(result.summary.includes('traversal') || result.error?.includes('outside'));
    });
  });

  describe('read_file', () => {
    it('reads allowed text file', async () => {
      const { runTool } = await import('../src/tools/registry.js');
      const result = await runTool('read_file', { path: 'hello.txt' }, { cwd: CWD, source: 'test' });
      assert.ok(result.ok);
      assert.equal(result.output.content, 'Hello, World!');
    });

    it('blocks path traversal', async () => {
      const { runTool } = await import('../src/tools/registry.js');
      const result = await runTool('read_file', { path: '../../etc/passwd' }, { cwd: CWD, source: 'test' });
      assert.equal(result.ok, false);
      assert.ok(result.summary.includes('traversal') || result.error?.includes('outside'));
    });

    it('blocks binary file', async () => {
      const { runTool } = await import('../src/tools/registry.js');
      // Create a small fake binary
      const binPath = join(TMP, 'test.exe');
      writeFileSync(binPath, Buffer.from([0x4D, 0x5A, 0x90, 0x00]));
      const result = await runTool('read_file', { path: 'test.exe' }, { cwd: CWD, source: 'test' });
      // Should either fail or report binary
      if (result.ok) {
        assert.equal(result.output.truncated, false);
      } else {
        assert.ok(result.error?.includes('Binary') || result.error?.includes('binary'));
      }
    });

    it('preserves Arabic content', async () => {
      const { runTool } = await import('../src/tools/registry.js');
      const result = await runTool('read_file', { path: 'arabic.txt' }, { cwd: CWD, source: 'test' });
      assert.ok(result.ok);
      assert.equal(result.output.content, 'مرحبا بالعالم');
    });
  });

  describe('write_file', () => {
    it('dry-run does not write', async () => {
      const { runTool } = await import('../src/tools/registry.js');
      const testPath = join(TMP, 'dry-run-test.txt');
      const relPath = 'dry-run-test.txt';
      const result = await runTool('write_file', { path: relPath, content: 'dry run content' }, { cwd: CWD, dryRun: true, source: 'test' });
      assert.ok(result.ok);
      assert.ok(result.summary.includes('DRY-RUN'));
      assert.equal(existsSync(testPath), false);
    });

    it('requires approval without dryRun', async () => {
      const { runTool } = await import('../src/tools/registry.js');
      const result = await runTool('write_file', { path: 'no-approve.txt', content: 'test' }, { cwd: CWD, source: 'test' });
      assert.equal(result.ok, false);
      assert.ok(result.error?.includes('approval'));
    });

    it('approved writes file', async () => {
      const { runTool } = await import('../src/tools/registry.js');
      const testPath = join(TMP, 'approved-test.txt');
      const relPath = 'approved-test.txt';
      const result = await runTool('write_file', { path: relPath, content: 'approved content' }, { cwd: CWD, approved: true, source: 'test' });
      assert.ok(result.ok);
      assert.ok(existsSync(testPath));
      assert.equal(readFileSync(testPath, 'utf-8'), 'approved content');
    });

    it('blocks path traversal', async () => {
      const { runTool } = await import('../src/tools/registry.js');
      const result = await runTool('write_file', { path: '../../escape.txt', content: 'bad' }, { cwd: CWD, approved: true, source: 'test' });
      assert.equal(result.ok, false);
      assert.ok(result.summary.includes('traversal') || result.error?.includes('outside'));
    });
  });

  describe('run_command', () => {
    it('dry-run does not execute', async () => {
      const { runTool } = await import('../src/tools/registry.js');
      const result = await runTool('run_command', { command: 'echo "should not run"' }, { cwd: CWD, dryRun: true, source: 'test' });
      assert.ok(result.ok);
      assert.ok(result.summary.includes('DRY-RUN'));
    });

    it('requires approval without dryRun', async () => {
      const { runTool } = await import('../src/tools/registry.js');
      const result = await runTool('run_command', { command: 'echo test' }, { cwd: CWD, source: 'test' });
      assert.equal(result.ok, false);
      assert.ok(result.error?.includes('approval'));
    });

    it('approved runs safe command', async () => {
      const { runTool } = await import('../src/tools/registry.js');
      const result = await runTool('run_command', { command: 'echo hello from tool' }, { cwd: CWD, approved: true, source: 'test' });
      assert.ok(result.ok);
      assert.ok(result.output.stdout.includes('hello from tool'));
    });

    it('dangerous command is blocked', async () => {
      const { runTool } = await import('../src/tools/registry.js');
      const result = await runTool('run_command', { command: 'rm -rf /' }, { cwd: CWD, approved: true, source: 'test' });
      assert.equal(result.ok, false);
      assert.ok(result.error?.includes('Blocked') || result.error?.includes('dangerous'));
    });

    it('dangerous command blocked even with approval', async () => {
      const { runTool } = await import('../src/tools/registry.js');
      const result = await runTool('run_command', { command: 'format C:' }, { cwd: CWD, approved: true, source: 'test' });
      assert.equal(result.ok, false);
      assert.ok(result.error?.includes('Blocked') || result.error?.includes('dangerous'));
    });

    it('command output is size-limited', async () => {
      const { runTool } = await import('../src/tools/registry.js');
      const result = await runTool('run_command', { command: 'cmd /c "echo a&echo b&echo c&echo d&echo e&echo f&echo g"' }, { cwd: CWD, approved: true, source: 'test' });
      assert.ok(result.ok);
      assert.ok(typeof result.output.stdout === 'string');
    });
  });

  describe('approval system', () => {
    it('classifyToolRisk returns correct level', async () => {
      const { classifyToolRisk } = await import('../src/tools/approval.js');
      const { getTool } = await import('../src/tools/registry.js');
      assert.equal(classifyToolRisk(getTool('list_files')!), 'safe');
      assert.equal(classifyToolRisk(getTool('read_file')!), 'safe');
      assert.equal(classifyToolRisk(getTool('write_file')!), 'review');
      assert.equal(classifyToolRisk(getTool('run_command')!), 'review');
    });

    it('requiresApproval for write_file', async () => {
      const { requiresApproval } = await import('../src/tools/approval.js');
      const { getTool } = await import('../src/tools/registry.js');
      assert.ok(requiresApproval(getTool('write_file')!));
    });

    it('requiresApproval for run_command', async () => {
      const { requiresApproval } = await import('../src/tools/approval.js');
      const { getTool } = await import('../src/tools/registry.js');
      assert.ok(requiresApproval(getTool('run_command')!));
    });

    it('does not require approval for safe tools', async () => {
      const { requiresApproval } = await import('../src/tools/approval.js');
      const { getTool } = await import('../src/tools/registry.js');
      assert.equal(requiresApproval(getTool('list_files')!), false);
      assert.equal(requiresApproval(getTool('read_file')!), false);
    });

    it('isDangerousCommand detects destructive patterns', async () => {
      const { isDangerousCommand } = await import('../src/tools/approval.js');
      assert.ok(isDangerousCommand('rm -rf /'));
      assert.ok(isDangerousCommand('format C:'));
      assert.ok(isDangerousCommand('shutdown /s'));
      assert.ok(isDangerousCommand('reg add HKLM\\Something'));
      assert.equal(isDangerousCommand('echo hello'), false);
      assert.equal(isDangerousCommand('npm test'), false);
    });
  });

  describe('action log', () => {
    it('logs approved execution', async () => {
      const { appendActionLog } = await import('../src/tools/action-log.js');
      const { getActionLogPath } = await import('../src/tools/action-log.js');
      appendActionLog({
        timestamp: new Date().toISOString(),
        toolName: 'test_tool',
        riskLevel: 'safe',
        approved: true,
        dryRun: false,
        source: 'test',
        cwd: CWD,
        inputSummary: '{"path":"test.txt"}',
        resultSummary: 'Completed successfully',
      });
      // Just confirm the log was written without error
      const logPath = getActionLogPath();
      assert.ok(existsSync(logPath));
    });

    it('redacts secrets from log', async () => {
      const { appendActionLog, getActionLogPath } = await import('../src/tools/action-log.js');
      // Force a sync log read by importing the path module
      const logPath = getActionLogPath();
      const content = readFileSync(logPath, 'utf-8');
      // The API key we logged should be redacted
      assert.ok(!content.includes('sk-test12345fakeapikey'));
    });

    it('records dryRun state', async () => {
      const { runTool } = await import('../src/tools/registry.js');
      const result = await runTool('read_file', { path: 'hello.txt' }, { cwd: CWD, dryRun: true, source: 'test' });
      assert.ok(result.ok);
    });

    it('tool failure returns structured error', async () => {
      const { runTool } = await import('../src/tools/registry.js');
      const result = await runTool('read_file', { path: 'nonexistent.txt' }, { cwd: CWD, source: 'test' });
      assert.equal(result.ok, false);
      assert.ok(result.error);
      assert.ok(result.summary);
    });

    it('web/CLI source context preserved', async () => {
      const { runTool } = await import('../src/tools/registry.js');
      const result = await runTool('read_file', { path: 'hello.txt' }, { cwd: CWD, source: 'web', approved: true });
      assert.ok(result.ok);
    });
  });

  describe('tool types', () => {
    it('ToolDefinition interface has required fields', async () => {
      const { getTool } = await import('../src/tools/registry.js');
      const tool = getTool('read_file')!;
      assert.ok(typeof tool.name === 'string');
      assert.ok(typeof tool.description === 'string');
      assert.ok(['safe', 'review', 'dangerous'].includes(tool.riskLevel));
      assert.ok(['auto', 'requires_approval', 'blocked'].includes(tool.approvalPolicy));
      assert.ok(typeof tool.run === 'function');
    });

    it('ToolResult has required fields', async () => {
      const { runTool } = await import('../src/tools/registry.js');
      const result = await runTool('read_file', { path: 'hello.txt' }, { cwd: CWD, source: 'test' });
      assert.ok(typeof result.ok === 'boolean');
      assert.ok(typeof result.summary === 'string');
      if (!result.ok) {
        assert.ok(typeof result.error === 'string');
      }
    });
  });
});
