import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import type { HysaConfig } from '../src/config/keys.js';
import { getVisionFallbackCandidates, getVisionFallbackErrorMessage, buildVisionMessages, hasImageAttachments, supportsVision } from '../src/web/api.js';
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
  it('returns Gemini first when Gemini API key is set', () => {
    const config = mockConfig({ apiKeys: { gemini: 'test-key', openrouter: 'sk-or-v1-test' } });
    const candidates = getVisionFallbackCandidates(config);
    assert.ok(candidates.length >= 1, 'should have at least 1 candidate');
    // Gemini should be first (free, direct provider)
    assert.equal(candidates[0].provider, 'gemini', 'Gemini should be first fallback');
    assert.equal(candidates[0].model, 'gemini-2.5-flash');
  });

  it('returns OpenRouter free vision when only OpenRouter key is set', () => {
    const config = mockConfig({ apiKeys: { openrouter: 'sk-or-v1-test', gemini: undefined } });
    const candidates = getVisionFallbackCandidates(config);
    assert.ok(candidates.length >= 1, 'should have at least 1 candidate');
    assert.equal(candidates[0].provider, 'openrouter', 'OpenRouter should be first when no Gemini key');
    assert.ok(candidates[0].model.includes('free'), 'first OpenRouter should be free model');
  });

  it('skips providers whose required API keys are missing', () => {
    const config = mockConfig({ apiKeys: {} });
    const candidates = getVisionFallbackCandidates(config);
    // Without any API keys, openai_router (requiresKey: false) may still be returned
    // but openai_router requires openaiRouterBaseUrl which is not set at runtime
    // The candidates list should only include openai_router at most
    for (const c of candidates) {
      assert.notEqual(c.provider, 'gemini', 'gemini requires a key');
    }
  });

  it('returns at most 3 candidates', () => {
    const config = mockConfig({
      apiKeys: { openrouter: 'sk-or-v1-test', gemini: 'test-key', anthropic_proxy: 'test' },
      anthropicProxyBaseUrl: 'http://proxy:8080',
    });
    const candidates = getVisionFallbackCandidates(config);
    assert.ok(candidates.length <= 3, 'max 3 candidates');
  });

  it('each candidate has vision capability', () => {
    const config = mockConfig({ apiKeys: { openrouter: 'sk-or-v1-test', gemini: 'test-key' } });
    const candidates = getVisionFallbackCandidates(config);
    for (const c of candidates) {
      assert.ok(hasVisionCapability(c.provider, c.model), `${c.provider}/${c.model} should be vision-capable`);
    }
  });

  it('includes google/gemini-2.5-flash:free as a free OpenRouter option', () => {
    const config = mockConfig({
      currentProvider: 'deepseek',
      apiKeys: { openrouter: 'sk-or-v1-test', gemini: 'test-key' },
    });
    const candidates = getVisionFallbackCandidates(config);
    const hasFree = candidates.some(c => c.model === 'google/gemini-2.5-flash:free');
    assert.ok(hasFree, 'should include free OpenRouter vision model');
  });
});

describe('vision fallback error messages', () => {
  it('returns no-config message when failures is empty', () => {
    const msg = getVisionFallbackErrorMessage('english', [], false);
    assert.ok(msg.includes('No vision-capable models are configured'));
  });

  it('returns invalid key message when all failures are invalid key', () => {
    const failures = [
      { label: 'A / m1', reason: 'invalid key' },
      { label: 'A / m2', reason: 'invalid key' },
    ];
    const en = getVisionFallbackErrorMessage('english', failures, false);
    assert.ok(en.includes('API key'));
    const ar = getVisionFallbackErrorMessage('arabic', failures, false);
    assert.ok(ar.includes('API'));
  });

  it('returns unavailable message when all failures are unavailable', () => {
    const failures = [
      { label: 'A / m1', reason: 'unavailable' },
      { label: 'A / m2', reason: 'unavailable' },
    ];
    const en = getVisionFallbackErrorMessage('english', failures, false);
    assert.ok(en.includes('unavailable'));
    const ar = getVisionFallbackErrorMessage('arabic', failures, false);
    assert.ok(ar.includes('غير متوفرة'));
  });

  it('returns rate-limited message when all failures are rate-limited', () => {
    const failures = [
      { label: 'A / m1', reason: 'rate-limited' },
      { label: 'A / m2', reason: 'rate-limited' },
    ];
    const en = getVisionFallbackErrorMessage('english', failures, false);
    assert.ok(en.includes('rate-limited'));
  });

  it('returns mixed message when failures have mixed reasons', () => {
    const failures = [
      { label: 'A / m1', reason: 'rate-limited' },
      { label: 'A / m2', reason: 'unavailable' },
    ];
    const en = getVisionFallbackErrorMessage('english', failures, false);
    assert.ok(en.includes('All vision model attempts failed') || en.includes('failed'));
  });

  it('includes actual reason in debug mode', () => {
    const failures = [
      { label: 'A / m1', reason: 'unavailable', error: '404 model not found' },
    ];
    const en = getVisionFallbackErrorMessage('english', failures, true);
    assert.ok(en.includes('Actual reason'));
    assert.ok(en.includes('404 model not found'));
  });

  it('includes actual reason in Arabic debug mode', () => {
    const failures = [
      { label: 'A / m1', reason: 'invalid key', error: '401 Unauthorized' },
    ];
    const ar = getVisionFallbackErrorMessage('arabic', failures, true);
    assert.ok(ar.includes('401 Unauthorized'));
  });
});

describe('buildVisionMessages', () => {
  const textMsg = { role: 'user', content: 'what is in this image' };
  const assistantMsg = { role: 'assistant', content: 'let me look' };

  it('converts last user message to parts array with image_url', () => {
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

  it('preserves earlier messages as-is', () => {
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

  it('handles multiple image attachments', () => {
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

  it('wraps last user message in parts array even without image attachments', () => {
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
  it('returns true when image with dataUrl exists', () => {
    const atts = [{ kind: 'image' as const, name: 'x.jpg', ext: 'jpg', size: 10, dataUrl: 'data:image/jpeg;base64,x' }];
    assert.ok(hasImageAttachments(atts));
  });

  it('returns false for empty attachments', () => {
    assert.equal(hasImageAttachments([]), false);
    assert.equal(hasImageAttachments(undefined), false);
  });

  it('returns false for non-image attachments', () => {
    const atts = [{ kind: 'text' as const, name: 'notes.txt', ext: 'txt', size: 10, textContent: 'hello' }];
    assert.equal(hasImageAttachments(atts), false);
  });

  it('returns false when image has no dataUrl', () => {
    const atts = [{ kind: 'image' as const, name: 'x.jpg', ext: 'jpg', size: 10 }];
    assert.equal(hasImageAttachments(atts), false);
  });
});

describe('supportsVision', () => {
  it('returns true for Gemini vision models', () => {
    assert.ok(supportsVision('gemini', 'gemini-2.5-flash'));
  });

  it('returns true for OpenRouter vision models', () => {
    assert.ok(supportsVision('openrouter', 'google/gemini-2.5-flash:free'));
  });

  it('returns false for text-only models', () => {
    assert.equal(supportsVision('deepseek', 'deepseek-chat'), false);
    assert.equal(supportsVision('groq', 'llama3-70b-8192'), false);
  });
});
