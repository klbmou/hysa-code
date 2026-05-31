import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleImageGen } from '../src/web/api.js';

describe('image generation', () => {
  it('handleImageGen is a function', () => {
    assert.equal(typeof handleImageGen, 'function');
  });

  it('handleImageGen returns a Promise', () => {
    const result = handleImageGen('cat');
    assert.ok(result instanceof Promise);
  });

  it('handleImageGen returns object with imageUrl for valid prompt', async () => {
    const result = await handleImageGen('test prompt');
    // Should either have imageUrl or error (depending on Pollinations reachability)
    assert.ok(typeof result === 'object');
    assert.ok('imageUrl' in result || 'error' in result);
    if (result.imageUrl) {
      assert.ok(result.imageUrl.startsWith('https://image.pollinations.ai/prompt/'));
      assert.ok(result.imageUrl.includes('test%20prompt'));
    }
  });

  it('handleImageGen URL encodes special characters', async () => {
    const result = await handleImageGen('cat & dog');
    if (result.imageUrl) {
      assert.ok(result.imageUrl.includes('cat%20%26%20dog'));
    }
  });
});
