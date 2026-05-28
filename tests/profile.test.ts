import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildMinimalSystemPrompt, buildCompactSystemPrompt, buildFullSystemPrompt, buildSystemPrompt } from '../src/prompts/system.js';
import type { ProviderType } from '../src/config/keys.js';

describe('user profile injection', () => {
  it('includes user name in minimal prompt when provided', () => {
    const prompt = buildMinimalSystemPrompt('Yahia');
    assert.ok(prompt.includes('Yahia'));
    assert.ok(prompt.includes('name is Yahia'));
  });

  it('does not include user name in minimal prompt when not provided', () => {
    const prompt = buildMinimalSystemPrompt();
    assert.ok(!prompt.includes('name is'));
  });

  it('includes user name in compact prompt when provided', () => {
    const prompt = buildCompactSystemPrompt(undefined, 'Yahia');
    assert.ok(prompt.includes('Yahia'));
    assert.ok(prompt.includes('name is Yahia'));
  });

  it('does not include user name in compact prompt when not provided', () => {
    const prompt = buildCompactSystemPrompt();
    assert.ok(!prompt.includes('name is'));
  });

  it('includes user name in full prompt via buildSystemPrompt', () => {
    const prompt = buildSystemPrompt(undefined, 'chat', false, 'openrouter' as ProviderType, 'auto', 'Yahia');
    assert.ok(prompt.includes('Yahia'));
    assert.ok(prompt.includes('name is Yahia'));
  });

  it('does not include user name in full prompt when not provided', () => {
    const prompt = buildSystemPrompt(undefined, 'chat', false, 'openrouter' as ProviderType, 'auto');
    assert.ok(!prompt.includes('name is'));
  });

  it('includes user name in minimal prompt via buildSystemPrompt', () => {
    const prompt = buildSystemPrompt(undefined, undefined, false, undefined, 'minimal', 'Yahia');
    assert.ok(prompt.includes('Yahia'));
    assert.ok(prompt.includes('name is Yahia'));
  });

  it('does not include user name in minimal prompt via buildSystemPrompt when not provided', () => {
    const prompt = buildSystemPrompt(undefined, undefined, false, undefined, 'minimal');
    assert.ok(!prompt.includes('name is'));
  });

  it('Arabic text in system prompt does not break with user name set', () => {
    const prompt = buildSystemPrompt(undefined, 'chat', false, 'openrouter' as ProviderType, 'auto', 'Yahia');
    assert.ok(prompt.includes('Yahia'));
  });
});
