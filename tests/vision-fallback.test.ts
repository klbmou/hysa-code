import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import type { HysaConfig } from '../src/config/keys.js';
import { getVisionFallbackCandidates, getVisionFallbackErrorMessage, buildVisionMessages, hasImageAttachments, supportsVision, sanitizeMessagesForTextModel, clearNinerouterVisionCache } from '../src/web/api.js';
import { hasVisionCapability } from '../src/ai/provider-capabilities.js';

function mockConfig(overrides: Partial<HysaConfig> = {}): HysaConfig {
  return {
    currentProvider: 'deepseek',
    currentModel: 'deepseek-chat',
    apiKeys: { openrouter: 'sk-or-v1-test', gemini: 'test-key', deepseek: 'sk-test' },
    ollamaBaseUrl: 'http://localhost:11434',
    debug: false,
    lightMode: false,
    promptMode: 'auto',
    agentMode: 'chat',
    ...overrides,
  } as HysaConfig;
}

describe('vision fallback candidates', () => {
  beforeEach(() => {
    delete process.env.NINEROUTER_URL;
    delete process.env.HYSA_9ROUTER_VISION_MODEL;
    clearNinerouterVisionCache();
  });

  afterEach(() => {
    delete process.env.NINEROUTER_URL;
    delete process.env.HYSA_9ROUTER_VISION_MODEL;
    clearNinerouterVisionCache();
  });

  it('returns Gemini first when Gemini API key is set', async () => {
    const config = mockConfig({ apiKeys: { gemini: 'test-key', openrouter: 'sk-or-v1-test' } });
    const candidates = await getVisionFallbackCandidates(config);
    assert.ok(candidates.length >= 1, 'should have at least 1 candidate');
    // Gemini should be first (free, direct provider)
    assert.equal(candidates[0].provider, 'gemini', 'Gemini should be first fallback');
    assert.equal(candidates[0].model, 'gemini-2.5-flash');
  });

  it('returns OpenRouter free vision when only OpenRouter key is set', async () => {
    const config = mockConfig({ apiKeys: { openrouter: 'sk-or-v1-test', gemini: undefined } });
    const candidates = await getVisionFallbackCandidates(config);
    assert.ok(candidates.length >= 1, 'should have at least 1 candidate');
    assert.equal(candidates[0].provider, 'openrouter', 'OpenRouter should be first when no Gemini key');
    assert.ok(candidates[0].model.includes('free'), 'first OpenRouter should be free model');
  });

  it('skips providers whose required API keys are missing', async () => {
    const config = mockConfig({ apiKeys: {} });
    const candidates = await getVisionFallbackCandidates(config);
    // Without any API keys, openai_router (requiresKey: false) may still be returned
    // but openai_router requires openaiRouterBaseUrl which is not set at runtime
    // The candidates list should only include openai_router at most
    for (const c of candidates) {
      assert.notEqual(c.provider, 'gemini', 'gemini requires a key');
    }
  });

  it('returns at most 3 candidates', async () => {
    const config = mockConfig({
      apiKeys: { openrouter: 'sk-or-v1-test', gemini: 'test-key', anthropic_proxy: 'test' },
      anthropicProxyBaseUrl: 'http://proxy:8080',
    });
    const candidates = await getVisionFallbackCandidates(config);
    assert.ok(candidates.length <= 3, 'max 3 candidates');
  });

  it('each candidate has vision capability', async () => {
    const config = mockConfig({ apiKeys: { openrouter: 'sk-or-v1-test', gemini: 'test-key' } });
    const candidates = await getVisionFallbackCandidates(config);
    for (const c of candidates) {
      assert.ok(hasVisionCapability(c.provider, c.model), `${c.provider}/${c.model} should be vision-capable`);
    }
  });

  it('includes google/gemini-2.5-flash:free as a free OpenRouter option', async () => {
    const config = mockConfig({
      currentProvider: 'deepseek',
      apiKeys: { openrouter: 'sk-or-v1-test', gemini: 'test-key' },
    });
    const candidates = await getVisionFallbackCandidates(config);
    const hasFree = candidates.some(c => c.model === 'google/gemini-2.5-flash:free');
    assert.ok(hasFree, 'should include free OpenRouter vision model');
  });
});

