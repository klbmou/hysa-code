import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { classifyTask } from '../src/ai/task-classifier.js';
import { getCandidatesForTask } from '../src/ai/model-registry.js';
import type { HysaConfig } from '../src/config/keys.js';
import { hasVisionCapability, isModelVisionCapable, isProviderVisionCapable, getVisionCapableProviders, providerHasCapability } from '../src/ai/provider-capabilities.js';
import { getSuggestedFallbackAction, getAvailableFallbackProviders, isProviderUsable } from '../src/ai/provider-policy.js';
import { applyTaskBasedRouting, buildAttemptPlan } from '../src/ai/smart-router.js';

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

  it('openai_router prefers configured currentModel over task priority for simple_chat', () => {
    const config = mockConfig({ currentProvider: 'openai_router', currentModel: 'oc/deepseek-v4-flash-free', apiKeys: { openai: 'sk-test' }, openaiRouterBaseUrl: 'http://router' } as unknown as Partial<HysaConfig>);
    const candidates = getCandidatesForTask('simple_chat', config, neverHealthy());
    const first = candidates[0];
    assert.equal(first.provider, 'openai_router', 'first candidate should be from openai_router');
    assert.equal(first.model, 'oc/deepseek-v4-flash-free', 'configured model should appear before qw/qwen3-coder-flash despite fast priority');
    const qwenFastIdx = candidates.findIndex(c => c.model === 'qw/qwen3-coder-flash');
    const configuredIdx = candidates.findIndex(c => c.model === 'oc/deepseek-v4-flash-free');
    assert.ok(qwenFastIdx > configuredIdx, 'qw/qwen3-coder-flash (fast) should come after configured oc/deepseek-v4-flash-free (balanced)');
  });

  it('openai_router configured model is first candidate even when other model has faster priority', () => {
    const config = mockConfig({ currentProvider: 'openai_router', currentModel: 'oc/deepseek-v4-flash-free', apiKeys: { openai: 'sk-test' }, openaiRouterBaseUrl: 'http://router' } as unknown as Partial<HysaConfig>);
    const candidates = getCandidatesForTask('simple_chat', config, neverHealthy());
    const first = candidates[0];
    assert.equal(first.model, 'oc/deepseek-v4-flash-free', 'oc/deepseek-v4-flash-free (balanced) should sort before qw/qwen3-coder-flash (fast)');
    const openAiGptIdx = candidates.findIndex(c => c.model === 'openai/gpt-4o-mini');
    const configuredIdx = candidates.findIndex(c => c.model === 'oc/deepseek-v4-flash-free');
    assert.ok(configuredIdx < openAiGptIdx, 'configured deepseek model should sort before openai/gpt-4o-mini');
  });

  it('openai_router configured currentModel is respected even when not in registry', () => {
    const config = mockConfig({ currentProvider: 'openai_router', currentModel: 'unknown/custom-model', apiKeys: { openai: 'sk-test' }, openaiRouterBaseUrl: 'http://router' } as unknown as Partial<HysaConfig>);
    const candidates = getCandidatesForTask('simple_chat', config, neverHealthy());
    const first = candidates[0];
    assert.equal(first.provider, 'openai_router', 'first should be from openai_router');
    assert.equal(first.model, 'unknown/custom-model', 'custom model not in registry should be added and sorted first');
  });

  it('end-to-end: getCandidatesForTask + buildAttemptPlan returns configured model first for simple_chat', () => {
    const config = mockConfig({ currentProvider: 'openai_router', currentModel: 'oc/deepseek-v4-flash-free', apiKeys: { openai: 'sk-test' }, openaiRouterBaseUrl: 'http://router' } as unknown as Partial<HysaConfig>);
    const candidates = getCandidatesForTask('simple_chat', config, neverHealthy());
    const taskRouted = applyTaskBasedRouting(candidates, 'simple_chat', 'hi', config);
    const attempts = buildAttemptPlan(taskRouted, 'simple_chat', 6);
    assert.ok(attempts.length > 0, 'should have at least one attempt');
    const first = attempts[0];
    assert.equal(first.provider, 'openai_router', 'first attempt should be openai_router');
    assert.equal(first.model, 'oc/deepseek-v4-flash-free', 'first attempt should be configured model oc/deepseek-v4-flash-free, not qw/qwen3-coder-flash');
    assert.ok(attempts.some(c => c.model === 'qw/qwen3-coder-flash'), 'qw/qwen3-coder-flash should still be in candidate list as fallback');
    const configuredIdx = attempts.findIndex(c => c.model === 'oc/deepseek-v4-flash-free');
    const qwenIdx = attempts.findIndex(c => c.model === 'qw/qwen3-coder-flash');
    assert.ok(configuredIdx < qwenIdx, 'configured model should sort before qw/qwen3-coder-flash');
  });
});

describe('getSuggestedFallbackAction', () => {
  const routerConfig: HysaConfig = {
    currentProvider: 'openai_router',
    currentModel: 'oc/deepseek-v4-flash-free',
    apiKeys: { openai: 'sk-test' },
    openaiRouterBaseUrl: 'http://router',
    ollamaBaseUrl: 'http://localhost:11434',
    debug: false,
    lightMode: false,
    promptMode: 'auto',
    agentMode: 'chat',
  } as HysaConfig;

  it('returns rate limit message for openai_router', () => {
    const msg = getSuggestedFallbackAction('openai_router', routerConfig, 'rate limit exceeded');
    assert.ok(msg.includes('rate-limited'), 'rate limit message should contain rate-limited');
    assert.ok(msg.includes('Local fallback is disabled'), 'should mention local fallback');
  });

  it('returns not usable message for unconfigured provider', () => {
    const config: HysaConfig = { ...routerConfig, anthropicProxyBaseUrl: '' } as HysaConfig;
    const msg = getSuggestedFallbackAction('anthropic_proxy', config, undefined);
    assert.ok(msg.includes('not currently usable'), 'unconfigured provider should show not usable');
  });

  it('returns no action needed when provider is usable and fallback providers exist', () => {
    const usable = isProviderUsable('openai_router', routerConfig);
    const fallbacks = getAvailableFallbackProviders(routerConfig);
    const msg = getSuggestedFallbackAction('openai_router', routerConfig, undefined);
    assert.ok(usable, `provider should be usable`);
    assert.ok(fallbacks.length === 0 || msg === 'No action needed. A usable provider is available.' || msg.includes('usable fallback providers'), `usable=${usable} fallbacks=${fallbacks.length} msg=${msg}`);
  });

  it('returns no action needed when last error exists but fallback providers are available', () => {
    const msg = getSuggestedFallbackAction('openai_router', routerConfig, 'connection failed');
    assert.equal(msg, 'No action needed. A usable provider is available.');
  });
});
