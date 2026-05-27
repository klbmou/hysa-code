import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { detectShell, shellInfo, translateCommand, isWindowsShell, isCommandAvailable } from '../src/utils/shell.js';

describe('shell utils', () => {
  it('detectShell returns a valid shell type', () => {
    const shell = detectShell();
    assert.ok(['powershell', 'cmd', 'bash', 'wsl'].includes(shell), `Unknown shell: ${shell}`);
  });

  it('shellInfo returns non-empty string', () => {
    const info = shellInfo();
    assert.ok(typeof info === 'string');
    assert.ok(info.length > 0);
  });

  it('shellInfo mentions head/tail/grep/find/cat on Windows', () => {
    if (process.platform === 'win32') {
      const info = shellInfo();
      assert.ok(info.toLowerCase().includes('head'), 'Windows shellInfo should mention alternative to head');
      assert.ok(info.toLowerCase().includes('grep'), 'Windows shellInfo should mention alternative to grep');
    }
  });

  it('shellInfo describes POSIX on non-Windows', () => {
    if (process.platform !== 'win32') {
      const info = shellInfo();
      assert.ok(info.includes('POSIX'), 'Non-Windows shellInfo should mention POSIX');
    }
  });

  it('npm and git commands pass through unchanged', () => {
    assert.equal(translateCommand('npm test'), 'npm test');
    assert.equal(translateCommand('npm run build'), 'npm run build');
    assert.equal(translateCommand('git status'), 'git status');
    assert.equal(translateCommand('git log --oneline -5'), 'git log --oneline -5');
    assert.equal(translateCommand('npx tsc --noEmit'), 'npx tsc --noEmit');
    assert.equal(translateCommand('node ./scripts/build.js'), 'node ./scripts/build.js');
    assert.equal(translateCommand('tsc'), 'tsc');
  });

  it('isCommandAvailable returns boolean', () => {
    const result = isCommandAvailable('node');
    assert.ok(typeof result === 'boolean');
  });

  it('translation is identity on non-Windows', () => {
    if (process.platform !== 'win32') {
      const cmd = 'find . -name "*.ts" | head -80';
      assert.equal(translateCommand(cmd), cmd);
    }
  });
});