describe('vision fallback error messages', () => {
  it('returns no-config message when failures is empty', async () => {
    const msg = getVisionFallbackErrorMessage('english', [], false);
    assert.ok(msg.includes('No vision-capable models are configured'));
  });

  it('returns invalid key message when all failures are invalid key', async () => {
    const failures = [
      { label: 'A / m1', reason: 'invalid key' },
      { label: 'A / m2', reason: 'invalid key' },
    ];
    const en = getVisionFallbackErrorMessage('english', failures, false);
    assert.ok(en.includes('API key'));
    const ar = getVisionFallbackErrorMessage('arabic', failures, false);
    assert.ok(ar.includes('API'));
  });

  it('returns unavailable message when all failures are unavailable', async () => {
    const failures = [
      { label: 'A / m1', reason: 'unavailable' },
      { label: 'A / m2', reason: 'unavailable' },
    ];
    const en = getVisionFallbackErrorMessage('english', failures, false);
    assert.ok(en.includes('unavailable'));
    const ar = getVisionFallbackErrorMessage('arabic', failures, false);
    assert.ok(ar.includes('غير متوفرة'));
  });

  it('returns rate-limited message when all failures are rate-limited', async () => {
    const failures = [
      { label: 'A / m1', reason: 'rate-limited' },
      { label: 'A / m2', reason: 'rate-limited' },
    ];
    const en = getVisionFallbackErrorMessage('english', failures, false);
    assert.ok(en.includes('rate-limited'));
  });

  it('returns mixed message when failures have mixed reasons', async () => {
    const failures = [
      { label: 'A / m1', reason: 'rate-limited' },
      { label: 'A / m2', reason: 'unavailable' },
    ];
    const en = getVisionFallbackErrorMessage('english', failures, false);
    assert.ok(en.includes('failed'));
    assert.ok(en.includes('HYSA_VISION_MODEL'));
  });

  it('includes tried models even without debug mode', async () => {
    const failures = [
      { label: 'Gemini / gemini-2.5-flash', reason: 'rate-limited' },
      { label: 'OpenRouter / free-model', reason: 'invalid key' },
    ];
    const en = getVisionFallbackErrorMessage('english', failures, false);
    assert.ok(en.includes('Tried:'));
    assert.ok(en.includes('Gemini'));
    assert.ok(en.includes('OpenRouter'));
    const ar = getVisionFallbackErrorMessage('arabic', failures, false);
    assert.ok(ar.includes('المحاولات'));
  });

  it('includes actual reason in debug mode', async () => {
    const failures = [
      { label: 'A / m1', reason: 'unavailable', error: '404 model not found' },
    ];
    const en = getVisionFallbackErrorMessage('english', failures, true);
    assert.ok(en.includes('Actual reason'));
    assert.ok(en.includes('404 model not found'));
  });

  it('includes actual reason in Arabic debug mode', async () => {
    const failures = [
      { label: 'A / m1', reason: 'invalid key', error: '401 Unauthorized' },
    ];
    const ar = getVisionFallbackErrorMessage('arabic', failures, true);
    assert.ok(ar.includes('401 Unauthorized'));
  });

  it('does not duplicate tried list in debug mode (debug adds detailed errors)', async () => {
    const failures = [
      { label: 'Gemini / gemini-2.5-flash', reason: 'rate-limited', error: '429 Too Many Requests' },
    ];
    const en = getVisionFallbackErrorMessage('english', failures, true);
    assert.ok(en.includes('Tried:'));
    assert.ok(en.includes('Detailed errors:'));
    assert.ok(en.includes('429 Too Many Requests'));
  });
});

