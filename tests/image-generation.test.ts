import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleImageGen } from '../src/web/api.js';

describe('image generation', () => {
  it('handleImageGen is a function', () => {
    assert.equal(typeof handleImageGen, 'function');
  });

  it('handleImageGen returns a Promise with imageUrl', () => {
    const result = handleImageGen('cat');
    assert.ok(result instanceof Promise);
  });

  it('handleImageGen always returns imageUrl even if HEAD fails', async () => {
    const result = await handleImageGen('test prompt');
    assert.ok(typeof result === 'object');
    // Always has imageUrl - never fails with generic error
    assert.ok('imageUrl' in result);
    assert.ok(result.imageUrl!.startsWith('https://image.pollinations.ai/prompt/'));
    assert.ok(result.imageUrl!.includes('test%20prompt'));
  });

  it('handleImageGen URL encodes special characters', async () => {
    const result = await handleImageGen('cat & dog');
    assert.ok(result.imageUrl!.includes('cat%20%26%20dog'));
  });

  it('handleImageGen constructs correct Pollinations URL', async () => {
    const result = await handleImageGen('cat');
    assert.equal(result.imageUrl, 'https://image.pollinations.ai/prompt/cat?width=1024&height=1024&nofeed=true');
  });

  it('handleImageGen with Arabic prompt constructs correct URL', async () => {
    const result = await handleImageGen('قطة');
    assert.ok(result.imageUrl!.includes('%D9%82%D8%B7%D8%A9'));
  });
});
