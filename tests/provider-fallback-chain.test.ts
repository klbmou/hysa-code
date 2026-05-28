import { afterEach, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { createSingleClient } from '../src/ai/client-factory.js';
import { createSmartRouter } from '../src/ai/smart-router.js';
import { getCandidatesForTask } from '../src/ai/model-registry.js';
import { getFallbackEvents, markModelCooldown, markProviderCooldown, resetHealth } from '../src/ai/model-health.js';
import { clearNinerouterDiscoveryCache, hydrateNinerouterConfig } from '../src/ai/ninerouter.js';
import { getProviderPreferenceForTask, providerModelHasActiveCredentials } from '../src/ai/provider-policy.js';
import type { HysaConfig } from '../src/config/keys.js';

function mockConfig(overrides: Partial<HysaConfig> = {}): HysaConfig {
  return {
    currentProvider: 'opencode_zen',
    currentModel: 'big-pickle',
    apiKeys: {
      opencode_zen: 'sk-zen',
      openrouter: 'sk-or-v1-test',
      groq: 'gsk-test',
      deepseek: 'sk-deepseek',
      gemini: 'gemini-test',
    },
    ollamaBaseUrl: 'http://localhost:11434',
    debug: false,
    lightMode: false,
    promptMode: 'auto',
    agentMode: 'chat',
    ...overrides,
  } as HysaConfig;
}

function healthChecker() {
  return {
    isOnCooldown: (provider: string, model: string) => {
      return provider === 'opencode_zen' && model === 'big-pickle';
    },
    isUnhealthy: () => false,
    isProviderOnCooldown: (provider: string) => provider === 'opencode_zen',
  };
}

const openChecker = {
  isOnCooldown: () => false,
  isUnhealthy: () => false,
  isProviderOnCooldown: () => false,
};

interface MockNinerouterOptions {
  models?: string[];
  visionModels?: string[];
  responses?: Record<string, { status: number; body: unknown }>;
}

async function startMockNinerouter(port = 0, options: MockNinerouterOptions = {}): Promise<{ server: Server; rootUrl: string; apiBaseUrl: string; chatModels: string[] }> {
  const chatModels: string[] = [];
  const models = options.models ?? [
    'oc/deepseek-v4-flash-free',
    'gemini/gemini-3.1-flash-lite-preview',
  ];
  const visionModels = options.visionModels ?? ['gemini/gemini-3.1-flash-lite-preview'];
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const path = new URL(req.url || '/', 'http://localhost').pathname;
    if (req.method === 'GET' && path === '/api/health') {
      return writeJson(res, 200, { ok: true });
    }
    if (req.method === 'GET' && path === '/v1/models') {
      return writeJson(res, 200, {
        data: models.map(id => ({ id })),
      });
    }
    if (req.method === 'GET' && path === '/v1/models/image-to-text') {
      return writeJson(res, 200, {
        data: visionModels.map(id => ({ id })),
      });
    }
    if (req.method === 'POST' && path === '/v1/chat/completions') {
      const body = await readBody(req);
      const parsed = JSON.parse(body || '{}') as { model?: string };
      if (parsed.model) chatModels.push(parsed.model);
      const configured = parsed.model ? options.responses?.[parsed.model] : undefined;
      if (configured) return writeJson(res, configured.status, configured.body);
      return writeJson(res, 200, {
        choices: [{ message: { content: 'ninerouter ok' } }],
      });
    }
    return writeJson(res, 404, { error: 'not found' });
  });
  await listen(server, port);
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  return {
    server,
    rootUrl: `http://127.0.0.1:${actualPort}`,
    apiBaseUrl: `http://127.0.0.1:${actualPort}/v1`,
    chatModels,
  };
}

async function startRateLimitedRouter(): Promise<{ server: Server; apiBaseUrl: string }> {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const path = new URL(req.url || '/', 'http://localhost').pathname;
    if (req.method === 'GET' && path === '/v1/models') {
      return writeJson(res, 200, { data: [{ id: 'oc/deepseek-v4-flash-free' }] });
    }
    if (req.method === 'POST' && path === '/v1/chat/completions') {
      return writeJson(res, 429, { error: { message: '429 FreeUsageLimitError' } });
    }
    return writeJson(res, 404, { error: 'not found' });
  });
  await listen(server, 0);
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : 0;
  return { server, apiBaseUrl: `http://127.0.0.1:${actualPort}/v1` };
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise(resolve => server.close(() => resolve()));
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