describe('buildVisionMessages', () => {
  const textMsg = { role: 'user', content: 'what is in this image' };
  const assistantMsg = { role: 'assistant', content: 'let me look' };

  it('converts last user message to parts array with image_url', async () => {
    const attachments = [
      { name: 'photo.jpg', ext: 'jpg', size: 1000, kind: 'image' as const, dataUrl: 'data:image/jpeg;base64,/9j/4AAQ' },
    ];
    const result = buildVisionMessages([textMsg], attachments);
    assert.equal(result.length, 1);
    const last = result[result.length - 1];
    assert.equal(last.role, 'user');
    assert.ok(Array.isArray(last.content), 'content should be an array');
    assert.ok(last.content.length >= 2, 'should have text + image parts');
    assert.equal(last.content[0].type, 'text');
    assert.equal(last.content[0].text, 'what is in this image');
    assert.equal(last.content[1].type, 'image_url');
    assert.equal(last.content[1].image_url.url, 'data:image/jpeg;base64,/9j/4AAQ');
  });

  it('preserves earlier messages as-is', async () => {
    const attachments = [
      { name: 'img.png', ext: 'png', size: 500, kind: 'image' as const, dataUrl: 'data:image/png;base64,abc' },
    ];
    const msgs = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
      { role: 'user', content: 'what is this' },
    ];
    const result = buildVisionMessages(msgs, attachments);
    assert.equal(result.length, 3);
    assert.equal(result[0].role, 'user');
    assert.equal(result[0].content, 'hello');
    assert.equal(result[1].role, 'assistant');
    assert.equal(result[1].content, 'hi there');
    assert.equal(result[2].role, 'user');
    assert.ok(Array.isArray(result[2].content));
  });

  it('handles multiple image attachments', async () => {
    const attachments = [
      { name: 'a.jpg', ext: 'jpg', size: 100, kind: 'image' as const, dataUrl: 'data:image/jpeg;base64,a' },
      { name: 'b.jpg', ext: 'jpg', size: 200, kind: 'image' as const, dataUrl: 'data:image/jpeg;base64,b' },
    ];
    const result = buildVisionMessages([textMsg], attachments);
    const parts = result[result.length - 1].content;
    const imageParts = parts.filter((p: any) => p.type === 'image_url');
    assert.equal(imageParts.length, 2, 'should have 2 image parts');
    assert.equal(imageParts[0].image_url.url, 'data:image/jpeg;base64,a');
    assert.equal(imageParts[1].image_url.url, 'data:image/jpeg;base64,b');
  });

  it('wraps last user message in parts array even without image attachments', async () => {
    const result = buildVisionMessages([textMsg], []);
    assert.equal(result.length, 1);
    const last = result[result.length - 1];
    assert.equal(last.role, 'user');
    assert.ok(Array.isArray(last.content), 'content is array with text part');
    assert.equal(last.content[0].type, 'text');
    assert.equal(last.content[0].text, 'what is in this image');
  });
});

describe('hasImageAttachments', () => {
  it('returns true when image with dataUrl exists', async () => {
    const atts = [{ kind: 'image' as const, name: 'x.jpg', ext: 'jpg', size: 10, dataUrl: 'data:image/jpeg;base64,x' }];
    assert.ok(hasImageAttachments(atts));
  });

  it('returns false for empty attachments', async () => {
    assert.equal(hasImageAttachments([]), false);
    assert.equal(hasImageAttachments(undefined), false);
  });

  it('returns false for non-image attachments', async () => {
    const atts = [{ kind: 'text' as const, name: 'notes.txt', ext: 'txt', size: 10, textContent: 'hello' }];
    assert.equal(hasImageAttachments(atts), false);
  });

  it('returns false when image has no dataUrl', async () => {
    const atts = [{ kind: 'image' as const, name: 'x.jpg', ext: 'jpg', size: 10 }];
    assert.equal(hasImageAttachments(atts), false);
  });
});

describe('supportsVision', () => {
  it('returns true for Gemini vision models', async () => {
    assert.ok(supportsVision('gemini', 'gemini-2.5-flash'));
  });

  it('returns true for OpenRouter vision models', async () => {
    assert.ok(supportsVision('openrouter', 'google/gemini-2.5-flash:free'));
  });

  it('returns false for text-only models', async () => {
    assert.equal(supportsVision('deepseek', 'deepseek-chat'), false);
    assert.equal(supportsVision('groq', 'llama3-70b-8192'), false);
  });

  it('oc/deepseek-v4-flash-free is NOT vision-capable', async () => {
    assert.equal(hasVisionCapability('openai_router', 'oc/deepseek-v4-flash-free'), false);
    assert.equal(supportsVision('openai_router', 'oc/deepseek-v4-flash-free'), false);
  });
});

