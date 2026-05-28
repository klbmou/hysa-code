import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CLOUD_FREE_PROVIDERS, providerHasOptionalApiKey, PROVIDER_TIERS, PROVIDER_CATEGORIES } from '../src/config/keys.js';
import { getProviderPreferenceForTask } from '../src/ai/provider-policy.js';
import type { HysaConfig } from '../src/config/keys.js';

describe('ninerouter integration', () => {
  it('ninerouter is in cloudFree providers', () => {
    assert.ok(CLOUD_FREE_PROVIDERS.includes('ninerouter'), 'ninerouter should be in CLOUD_FREE_PROVIDERS');
  });

  it('ninerouter has optional API key', () => {
    assert.equal(providerHasOptionalApiKey('ninerouter'), true);
  });

  it('ninerouter is free_api tier', () => {
    assert.equal(PROVIDER_TIERS.ninerouter, 'free_api');
  });

  it('ninerouter is cloud_free category', () => {
    assert.equal(PROVIDER_CATEGORIES.ninerouter, 'cloud_free');
  });

  it('ninerouter falls back after openrouter', () => {
    const order = getProviderPreferenceForTask('code_edit', { currentProvider: 'deepseek' } as HysaConfig);
    const openrouterIdx = order.indexOf('openrouter');
    const ninerouterIdx = order.indexOf('ninerouter');
    assert.ok(openrouterIdx >= 0, 'openrouter should be in preference list');
    assert.ok(ninerouterIdx >= 0, 'ninerouter should be in preference list');
    assert.ok(ninerouterIdx > openrouterIdx, 'ninerouter should appear after openrouter');
  });
});
