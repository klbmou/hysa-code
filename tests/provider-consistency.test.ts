import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { hasVisionCapability } from '../src/ai/provider-capabilities.js';
import { sanitizeMessagesForTextModel } from '../src/web/api.js';

describe('provider consistency', () => {
  it('provider/model mismatch is detected', () => {
    function isValid(provider: string, model: string, taskKind?: string): boolean {
      if (taskKind === 'image_vision' && !hasVisionCapability(provider, model)) {
        return false;
      }
      return true;
    }
    assert.equal(isValid('deepseek', 'deepseek-chat', 'image_vision'), false);
    assert.equal(isValid('groq', 'llama3-70b-8192', 'image_vision'), false);
  });

  it('provider/model pair is valid for text tasks', () => {
    function isValid(provider: string, model: string, taskKind?: string): boolean {
      if (taskKind === 'image_vision' && !hasVisionCapability(provider, model)) {
        return false;
      }
      return true;
    }
    assert.equal(isValid('deepseek', 'deepseek-chat', 'code_edit'), true);
    assert.equal(isValid('groq', 'llama3-70b-8192', 'simple_chat'), true);
    assert.equal(isValid('gemini', 'gemini-2.5-flash', 'image_vision'), true);
    assert.equal(isValid('openrouter', 'google/gemini-2.5-flash:free', 'image_vision'), true);
  });

  it('sanitizeMessagesForTextModel strips all image parts', () => {
    const messages: any[] = [
      { role: 'user', content: [
        { type: 'text', text: 'hello' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,a' } },
        { type: 'text', text: 'world' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,b' } },
      ]},
    ];
    const stripped = sanitizeMessagesForTextModel(messages, 'deepseek', 'deepseek-chat');
    assert.equal(stripped, 2, 'should strip all 2 image_url parts');
    const content = messages[0].content as string;
    assert.ok(content.includes('hello'));
    assert.ok(content.includes('world'));
    assert.ok(content.includes('[Image attached]'));
    const matches = content.match(/\[Image attached\]/g);
    assert.equal(matches?.length, 2);
  });

  it('sanitizeMessagesForTextModel handles nested arrays', () => {
    const messages: any[] = [
      {
        role: 'user',
        content: [
          [{ type: 'text', text: 'outer array' }],
          { type: 'image_url', image_url: { url: 'data:image/png;base64,nested' } },
          { type: 'text', text: 'after image' },
        ],
      },
    ];
    const stripped = sanitizeMessagesForTextModel(messages, 'deepseek', 'deepseek-chat');
    assert.equal(stripped, 1, 'should strip the image_url part');
    const content = messages[0].content as string;
    assert.ok(content.includes('[Image attached]'));
    assert.ok(content.includes('after image'));
  });
});
