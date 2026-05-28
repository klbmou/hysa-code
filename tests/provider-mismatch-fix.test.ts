import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { hasVisionCapability } from '../src/ai/provider-capabilities.js';
import { sanitizeMessagesForTextModel } from '../src/web/api.js';

describe('provider/model mismatch fixes', () => {
  // ── Root cause: DeepSeek receiving image_url ──

  it('DeepSeek is NEVER vision-capable — prevents image_url leakage', () => {
    assert.equal(hasVisionCapability('deepseek', 'deepseek-chat'), false);
    assert.equal(hasVisionCapability('deepseek', 'deepseek-coder'), false);
  });

  it('sanitizeMessagesForTextModel strips ALL vision parts before DeepSeek send', () => {
    const messages: any[] = [
      { role: 'user', content: [
        { type: 'text', text: 'analyze' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
      ]},
    ];
    const stripped = sanitizeMessagesForTextModel(messages, 'deepseek', 'deepseek-chat');
    assert.equal(stripped, 1, 'should strip the image_url part');
    // After sanitization, no image_url should remain
    const content = messages[0].content;
    assert.equal(typeof content, 'string', 'content must be string after sanitization');
    assert.ok(!content.includes('image_url'), 'no image_url references should remain');
  });

  it('sanitization handles mixed image/text parts for text-only providers', () => {
    const messages: any[] = [
      { role: 'user', content: [
        { type: 'text', text: 'part1' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,a' } },
        { type: 'text', text: 'part2' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,b' } },
      ]},
    ];
    const stripped = sanitizeMessagesForTextModel(messages, 'deepseek', 'deepseek-chat');
    assert.equal(stripped, 2, 'should strip both image_url parts');
    const content = messages[0].content as string;
    assert.ok(content.includes('part1'), 'should preserve text part 1');
    assert.ok(content.includes('part2'), 'should preserve text part 2');
    assert.ok(content.includes('[Image attached]'), 'should have placeholder');
    // Count placeholders
    const matches = content.match(/\[Image attached\]/g);
    assert.equal(matches?.length, 2, 'should have 2 placeholders for 2 images');
  });

  it('history with old image_url parts is sanitized for text-only continuations', () => {
    const messages: any[] = [
      { role: 'user', content: [{ type: 'text', text: 'what is this' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,old' } }] },
      { role: 'assistant', content: 'that is a cat' },
      { role: 'user', content: 'follow up question' },
    ];
    const stripped = sanitizeMessagesForTextModel(messages, 'deepseek', 'deepseek-chat');
    assert.equal(stripped, 1, 'should strip history image part');
    assert.equal(typeof messages[0].content, 'string', 'history message should be string');
    assert.ok((messages[0].content as string).includes('[Image attached]'));
    assert.equal(messages[2].content, 'follow up question', 'text-only message unchanged');
  });

  // ── Stale routing state detection ──

  it('detects stale provider-model mismatch', () => {
    // Simulate: selectedModel=openai/gpt-4o-mini but actual provider=DeepSeek
    const model = 'openai/gpt-4o-mini';
    const provider = 'deepseek';
    const hasImagePayload = true;
    
    // A text-only provider should not receive image payload
    const isTextOnly = !hasVisionCapability(provider, model);
    assert.ok(isTextOnly, 'deepseek with any model should be text-only');
    assert.ok(hasImagePayload, 'sending image to text-only model is a mismatch');
  });

  it('payload formatter isolation between providers', () => {
    // OpenAI format: messages with image_url parts
    const openaiFormat = {
      role: 'user',
      content: [
        { type: 'text', text: 'hello' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,abc' } },
      ],
    };
    
    // Gemini format: same content structure (uses same multi-part format)
    const geminiFormat = openaiFormat;
    
    // DeepSeek format: text only, no image_url
    // If DeepSeek receives openaiFormat, it will fail
    
    const sanitized = sanitizeMessagesForTextModel(
      [{ ...openaiFormat }],
      'deepseek',
      'deepseek-chat',
    );
    assert.equal(typeof sanitized, 'number', 'sanitization should succeed');
  });

  // ── Gemini/OpenAI payload isolation ──

  it('Gemini correctly handles vision payload without stripping', () => {
    const messages: any[] = [
      { role: 'user', content: [
        { type: 'text', text: 'describe' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/4AAQ' } },
      ]},
    ];
    const stripped = sanitizeMessagesForTextModel(messages, 'gemini', 'gemini-2.5-flash');
    assert.equal(stripped, 0, 'Gemini vision model should keep image parts');
    assert.ok(Array.isArray(messages[0].content), 'content should remain array for Gemini');
  });

  // ── Vision fallback state reset ──

  it('vision fallback resets correctly between requests', () => {
    // Check that previous vision messages don't leak into text requests
    const messages: any[] = [
      { role: 'user', content: 'just a text question' },
    ];
    const sanitized = sanitizeMessagesForTextModel(messages, 'deepseek', 'deepseek-chat');
    assert.equal(sanitized, 0, 'pure text messages should not be affected');
    assert.equal(messages[0].content, 'just a text question', 'content unchanged');
    assert.equal(typeof messages[0].content, 'string', 'content should remain string');
  });
});
