import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { classifyTask } from '../src/ai/task-classifier.js';
import { getCandidatesForTask } from '../src/ai/model-registry.js';
import type { HysaConfig } from '../src/config/keys.js';
import { hasVisionCapability, isModelVisionCapable, isProviderVisionCapable, getVisionCapableProviders, providerHasCapability } from '../src/ai/provider-capabilities.js';

function mockConfig(overrides: Partial<HysaConfig> = {}): HysaConfig {
  return {
    currentProvider: 'openrouter',
    currentModel: 'google/gemini-2.5-flash:free',
    apiKeys: { openrouter: 'sk-test', gemini: 'test-key' },
    ollamaBaseUrl: 'http://localhost:11434',
    debug: false,
    lightMode: false,
    promptMode: 'auto',
    agentMode: 'chat',
    ...overrides,
  } as HysaConfig;
}

function neverHealthy() {
  return { isOnCooldown: () => false, isUnhealthy: () => false, isProviderOnCooldown: () => false };
}

describe('provider capability routing', () => {
  it('hasVisionCapability detects vision-capable models', () => {
    assert.ok(hasVisionCapability('gemini', 'gemini-2.5-flash'));
    assert.ok(hasVisionCapability('openrouter', 'google/gemini-2.5-flash'));
    assert.equal(hasVisionCapability('openai_router', 'openai/gpt-4o-mini'), false, 'openai_router/gpt-4o-mini vision depends on backend');
  });

  it('hasVisionCapability returns false for text-only models', () => {
    assert.equal(hasVisionCapability('deepseek', 'deepseek-chat'), false);
    assert.equal(hasVisionCapability('groq', 'llama3-70b-8192'), false);
  });

  it('isModelVisionCapable matches by model name substring', () => {
    assert.ok(isModelVisionCapable('gemini-2.5-flash'));
    assert.ok(isModelVisionCapable('google/gemini-2.5-flash:free'));
  });

  it('isProviderVisionCapable checks provider-level vision support', () => {
    assert.ok(isProviderVisionCapable('gemini'));
    assert.ok(isProviderVisionCapable('openrouter'));
    assert.equal(isProviderVisionCapable('deepseek'), false);
    assert.equal(isProviderVisionCapable('groq'), false);
  });

  it('getVisionCapableProviders returns entries with vision capability', () => {
    const providers = getVisionCapableProviders();
    assert.ok(providers.length > 0);
    const gemini = providers.find(p => p.provider === 'gemini');
    assert.ok(gemini);
    assert.ok(gemini.model);
  });

  it('getCandidatesForTask with image_vision returns vision models', () => {
    const config = mockConfig();
    const candidates = getCandidatesForTask('image_vision', config, neverHealthy());
    assert.ok(candidates.length > 0, 'should have at least one vision candidate');
    for (const c of candidates) {
      assert.ok(
        hasVisionCapability(c.provider, c.model),
        `${c.label} should be vision-capable`,
      );
    }
  });

  it('text-only providers are skipped for image_vision', () => {
    const config = mockConfig({ currentProvider: 'deepseek' });
    const candidates = getCandidatesForTask('image_vision', config, neverHealthy());
    for (const c of candidates) {
      assert.ok(hasVisionCapability(c.provider, c.model), `${c.label} must be vision-capable`);
      assert.notEqual(c.provider, 'deepseek', 'deepseek should be excluded for vision');
    }
  });

  it('image attachment triggers image_vision classification', () => {
    const messages = [{ role: 'user', content: 'what is this' }];
    const attachments = [{ kind: 'image', name: 'photo.jpg', mime: 'image/jpeg', ext: 'jpg', size: 1000, dataUrl: 'data:image/jpeg;base64,abc' }];
    const kind = classifyTask(messages, attachments);
    assert.equal(kind, 'image_vision');
  });

  it('Arabic image prompt without attachment triggers image_vision', () => {
    const messages = [{ role: 'user', content: 'شرح لي هذا' }];
    const kind = classifyTask(messages);
    assert.equal(kind, 'image_vision');
  });

  it('Arabic prompt "حلل الصورة" triggers image_vision', () => {
    assert.equal(classifyTask([{ role: 'user', content: 'حلل الصورة' }]), 'image_vision');
  });

  it('Arabic prompt "ما هذا" triggers image_vision', () => {
    assert.equal(classifyTask([{ role: 'user', content: 'ما هذا' }]), 'image_vision');
  });

  it('Arabic prompt "وصف الصورة" triggers image_vision', () => {
    assert.equal(classifyTask([{ role: 'user', content: 'وصف الصورة' }]), 'image_vision');
  });

  it('no image attachments returns non-vision task for simple chat', () => {
    const messages = [{ role: 'user', content: 'hello' }];
    const kind = classifyTask(messages);
    assert.notEqual(kind, 'image_vision');
  });

  it('image_vision task kind gets vision-capable candidates even with text-only current provider', () => {
    const config = mockConfig({ currentProvider: 'deepseek', currentModel: 'deepseek-chat' });
    const candidates = getCandidatesForTask('image_vision', config, neverHealthy());
    assert.ok(candidates.length > 0, 'should find vision fallback candidates');
    for (const c of candidates) {
      assert.ok(hasVisionCapability(c.provider, c.model), `${c.label} must be vision-capable`);
    }
  });
});
