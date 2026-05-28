import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { hasVisionCapability, getVisionCapableProviders } from '../src/ai/provider-capabilities.js';
import { sanitizeMessagesForTextModel, hasImageAttachments, buildVisionMessages, supportsVision } from '../src/web/api.js';
import { CLOUD_FREE_PROVIDERS } from '../src/config/keys.js';
import { getCandidatesForTask } from '../src/ai/model-registry.js';

describe('vision routing integration', () => {
  // ── Vision capability changes ──

  it('openai_router/openai/gpt-4o-mini no longer marked vision-capable', () => {
    // Removed because router backend may not support vision
    assert.equal(hasVisionCapability('openai_router', 'openai/gpt-4o-mini'), false);
  });

  it('gemini models remain vision-capable', () => {
    assert.ok(hasVisionCapability('gemini', 'gemini-2.5-flash'));
    assert.ok(hasVisionCapability('gemini', 'gemini-1.5-flash'));
  });

  it('9Router is vision-capable', () => {
    assert.ok(hasVisionCapability('ninerouter', 'auto'));
  });

  it('openrouter vision models remain vision-capable', () => {
    assert.ok(hasVisionCapability('openrouter', 'google/gemini-2.5-flash:free'));
    assert.ok(hasVisionCapability('openrouter', 'qwen/qwen2.5-vl-72b-instruct:free'));
  });

  it('deepseek is NOT vision-capable', () => {
    assert.equal(hasVisionCapability('deepseek', 'deepseek-chat'), false);
    assert.equal(hasVisionCapability('deepseek', 'deepseek-coder'), false);
  });

  it('no text-only models in vision-capable providers list', () => {
    const visionProviders = getVisionCapableProviders();
    for (const vp of visionProviders) {
      assert.ok(hasVisionCapability(vp.provider, vp.model),
        `${vp.provider}/${vp.model} should be vision-capable`);
    }
  });

  // ── Sanitization ──

  it('sanitizeMessagesForTextModel strips ALL image_url parts from text-only DeepSeek', () => {
    const messages: any[] = [
      { role: 'user', content: 'hello' },
      { role: 'user', content: [
        { type: 'text', text: 'describe this' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,a' } },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,b' } },
      ]},
    ];
    const stripped = sanitizeMessagesForTextModel(messages, 'deepseek', 'deepseek-chat');
    assert.equal(stripped, 2, 'should strip both image parts');
    assert.equal(typeof messages[1].content, 'string', 'content should be string after sanitization');
    assert.ok(!(messages[1].content as string).includes('image_url'), 'no image_url text should remain');
  });

  it('sanitizeMessagesForTextModel preserves messages for vision-capable Gemini', () => {
    const messages: any[] = [
      { role: 'user', content: [
        { type: 'text', text: 'what is this' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/4AAQ' } },
      ]},
    ];
    const before = JSON.stringify(messages);
    const stripped = sanitizeMessagesForTextModel(messages, 'gemini', 'gemini-2.5-flash');
    assert.equal(stripped, 0, 'should not strip for vision model');
    assert.equal(JSON.stringify(messages), before, 'messages should be unmodified');
  });

  it('supportsVision returns correct results', () => {
    assert.ok(supportsVision('gemini', 'gemini-2.5-flash'));
    assert.ok(supportsVision('openrouter', 'google/gemini-2.5-flash:free'));
    assert.equal(supportsVision('deepseek', 'deepseek-chat'), false);
    assert.equal(supportsVision('groq', 'llama3-70b-8192'), false);
  });

  // ── Provider/model mismatch detection ──

  it('text-only model receiving image payload triggers mismatch', () => {
    function validate(provider: string, model: string, messages: any[]): boolean {
      if (!hasVisionCapability(provider, model)) {
        for (const msg of messages) {
          if (Array.isArray(msg.content) && msg.content.some((p: any) => p.type === 'image_url')) {
            return false;
          }
        }
      }
      return true;
    }
    const msgs = [{ role: 'user', content: [{ type: 'text', text: 'hi' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,x' } }] }];
    assert.equal(validate('deepseek', 'deepseek-chat', msgs), false, 'DeepSeek should reject image payload');
    assert.equal(validate('gemini', 'gemini-2.5-flash', msgs), true, 'Gemini should accept image payload');
  });

  it('vision fallback never uses text-only providers', () => {
    const config = {
      currentProvider: 'deepseek',
      currentModel: 'deepseek-chat',
      apiKeys: { gemini: 'test-key', openrouter: 'sk-test' },
    };
    const healthChecker = { isOnCooldown: () => false, isUnhealthy: () => false, isProviderOnCooldown: () => false };
    const candidates = getCandidatesForTask('image_vision', config, healthChecker);
    for (const c of candidates) {
      assert.ok(hasVisionCapability(c.provider, c.model), `${c.label} must be vision-capable`);
      assert.notEqual(c.provider, 'deepseek', 'DeepSeek should never appear for vision');
      if (c.provider === 'openai_router') {
        assert.equal(c.model, 'qw/qwen3-coder-flash', 'Only non-gpt-4o-mini openai_router models should appear');
      }
    }
  });

  it('ninerouter is in cloud_free providers', () => {
    assert.ok(CLOUD_FREE_PROVIDERS.includes('ninerouter'));
  });

  // ── Build vision messages ──

  it('buildVisionMessages creates proper multi-part content', () => {
    const msgs = [{ role: 'user', content: 'analyze this image' }];
    const attachments = [
      { name: 'test.jpg', ext: 'jpg', size: 1000, kind: 'image' as const, dataUrl: 'data:image/jpeg;base64,/9j/4AAQ' },
    ];
    const result = buildVisionMessages(msgs, attachments);
    assert.equal(result.length, 1);
    const content = result[0].content;
    assert.ok(Array.isArray(content));
    assert.equal(content[0].type, 'text');
    assert.equal(content[0].text, 'analyze this image');
    assert.equal(content[1].type, 'image_url');
    assert.equal(content[1].image_url.url, 'data:image/jpeg;base64,/9j/4AAQ');
  });

  it('hasImageAttachments detects image attachments', () => {
    assert.ok(hasImageAttachments([
      { kind: 'image', name: 'x.jpg', ext: 'jpg', size: 100, dataUrl: 'data:image/jpeg;base64,x' },
    ]));
    assert.equal(hasImageAttachments([]), false);
    assert.equal(hasImageAttachments(undefined), false);
  });
});