describe('provider fallback chain', () => {
  afterEach(() => {
    delete process.env.HYSA_ENABLE_LOCAL_FALLBACK;
    delete process.env.NINEROUTER_URL;
    delete process.env.HYSA_9ROUTER_CHAT_MODEL;
    delete process.env.HYSA_MODEL_MAX_ATTEMPTS;
    delete process.env.HYSA_9ROUTER_MAX_MODEL_ATTEMPTS;
    clearNinerouterDiscoveryCache();
    resetHealth();
  });

  it('excludes a provider and model immediately after a 429 cooldown', () => {
    const config = mockConfig();

    markModelCooldown('opencode_zen', 'big-pickle', '429 FreeUsageLimitError', 120, 'rate_limit');
    markProviderCooldown('opencode_zen', '429 FreeUsageLimitError', 120, 'rate_limit');

    const candidates = getCandidatesForTask('coding_qa', config, healthChecker());

    assert.ok(candidates.length > 0, 'fallback candidates should remain available');
    assert.equal(candidates.some(c => c.provider === 'opencode_zen'), false);
    assert.equal(candidates.some(c => c.provider === 'openrouter'), true);
  });

  it('skips 9Router auto when there are zero active OpenAI credentials', () => {
    const config = mockConfig({
      apiKeys: {},
      ninerouterBaseUrl: 'http://localhost:20128/v1',
    });

    const candidates = getCandidatesForTask('coding_qa', config, openChecker);

    assert.equal(candidates.some(c => c.provider === 'ninerouter' && c.model === 'auto'), false);
    assert.equal(candidates.some(c => c.provider === 'ninerouter' && c.model.startsWith('openai/')), false);
    assert.equal(candidates.some(c => c.provider === 'ninerouter' && c.model === 'oc/deepseek-v4-flash-free'), true);
  });

  it('orders fallback as direct free providers, then 9Router, then configured online providers, then local', () => {
    const config = mockConfig({
      currentProvider: 'opencode_zen',
      openaiRouterBaseUrl: 'http://localhost:20128/v1',
      ninerouterBaseUrl: 'http://localhost:20128/v1',
      apiKeys: {
        opencode_zen: 'sk-zen',
        openrouter: 'sk-or-v1-test',
        groq: 'gsk-test',
        deepseek: 'sk-deepseek',
        gemini: 'gemini-test',
        openai_router: 'router-key',
      },
    });

    process.env.HYSA_ENABLE_LOCAL_FALLBACK = 'true';
    const order = getProviderPreferenceForTask('code_edit', config);

    assert.equal(order[0], 'opencode_zen');
    assert.ok(order.indexOf('openrouter') > -1 && order.indexOf('openrouter') < order.indexOf('ninerouter'));
    assert.ok(order.indexOf('groq') > -1 && order.indexOf('groq') < order.indexOf('ninerouter'));
    assert.ok(order.indexOf('ninerouter') < order.indexOf('openai_router'));
    assert.ok(order.indexOf('openai_router') < order.indexOf('ollama'));
  });

  it('prevents invalid openai/auto routing without OpenAI credentials', () => {
    const config = mockConfig({
      currentProvider: 'ninerouter',
      currentModel: 'openai/auto',
      apiKeys: {},
      ninerouterBaseUrl: 'http://localhost:20128/v1',
      openaiRouterBaseUrl: 'http://localhost:20128/v1',
    });

    assert.equal(providerModelHasActiveCredentials('ninerouter', 'openai/auto', config), false);
    assert.equal(providerModelHasActiveCredentials('ninerouter', 'auto', config), false);
    assert.equal(providerModelHasActiveCredentials('openai_router', 'openai/gpt-4o-mini', config), false);

    assert.throws(
      () => createSingleClient('ninerouter', 'auto', config.apiKeys, config.ollamaBaseUrl, undefined, undefined, config),
      /no active credentials/i,
    );
    assert.throws(
      () => createSingleClient('openai_router', 'openai/auto', config.apiKeys, config.ollamaBaseUrl, undefined, undefined, config),
      /no active credentials/i,
    );

    const candidates = getCandidatesForTask('coding_qa', config, openChecker);
    assert.equal(candidates.some(c => c.provider === 'ninerouter' && (c.model === 'auto' || c.model.startsWith('openai/'))), false);
  });

  it('discovers 9Router from localhost without a manual provider setting', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'http://localhost:20128/api/health') {
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url === 'http://localhost:20128/v1/models') {
        return new Response(JSON.stringify({ data: [{ id: 'oc/deepseek-v4-flash-free' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return originalFetch(input, init);
    }) as typeof fetch;
    try {
      const config = mockConfig({
        currentProvider: 'openai_router',
        currentModel: 'oc/deepseek-v4-flash-free',
        apiKeys: {},
        openaiRouterBaseUrl: 'http://127.0.0.1:1/v1',
        ninerouterBaseUrl: undefined,
      });

      const discovery = await hydrateNinerouterConfig(config, { force: true });

      assert.equal(discovery?.available, true);
      assert.equal(config.currentProvider, 'openai_router', 'HYSA_PROVIDER=ninerouter should not be required');
      assert.equal(config.ninerouterBaseUrl, 'http://localhost:20128/v1');
      assert.equal(config.ninerouterModel, 'oc/deepseek-v4-flash-free');
      assert.ok(config.ninerouterModels?.includes('oc/deepseek-v4-flash-free'));
      assert.equal(process.env.HYSA_PROVIDER, undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('openai_router rate limit triggers automatic 9Router fallback using HYSA_9ROUTER_CHAT_MODEL', async () => {
    const routerServer = await startRateLimitedRouter();
    const nr = await startMockNinerouter();
    process.env.NINEROUTER_URL = nr.rootUrl;
    process.env.HYSA_9ROUTER_CHAT_MODEL = 'oc/deepseek-v4-flash-free';
    process.env.HYSA_MODEL_MAX_ATTEMPTS = '8';

    try {
      const config = mockConfig({
        currentProvider: 'openai_router',
        currentModel: 'oc/deepseek-v4-flash-free',
        apiKeys: {},
        openaiRouterBaseUrl: routerServer.apiBaseUrl,
        ninerouterBaseUrl: undefined,
        debug: true,
      });
      const router = createSmartRouter(config);

      const result = await router.sendMessage([{ role: 'user', content: 'hello' }], 'system');

      assert.equal(result.message, 'ninerouter ok');
      assert.equal(result.provider, '9Router');
      assert.equal(result.model, 'oc/deepseek-v4-flash-free');
      assert.deepEqual(nr.chatModels, ['oc/deepseek-v4-flash-free']);
      assert.equal(config.currentProvider, 'openai_router', 'manual HYSA_PROVIDER=ninerouter should not be required');
      assert.ok(getFallbackEvents().some(e => e.reason === 'Fallback: 9Router / oc/deepseek-v4-flash-free'));
    } finally {
      await close(routerServer.server);
      await close(nr.server);
    }
  });

  it('9Router DeepSeek rate limit triggers Gemini model fallback from discovered models without a manual env var', async () => {
    const routerServer = await startRateLimitedRouter();
    const nr = await startMockNinerouter(0, {
      models: [
        'oc/deepseek-v4-flash-free',
        'gemini/gemini-3.1-flash-lite-preview',
        'nvidia/z-ai/glm4.7',
      ],
      responses: {
        'oc/deepseek-v4-flash-free': {
          status: 429,
          body: { error: { type: 'FreeUsageLimitError', message: 'free usage limit reached', provider: 'opencode' } },
        },
      },
    });
    process.env.NINEROUTER_URL = nr.rootUrl;
    delete process.env.HYSA_9ROUTER_CHAT_MODEL;
    process.env.HYSA_9ROUTER_MAX_MODEL_ATTEMPTS = '8';

    try {
      const config = mockConfig({
        currentProvider: 'openai_router',
        currentModel: 'oc/deepseek-v4-flash-free',
        apiKeys: {},
        openaiRouterBaseUrl: routerServer.apiBaseUrl,
        ninerouterBaseUrl: undefined,
        debug: true,
      });
      const router = createSmartRouter(config);

      const result = await router.sendMessage([{ role: 'user', content: 'hello' }], 'system');

      assert.equal(result.provider, '9Router');
      assert.equal(result.model, 'gemini/gemini-3.1-flash-lite-preview');
      assert.deepEqual(nr.chatModels, [
        'oc/deepseek-v4-flash-free',
        'gemini/gemini-3.1-flash-lite-preview',
      ]);
      assert.ok(config.ninerouterModels?.includes('gemini/gemini-3.1-flash-lite-preview'), 'discovered /v1/models should populate fallback models');
      assert.equal(process.env.HYSA_PROVIDER, undefined, 'manual HYSA_PROVIDER=ninerouter should not be required');
      assert.ok(getFallbackEvents().some(e => e.reason.includes('selected 9Router fallback model: gemini/gemini-3.1-flash-lite-preview')));
    } finally {
      await close(routerServer.server);
      await close(nr.server);
    }
  });

  it('skips a cooling 9Router model and tries the recommended next discovered model', async () => {
    const routerServer = await startRateLimitedRouter();
    const nr = await startMockNinerouter(0, {
      models: [
        'oc/deepseek-v4-flash-free',
        'gemini/gemini-3-flash-preview',
        'nvidia/z-ai/glm4.7',
      ],
    });
    process.env.NINEROUTER_URL = nr.rootUrl;
    process.env.HYSA_9ROUTER_MAX_MODEL_ATTEMPTS = '8';
    markModelCooldown('ninerouter', 'oc/deepseek-v4-flash-free', '429 FreeUsageLimitError', 120, 'rate_limit');

    try {
      const config = mockConfig({
        currentProvider: 'openai_router',
        currentModel: 'oc/deepseek-v4-flash-free',
        apiKeys: {},
        openaiRouterBaseUrl: routerServer.apiBaseUrl,
        ninerouterBaseUrl: undefined,
        debug: true,
      });
      const router = createSmartRouter(config);

      const result = await router.sendMessage([{ role: 'user', content: 'hello' }], 'system');

      assert.equal(result.provider, '9Router');
      assert.equal(result.model, 'gemini/gemini-3-flash-preview');
      assert.deepEqual(nr.chatModels, ['gemini/gemini-3-flash-preview']);
    } finally {
      await close(routerServer.server);
      await close(nr.server);
    }
  });

  it('reports unavailable only after all discovered 9Router chat models fail', async () => {
    const routerServer = await startRateLimitedRouter();
    const models = [
      'oc/deepseek-v4-flash-free',
      'gemini/gemini-2.0-flash-lite',
      'nvidia/z-ai/glm4.7',
    ];
    const nr = await startMockNinerouter(0, {
      models,
      responses: Object.fromEntries(models.map(model => [
        model,
        { status: 429, body: { error: { type: 'FreeUsageLimitError', message: `${model} limited` } } },
      ])),
    });
    process.env.NINEROUTER_URL = nr.rootUrl;
    process.env.HYSA_9ROUTER_MAX_MODEL_ATTEMPTS = '8';

    try {
      const config = mockConfig({
        currentProvider: 'openai_router',
        currentModel: 'oc/deepseek-v4-flash-free',
        apiKeys: {},
        openaiRouterBaseUrl: routerServer.apiBaseUrl,
        ninerouterBaseUrl: undefined,
        debug: true,
      });
      const router = createSmartRouter(config);

      await assert.rejects(
        () => router.sendMessage([{ role: 'user', content: 'hello' }], 'system'),
        /All currently configured providers are temporarily unavailable or rate-limited/,
      );
      assert.deepEqual(nr.chatModels, models);
    } finally {
      await close(routerServer.server);
      await close(nr.server);
    }
  });

  it('local fallback remains disabled unless explicitly enabled', () => {
    delete process.env.HYSA_ENABLE_LOCAL_FALLBACK;
    const config = mockConfig({
      currentProvider: 'openai_router',
      currentModel: 'oc/deepseek-v4-flash-free',
      apiKeys: {},
      openaiRouterBaseUrl: 'http://127.0.0.1:1/v1',
      ninerouterBaseUrl: 'http://localhost:20128/v1',
    });

    const order = getProviderPreferenceForTask('code_edit', config);

    assert.equal(order.includes('ollama'), false);
    assert.equal(order.includes('local_openai'), false);
    assert.equal(order.includes('hysa_ai'), false);
  });
});