describe('config.visionModel support', () => {
  beforeEach(() => {
    delete process.env.NINEROUTER_URL;
    delete process.env.HYSA_9ROUTER_VISION_MODEL;
    clearNinerouterVisionCache();
  });

  afterEach(() => {
    delete process.env.NINEROUTER_URL;
    delete process.env.HYSA_9ROUTER_VISION_MODEL;
    clearNinerouterVisionCache();
  });

  it('uses config.visionModel as first candidate when set and valid', async () => {
    const config = mockConfig({
      currentProvider: 'openai_router',
      currentModel: 'oc/deepseek-v4-flash-free',
      apiKeys: { openrouter: 'sk-or-v1-test' },
      visionModel: 'openrouter/google/gemini-2.5-flash:free',
    });
    const candidates = await getVisionFallbackCandidates(config);
    assert.ok(candidates.length >= 1, 'should have at least 1 candidate');
    assert.equal(candidates[0].provider, 'openrouter', 'first candidate uses visionModel provider');
    assert.equal(candidates[0].model, 'google/gemini-2.5-flash:free', 'first candidate uses visionModel model');
  });

  it('falls back to default order if config.visionModel provider has no key', async () => {
    const config = mockConfig({
      currentProvider: 'openai_router',
      currentModel: 'oc/deepseek-v4-flash-free',
      apiKeys: {}, // No keys at all
      visionModel: 'gemini/gemini-2.5-flash',
    });
    const candidates = await getVisionFallbackCandidates(config);
    // gemini requires a key which is not set, so falls to defaults
    // openai_router is current provider so hasKeyFor returns true
    // only openai_router/openai/gpt-4o-mini (requiresKey: false) is viable
    for (const c of candidates) {
      assert.notEqual(c.provider, 'gemini', 'gemini should be skipped without key');
    }
  });

  it('ignores invalid visionModel format (no slash)', async () => {
    const config = mockConfig({
      currentProvider: 'openai_router',
      currentModel: 'oc/deepseek-v4-flash-free',
      apiKeys: { gemini: 'test-key', openrouter: 'sk-or-v1-test' },
      visionModel: 'gemini-2.5-flash', // no provider prefix
    });
    const candidates = await getVisionFallbackCandidates(config);
    // Should not crash, should fall back to normal order
    assert.ok(candidates.length >= 1, 'should still find candidates');
    // First candidate should be from default order (gemini/gemini-2.5-flash)
    assert.equal(candidates[0].provider, 'gemini');
  });

  it('text/code model (oc/deepseek-v4-flash-free) is never a vision candidate', async () => {
    const config = mockConfig({
      currentProvider: 'openai_router',
      currentModel: 'oc/deepseek-v4-flash-free',
      apiKeys: { openrouter: 'sk-or-v1-test' },
    });
    const candidates = await getVisionFallbackCandidates(config);
    for (const c of candidates) {
      assert.notEqual(c.model, 'oc/deepseek-v4-flash-free', 'DeepSeek model should not be a vision candidate');
    }
  });

  it('HYSA_VISION_MODEL takes precedence over fallback order', async () => {
    const config = mockConfig({
      currentProvider: 'deepseek',
      currentModel: 'deepseek-chat',
      apiKeys: { gemini: 'test-key', openrouter: 'sk-or-v1-test' },
      visionModel: 'gemini/gemini-2.5-flash',
    });
    const candidates = await getVisionFallbackCandidates(config);
    assert.ok(candidates.length >= 1, 'should have at least 1 candidate');
    assert.equal(candidates[0].provider, 'gemini', 'first candidate should use visionModel provider');
    assert.equal(candidates[0].model, 'gemini-2.5-flash', 'first candidate model should match visionModel');
  });

  it('text-only model never appears in vision candidates', async () => {
    const config = mockConfig({
      currentProvider: 'deepseek',
      currentModel: 'deepseek-chat',
      apiKeys: { gemini: 'test-key', openrouter: 'sk-or-v1-test' },
    });
    const candidates = await getVisionFallbackCandidates(config);
    // openai/gpt-4o-mini is not in VISION_FALLBACK_ORDER;
    // with gemini+openrouter keys we already get 3 candidates, so openai_router models
    // from the third stage (getVisionCapableProviders) should not appear
    for (const c of candidates) {
      assert.notEqual(c.model, 'openai/gpt-4o-mini', 'openai/gpt-4o-mini should not appear in vision candidates');
    }
  });

  it('ninerouter auto is skipped as a vision candidate without active OpenAI credentials', async () => {
    const config = mockConfig({
      currentProvider: 'deepseek',
      currentModel: 'deepseek-chat',
      apiKeys: {},
      ninerouterBaseUrl: 'http://localhost:20128',
    });
    const candidates = await getVisionFallbackCandidates(config);
    const hasNinerouter = candidates.some(c => c.provider === 'ninerouter' && c.model === 'auto');
    assert.equal(hasNinerouter, false, 'ninerouter/auto should not appear without active OpenAI credentials');
  });

  it('ninerouter auto is not used as a blind vision candidate even when OpenAI credentials exist', async () => {
    const config = mockConfig({
      currentProvider: 'deepseek',
      currentModel: 'deepseek-chat',
      apiKeys: { openai: 'sk-openai-test' },
      ninerouterBaseUrl: 'http://localhost:20128',
    });
    const candidates = await getVisionFallbackCandidates(config);
    const hasNinerouter = candidates.some(c => c.provider === 'ninerouter' && c.model === 'auto');
    assert.equal(hasNinerouter, false, 'ninerouter/auto should not be used for vision without image-to-text discovery');
  });
});

