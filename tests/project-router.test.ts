import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { decideProjectMode } from '../src/context/project-router.js';
import { classifyTask } from '../src/ai/task-classifier.js';

function classify(msg: string) {
  return classifyTask([{ role: 'user', content: msg }]);
}

describe('project-router', () => {
  it('workspace loaded + explain the project structure briefly => project mode', () => {
    const msg = 'Explain the project structure briefly';
    const taskKind = classify(msg);
    const result = decideProjectMode(msg, true, taskKind);
    assert.equal(result.projectMode, true, `Should be project mode, got: ${result.reason}`);
  });

  it('workspace loaded + find one small bug or improvement => project mode', () => {
    const msg = 'Find one small bug or improvement';
    const taskKind = classify(msg);
    const result = decideProjectMode(msg, true, taskKind);
    assert.equal(result.projectMode, true, `Should be project mode, got: ${result.reason}`);
  });

  it('workspace loaded + who is rifka => general mode', () => {
    const msg = 'who is rifka';
    const taskKind = classify(msg);
    const result = decideProjectMode(msg, true, taskKind);
    assert.equal(result.projectMode, false, `Should be general mode, got: ${result.reason}`);
  });

  it('workspace loaded + what is quantum physics => general mode', () => {
    const msg = 'what is quantum physics';
    const taskKind = classify(msg);
    const result = decideProjectMode(msg, true, taskKind);
    assert.equal(result.projectMode, false, `Should be general mode, got: ${result.reason}`);
  });

  it('workspace loaded + find bug (short) => project mode', () => {
    const msg = 'find bug';
    const taskKind = classify(msg);
    const result = decideProjectMode(msg, true, taskKind);
    assert.equal(result.projectMode, true, `Should be project mode, got: ${result.reason}`);
  });

  it('workspace loaded + explain this project => project mode', () => {
    const msg = 'explain this project';
    const taskKind = classify(msg);
    const result = decideProjectMode(msg, true, taskKind);
    assert.equal(result.projectMode, true, `Should be project mode, got: ${result.reason}`);
  });

  it('no workspace => not project mode', () => {
    const result = decideProjectMode('hello', false, 'simple_chat');
    assert.equal(result.projectMode, false);
    assert.ok(result.reason.includes('No workspace'));
  });

  it('workspace loaded + greeting => not project mode', () => {
    const msg = 'hello';
    const taskKind = classify(msg);
    const result = decideProjectMode(msg, true, taskKind);
    assert.equal(result.projectMode, false, `Should not be project mode, got: ${result.reason}`);
  });

  it('workspace loaded + search the web for X => general mode', () => {
    const msg = 'search the web for latest news';
    const taskKind = classify(msg);
    const result = decideProjectMode(msg, true, taskKind);
    assert.equal(result.projectMode, false, `Should be general mode, got: ${result.reason}`);
  });

  it('project mode never triggers for general biography questions', () => {
    const msg = 'tell me about Albert Einstein';
    const taskKind = classify(msg);
    const result = decideProjectMode(msg, true, taskKind);
    assert.equal(result.projectMode, false, `Should be general mode, got: ${result.reason}`);
  });

  it('workspace loaded + analyze code => project mode', () => {
    const msg = 'analyze the code for bugs';
    const taskKind = classify(msg);
    const result = decideProjectMode(msg, true, taskKind);
    assert.equal(result.projectMode, true, `Should be project mode, got: ${result.reason}`);
  });

  it('workspace loaded + look up refka => general mode (explicit search)', () => {
    const msg = 'look up refka';
    const taskKind = classify(msg);
    const result = decideProjectMode(msg, true, taskKind);
    assert.equal(result.projectMode, false, `Should be general mode, got: ${result.reason}`);
  });

  it('workspace loaded + history of React => general mode', () => {
    const msg = 'history of React';
    const taskKind = classify(msg);
    const result = decideProjectMode(msg, true, taskKind);
    assert.equal(result.projectMode, false, `Should be general mode, got: ${result.reason}`);
  });

  it('workspace loaded + fix this bug in the code => project mode', () => {
    const msg = 'fix this bug in the code';
    const taskKind = classify(msg);
    const result = decideProjectMode(msg, true, taskKind);
    assert.equal(result.projectMode, true, `Should be project mode, got: ${result.reason}`);
  });
});
