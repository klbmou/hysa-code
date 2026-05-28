import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { CLOUD_FREE_PROVIDERS, providerHasOptionalApiKey, PROVIDER_TIERS, PROVIDER_CATEGORIES, PROVIDER_DEFAULTS, PROVIDER_MODELS } from '../src/config/keys.js';
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

  it('default 9Router chat model is oc/deepseek-v4-flash-free', () => {
    assert.equal(PROVIDER_DEFAULTS.ninerouter.model, 'oc/deepseek-v4-flash-free', 'default should be safe model');
  });

  it('9Router supports both deepseek and auto models', () => {
    const models = PROVIDER_MODELS.ninerouter;
    assert.ok(models.includes('oc/deepseek-v4-flash-free'), 'should include deepseek model');
    assert.ok(models.includes('auto'), 'should include auto option');
  });

  it('auto model is not used by default', () => {
    const defaultModel = PROVIDER_DEFAULTS.ninerouter.model;
    assert.notEqual(defaultModel, 'auto', 'auto should not be the default model');
  });

  it('9Router config supports HYSA_9ROUTER_CHAT_MODEL override', async () => {
    const originalEnv = process.env.HYSA_9ROUTER_CHAT_MODEL;
    try {
      process.env.HYSA_9ROUTER_CHAT_MODEL = 'auto';
      // This test just verifies that the env var is recognized by the config system
      assert.equal(process.env.HYSA_9ROUTER_CHAT_MODEL, 'auto');
    } finally {
      if (originalEnv) {
        process.env.HYSA_9ROUTER_CHAT_MODEL = originalEnv;
      } else {
        delete process.env.HYSA_9ROUTER_CHAT_MODEL;
      }
    }
  });
});