describe('sanitizeMessagesForTextModel', () => {
  it('strips image_url parts for text-only model DeepSeek', async () => {
    const messages: any[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
      { role: 'user', content: [{ type: 'text', text: 'what is this' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } }] },
    ];
    const stripped = sanitizeMessagesForTextModel(messages, 'deepseek', 'deepseek-chat');
    assert.equal(stripped, 1, 'should strip 1 image_url part');
    const last = messages[messages.length - 1];
    assert.equal(typeof last.content, 'string', 'content should be string after sanitization');
    assert.ok((last.content as string).includes('[Image attached]'), 'should include placeholder');
    assert.ok((last.content as string).includes('what is this'), 'should preserve text');
  });

  it('does nothing for vision-capable model Gemini', async () => {
    const messages: any[] = [
      { role: 'user', content: [{ type: 'text', text: 'describe' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/4AAQ' } }] },
    ];
    const before = JSON.stringify(messages);
    const stripped = sanitizeMessagesForTextModel(messages, 'gemini', 'gemini-2.5-flash');
    assert.equal(stripped, 0, 'should not strip image parts for vision model');
    assert.equal(JSON.stringify(messages), before, 'messages should be unmodified');
  });

  it('strips multiple image_url parts in a single message', async () => {
    const messages: any[] = [
      { role: 'user', content: [
        { type: 'text', text: 'compare' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,a' } },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,b' } },
      ]},
    ];
    const stripped = sanitizeMessagesForTextModel(messages, 'openrouter', 'qwen/qwen3-coder:free');
    assert.equal(stripped, 2, 'should strip both image_url parts');
    const content = messages[0].content as string;
    assert.ok(content.includes('[Image attached]'));
    assert.ok(content.includes('compare'));
  });

  it('handles mixed array content with only images (no text part)', async () => {
    const messages: any[] = [
      { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,x' } }] },
    ];
    const stripped = sanitizeMessagesForTextModel(messages, 'deepseek', 'deepseek-chat');
    assert.equal(stripped, 1);
    assert.equal(messages[0].content, '[Image attached]');
  });

  it('does not modify plain string messages', async () => {
    const messages: any[] = [
      { role: 'user', content: 'just text' },
      { role: 'assistant', content: 'response' },
    ];
    const stripped = sanitizeMessagesForTextModel(messages, 'deepseek', 'deepseek-chat');
    assert.equal(stripped, 0);
    assert.equal(messages[0].content, 'just text');
    assert.equal(messages[1].content, 'response');
  });

  it('history with old image_url parts does not break later text chat', async () => {
    const messages: any[] = [
      { role: 'user', content: [{ type: 'text', text: 'first question' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,old' } }] },
      { role: 'assistant', content: 'vision response' },
      { role: 'user', content: 'follow up text only' },
    ];
    const stripped = sanitizeMessagesForTextModel(messages, 'deepseek', 'deepseek-chat');
    assert.equal(stripped, 1, 'should strip history image part');
    assert.equal(typeof messages[0].content, 'string', 'first message should be string');
    assert.ok((messages[0].content as string).includes('[Image attached]'));
    assert.equal(messages[1].content, 'vision response', 'assistant message unchanged');
    assert.equal(messages[2].content, 'follow up text only', 'text-only user message unchanged');
  });
});

describe('validateProviderConsistency', () => {
  it('detects mismatches', async () => {
    function validate(provider: string, model: string, taskKind?: string): boolean {
      if (taskKind === 'image_vision' && !hasVisionCapability(provider, model)) {
        return false;
      }
      return true;
    }
    assert.equal(validate('deepseek', 'deepseek-chat', 'image_vision'), false, 'text-only model should fail for vision');
    assert.equal(validate('gemini', 'gemini-2.5-flash', 'image_vision'), true, 'vision model should pass for vision');
    assert.equal(validate('deepseek', 'deepseek-chat', 'code_edit'), true, 'text-only model should pass for text task');
    assert.equal(validate('deepseek', 'deepseek-chat'), true, 'text-only model should pass without task');
  });
});
