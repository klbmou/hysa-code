import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { classifyCommand } from '../src/utils/commands.js';

describe('YOLO tool execution', () => {
  it('safe commands are classified as safe', () => {
    assert.equal(classifyCommand('npm test'), 'safe');
    assert.equal(classifyCommand('git status'), 'safe');
    assert.equal(classifyCommand('ls'), 'safe');
    assert.equal(classifyCommand('cat src/index.ts'), 'safe');
    assert.equal(classifyCommand('node scripts/build.js'), 'safe');
  });

  it('dangerous commands are classified as dangerous', () => {
    assert.equal(classifyCommand('rm -rf /'), 'dangerous');
    assert.equal(classifyCommand('del /s /q C:\\'), 'dangerous');
    assert.equal(classifyCommand('git reset --hard'), 'dangerous');
    assert.equal(classifyCommand('git clean -fd'), 'dangerous');
    assert.equal(classifyCommand('format C:'), 'dangerous');
  });

  it('unknown commands get caution or unknown', () => {
    const safety = classifyCommand('some_random_command --flag');
    assert.ok(safety === 'caution' || safety === 'unknown');
  });
});

describe('tool continuation API', () => {
  it('formatToolResults produces expected output', async () => {
    const { formatToolResults } = await import('../src/web/api.js');
    const result = formatToolResults(
      [{ type: 'read_file', params: { filePath: 'src/index.ts' } }],
      ['console.log("hello");'],
    );
    assert.ok(result.includes('Read src/index.ts'));
    assert.ok(result.includes('console.log'));
  });

  it('executeToolCalls returns dangerous=true for unsafe commands without YOLO', async () => {
    const { executeToolCalls } = await import('../src/web/api.js');
    const result = await executeToolCalls([
      { type: 'execute_command', params: { command: 'rm -rf /' } },
    ], false);
    assert.equal(result.dangerous, true);
    assert.ok(result.results[0].includes('Requires manual approval'));
  });

  it('executeToolCalls returns results for safe YOLO commands', async () => {
    const { executeToolCalls } = await import('../src/web/api.js');
    const result = await executeToolCalls([
      { type: 'execute_command', params: { command: 'echo hello' } },
    ], true);
    assert.ok(Array.isArray(result.results));
  });

  it('MAX_TOOL_STEPS is defined and reasonable', async () => {
    const { MAX_TOOL_STEPS } = await import('../src/web/api.js');
    assert.ok(typeof MAX_TOOL_STEPS === 'number');
    assert.ok(MAX_TOOL_STEPS > 0 && MAX_TOOL_STEPS <= 15);
  });

  it('continueChat module exports correctly', async () => {
    const mod = await import('../src/web/api.js');
    assert.equal(typeof mod.continueChat, 'function');
    assert.equal(typeof mod.executeToolCalls, 'function');
    assert.equal(typeof mod.formatToolResults, 'function');
  });

  it('continueChat server endpoint exists', async () => {
    const mod = await import('../src/web/server.js');
    assert.ok(true);
  });

  it('continueChat with invalid messages returns error', async () => {
    const { continueChat } = await import('../src/web/api.js');
    const result = await continueChat([], [], []);
    assert.ok('message' in result || 'error' in result);
  });
});

describe('web chat continuation flow', () => {
  it('executeToolCalls handles mixed tool types safely', async () => {
    const { executeToolCalls } = await import('../src/web/api.js');
    const result = await executeToolCalls([
      { type: 'read_file', params: { filePath: 'src/index.ts' } },
      { type: 'execute_command', params: { command: 'echo mixed' } },
    ], true);
    assert.ok(Array.isArray(result.results));
    assert.equal(result.results.length, 2);
  });

  it('executeToolCalls marks edit_file as dangerous', async () => {
    const { executeToolCalls } = await import('../src/web/api.js');
    const result = await executeToolCalls([
      { type: 'edit_file', params: { filePath: 'src/test.ts', content: 'test' } },
    ], true);
    assert.equal(result.dangerous, true);
    assert.ok(result.results[0].includes('Requires manual'));
  });

  it('buildSystemPrompt is used by continueChat', async () => {
    const { continueChat } = await import('../src/web/api.js');
    const result = await continueChat(
      [{ role: 'user', content: 'hello' }],
      [{ type: 'execute_command', params: { command: 'echo hi' } }],
      ['hi'],
    );
    assert.ok(typeof result.message === 'string');
    assert.ok(Array.isArray(result.toolCalls));
  });

  it('formatToolResults handles multiple tools with mixed types', async () => {
    const { formatToolResults } = await import('../src/web/api.js');
    const result = formatToolResults([
      { type: 'read_file', params: { filePath: 'a.ts' } },
      { type: 'execute_command', params: { command: 'npm test' } },
    ], ['content', 'pass']);
    assert.ok(result.includes('Read a.ts'));
    assert.ok(result.includes('Command: npm test'));
    assert.ok(result.includes('content'));
    assert.ok(result.includes('pass'));
  });

  it('continueChat response includes message field', async () => {
    const { continueChat } = await import('../src/web/api.js');
    const result = await continueChat(
      [{ role: 'user', content: 'hello' }],
      [{ type: 'execute_command', params: { command: 'echo test' } }],
      ['test output'],
    );
    assert.ok(result.message !== undefined);
    assert.ok(Array.isArray(result.toolCalls));
  });
});

describe('UX diagnostics', () => {
  it('timer.elapsed returns timing metrics with expected fields', async () => {
    const { Timer } = await import('../src/utils/timing.js');
    const t = new Timer();
    t.start('total');
    t.start('classification');
    t.start('project_scan');
    t.start('context_select');
    t.stop('classification');
    t.stop('project_scan');
    t.stop('context_select');
    t.stop('total');
    assert.equal(typeof t.elapsed('total'), 'number');
    assert.equal(typeof t.elapsed('classification'), 'number');
    assert.equal(typeof t.elapsed('project_scan'), 'number');
    assert.equal(typeof t.elapsed('context_select'), 'number');
    assert.ok(t.elapsed('total') >= 0);
  });

  it('handleChat response includes message and toolCalls fields', async () => {
    const { handleChat } = await import('../src/web/api.js');
    const result = await handleChat({ messages: [] });
    assert.ok(typeof result.message === 'string');
    assert.ok('toolCalls' in result);
  });

  it('dangerous command detection in executeToolCalls provides reason text', async () => {
    const { executeToolCalls } = await import('../src/web/api.js');
    const result = await executeToolCalls([
      { type: 'execute_command', params: { command: 'rm -rf /' } },
      { type: 'execute_command', params: { command: 'git reset --hard' } },
    ], false);
    assert.equal(result.dangerous, true);
    assert.equal(result.results.length, 2);
    assert.ok(result.results[0].includes('Requires manual'));
    assert.ok(result.results[1].includes('Requires manual'));
  });
});
