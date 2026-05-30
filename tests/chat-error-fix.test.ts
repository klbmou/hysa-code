import { afterEach, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { categorizeError } from '../src/ai/client.js';
import {
  clearNinerouterDiscoveryCache,
  discoverNinerouter,
  getNinerouterCandidateRoots,
  probe9RouterModel,
  classifyNinerouterFailure,
  extractNinerouterErrorDetails,
  normalizeNinerouterRootUrl,
  DEFAULT_NINEROUTER_ROOT_URL,
} from '../src/ai/ninerouter.js';
import { isNetworkError } from '../src/ai/provider-policy.js';
import type { HysaConfig } from '../src/config/keys.js';

// ── Mock helpers ─────────────────────────────────

function mockConfig(baseUrl?: string): HysaConfig {
  const c: HysaConfig = {
    currentProvider: 'ninerouter',
    currentModel: 'oc/deepseek-v4-flash-free',
    apiKeys: {},
    ollamaBaseUrl: 'http://localhost:11434',
    debug: false,
    lightMode: false,
    promptMode: 'auto',
    agentMode: 'chat',
  } as HysaConfig;
  if (baseUrl) {
    c.ninerouterBaseUrl = baseUrl;
    c.ninerouterRootUrl = normalizeNinerouterRootUrl(baseUrl);
  }
  return c;
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, () => {
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

// ── Server that has /v1/models but no /api/health ──

async function startRouterServer(
  models: string[],
  options: {
    healthStatus?: number;
    healthBody?: unknown;
    chatStatus?: number;
    chatBody?: unknown;
  } = {},
): Promise<{ server: Server; rootUrl: string }> {
  const {
    healthStatus = 404,
    healthBody = { error: 'not found' },
    chatStatus = 200,
    chatBody = { choices: [{ message: { content: 'ok' } }] },
  } = options;

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const path = new URL(req.url || '/', 'http://localhost').pathname;

    if (path === '/api/health') {
      return writeJson(res, healthStatus, healthBody);
    }

    if (req.method === 'GET' && path === '/v1/models') {
      return writeJson(res, 200, { data: models.map(id => ({ id })) });
    }

    if (req.method === 'POST' && path === '/v1/chat/completions') {
      await readBody(req);
      return writeJson(res, chatStatus, chatBody);
    }

    return writeJson(res, 404, { error: { message: 'not found' } });
  });

  await listen(server);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { server, rootUrl: `http://127.0.0.1:${port}` };
}

// ── Tests ─────────────────────────────────────────

describe('categorizeError', () => {
  it('categorizes "Connection error" as network', () => {
    assert.equal(categorizeError('Connection error.'), 'network');
  });

  it('categorizes "Connection error." as network (OpenAI SDK format)', () => {
    assert.equal(categorizeError('Connection error.'), 'network');
  });

  it('categorizes "Connection refused" as network', () => {
    assert.equal(categorizeError('Connection refused: connect'), 'network');
  });

  it('categorizes "fetch failed" as network', () => {
    assert.equal(categorizeError('fetch failed: getaddrinfo ENOTFOUND'), 'network');
  });

  it('categorizes "network timeout" as timeout (timeout check runs before network)', () => {
    assert.equal(categorizeError('network timeout'), 'timeout');
  });

  it('categorizes "unknown" errors as unknown', () => {
    assert.equal(categorizeError('some random error'), 'unknown');
  });
});

describe('isNetworkError', () => {
  it('detects "Connection error" as network', () => {
    assert.equal(isNetworkError('Connection error'), true);
  });

  it('detects "Connection refused" as network', () => {
    assert.equal(isNetworkError('Connection refused'), true);
  });
});

describe('discoverNinerouter with optional health', () => {
  afterEach(() => {
    clearNinerouterDiscoveryCache();
  });

  it('discovers 9Router when /api/health returns 404 but /v1/models works', async () => {
    const { server, rootUrl } = await startRouterServer(
      ['oc/deepseek-v4-flash-free', 'qw/qwen3-coder-flash'],
      { healthStatus: 404, healthBody: { error: 'not found' } },
    );

    try {
      process.env.NINEROUTER_URL = rootUrl;
      const config = mockConfig();
      const result = await discoverNinerouter(config, { timeoutMs: 2000, force: true });
      assert.equal(result.available, true);
      assert.ok(result.models.includes('oc/deepseek-v4-flash-free'));
      assert.ok(result.models.includes('qw/qwen3-coder-flash'));
      assert.equal(result.models.length, 2);
    } finally {
      delete process.env.NINEROUTER_URL;
      await close(server);
    }
  });

  it('discovers 9Router when /api/health returns 200 and /v1/models works', async () => {
    const { server, rootUrl } = await startRouterServer(
      ['oc/deepseek-v4-flash-free'],
      { healthStatus: 200, healthBody: { ok: true } },
    );

    try {
      process.env.NINEROUTER_URL = rootUrl;
      const config = mockConfig();
      const result = await discoverNinerouter(config, { timeoutMs: 2000, force: true });
      assert.equal(result.available, true);
      assert.ok(result.models.includes('oc/deepseek-v4-flash-free'));
    } finally {
      delete process.env.NINEROUTER_URL;
      await close(server);
    }
  });

  it('fails discovery when /v1/models returns no models', async () => {
    const { server, rootUrl } = await startRouterServer(
      [],
      { healthStatus: 404 },
    );

    try {
      // Note: getNinerouterCandidateRoots always includes DEFAULT_NINEROUTER_ROOT_URL (localhost:20128).
      // If that server is not running, the discovery will ultimately fail due to that root.
      // We just verify that a server with empty models is not considered "available".
      const config = mockConfig(`${rootUrl}/v1`);
      const result = await discoverNinerouter(config, { timeoutMs: 2000, force: true });
      assert.equal(result.available, false);
    } finally {
      await close(server);
    }
  });
});

describe('probe9RouterModel error details', () => {
  afterEach(() => {
    clearNinerouterDiscoveryCache();
  });

  it('returns HTTP status and body on 400 error', async () => {
    const { server, rootUrl } = await startRouterServer(
      ['oc/deepseek-v4-flash-free'],
      {
        healthStatus: 200,
        healthBody: { ok: true },
        chatStatus: 400,
        chatBody: { error: { type: 'invalid_model', message: 'model not found: oc/deepseek-v4-flash-free' } },
      },
    );

    try {
      const config = mockConfig(`${rootUrl}/v1`);
      const result = await probe9RouterModel(config, 'oc/deepseek-v4-flash-free', { timeoutMs: 2000 });
      assert.equal(result.usable, false);
      assert.equal(result.httpStatus, 400);
      assert.equal(result.status, 'invalid_model');
      assert.ok(result.errorMessage?.includes('model not found'));
    } finally {
      await close(server);
    }
  });

  it('includes rawBody on probe error', async () => {
    const { server, rootUrl } = await startRouterServer(
      ['oc/deepseek-v4-flash-free'],
      {
        healthStatus: 200,
        healthBody: { ok: true },
        chatStatus: 429,
        chatBody: { error: { type: 'rate_limit', message: 'Free usage limit reached' }, upstream_provider: 'openai' },
      },
    );

    try {
      const config = mockConfig(`${rootUrl}/v1`);
      const result = await probe9RouterModel(config, 'oc/deepseek-v4-flash-free', { timeoutMs: 2000 });
      assert.equal(result.usable, false);
      assert.equal(result.httpStatus, 429);
      assert.equal(result.status, 'rate_limited');
      assert.ok(result.rawBody);
      assert.ok(result.rawBody!.includes('rate_limit'));
      assert.equal(result.upstreamProvider, 'openai');
    } finally {
      await close(server);
    }
  });

  it('returns usable on 200 response', async () => {
    const { server, rootUrl } = await startRouterServer(
      ['oc/deepseek-v4-flash-free'],
      {
        healthStatus: 200,
        healthBody: { ok: true },
        chatStatus: 200,
        chatBody: { choices: [{ message: { content: 'pong' } }] },
      },
    );

    try {
      const config = mockConfig(`${rootUrl}/v1`);
      const result = await probe9RouterModel(config, 'oc/deepseek-v4-flash-free', { timeoutMs: 2000 });
      assert.equal(result.usable, true);
      assert.equal(result.httpStatus, 200);
      assert.equal(result.status, 'usable');
    } finally {
      await close(server);
    }
  });
});

describe('classifyNinerouterFailure', () => {
  it('classifies "Connection error" as unavailable', () => {
    const result = classifyNinerouterFailure({
      errorMessage: 'Connection error.',
    });
    assert.equal(result, 'unavailable');
  });

  it('classifies FreeUsageLimitError as rate_limited', () => {
    const result = classifyNinerouterFailure({
      errorType: 'FreeUsageLimitError',
      errorMessage: 'free usage limit reached',
    });
    assert.equal(result, 'rate_limited');
  });

  it('classifies 429 as rate_limited', () => {
    const result = classifyNinerouterFailure({
      httpStatus: 429,
    });
    assert.equal(result, 'rate_limited');
  });

  it('classifies unknown error without details as unknown_error', () => {
    const result = classifyNinerouterFailure({});
    assert.equal(result, 'unknown_error');
  });

  it('classifies HTTP 500 as unavailable', () => {
    const result = classifyNinerouterFailure({
      httpStatus: 500,
      errorMessage: 'Internal server error',
    });
    assert.equal(result, 'unavailable');
  });
});

describe('extractNinerouterErrorDetails', () => {
  it('extracts HTTP status from error with response', () => {
    const err = {
      response: { status: 429 },
      message: 'Request failed with 429',
    };
    const details = extractNinerouterErrorDetails(err);
    assert.equal(details.httpStatus, 429);
  });

  it('extracts error message from raw body', () => {
    const err = {
      rawBody: JSON.stringify({ error: { type: 'rate_limit', message: 'rate limited' } }),
    };
    const details = extractNinerouterErrorDetails(err);
    assert.equal(details.errorType, 'rate_limit');
    assert.equal(details.errorMessage, 'rate limited');
  });

  it('extracts upstream provider', () => {
    const err = {
      rawBody: JSON.stringify({ error: { upstream_provider: 'openai', message: 'overloaded' } }),
    };
    const details = extractNinerouterErrorDetails(err);
    assert.equal(details.upstreamProvider, 'openai');
  });

  it('sets errorType to "network" for Connection error without HTTP response', () => {
    const err = new Error('Connection error.');
    const details = extractNinerouterErrorDetails(err);
    assert.equal(details.httpStatus, undefined);
    assert.equal(details.errorType, 'network');
    assert.equal(details.errorMessage, 'Connection error.');
  });

  it('sets errorType to "network" for fetch failed error', () => {
    const err = new Error('fetch failed: getaddrinfo ENOTFOUND localhost');
    const details = extractNinerouterErrorDetails(err);
    assert.equal(details.errorType, 'network');
  });
});

describe('getNinerouterCandidateRoots', () => {
  afterEach(() => {
    clearNinerouterDiscoveryCache();
  });

  it('includes both localhost and 127.0.0.1 for the default root', () => {
    const config = {
      currentProvider: 'ninerouter',
      currentModel: 'oc/deepseek-v4-flash-free',
      apiKeys: {},
    } as HysaConfig;
    const roots = getNinerouterCandidateRoots(config);
    assert.ok(roots.some(r => r.includes('localhost')), 'should contain localhost');
    assert.ok(roots.some(r => r.includes('127.0.0.1')), 'should contain 127.0.0.1');
  });

  it('includes openaiRouterBaseUrl when it is a local address', () => {
    const config = {
      currentProvider: 'openai_router',
      currentModel: 'oc/deepseek-v4-flash-free',
      openaiRouterBaseUrl: 'http://127.0.0.1:20128/v1',
      apiKeys: {},
    } as HysaConfig;
    const roots = getNinerouterCandidateRoots(config);
    assert.ok(roots.some(r => r.includes('127.0.0.1')), 'should include 127.0.0.1 from openaiRouterBaseUrl');
    // Should NOT include /v1 in the root
    assert.ok(roots.every(r => !r.endsWith('/v1')), 'no root should end with /v1');
  });

  it('does not include external openaiRouterBaseUrl (non-local)', () => {
    const config = {
      currentProvider: 'openai_router',
      currentModel: 'oc/deepseek-v4-flash-free',
      openaiRouterBaseUrl: 'https://openrouter.ai/api/v1',
      apiKeys: {},
    } as HysaConfig;
    const roots = getNinerouterCandidateRoots(config);
    // Should NOT include openrouter.ai
    assert.ok(roots.every(r => !r.includes('openrouter.ai')), 'should not include external URLs');
  });

  it('NINEROUTER_URL env var root never includes /v1', () => {
    process.env.NINEROUTER_URL = 'http://127.0.0.1:9999/v1';
    try {
      const config = {
        currentProvider: 'ninerouter',
        currentModel: 'oc/deepseek-v4-flash-free',
        apiKeys: {},
      } as HysaConfig;
      const roots = getNinerouterCandidateRoots(config);
      const fromEnv = roots.find(r => r.includes('127.0.0.1:9999'));
      assert.ok(fromEnv, 'should include the env var root');
      assert.ok(!fromEnv!.endsWith('/v1'), 'normalized root should not end with /v1');
    } finally {
      delete process.env.NINEROUTER_URL;
    }
  });
});

describe('diagnostics: models pass + chat fail', () => {
  afterEach(() => {
    clearNinerouterDiscoveryCache();
  });

  it('probe returns unavailable when models work but chat fails with network error', async () => {
    const { server, rootUrl } = await startRouterServer(
      ['oc/deepseek-v4-flash-free'],
      {
        healthStatus: 200,
        healthBody: { ok: true },
        chatStatus: 200, // will be overridden by the custom handler below
      },
    );

    // Override the server to make chat fail
    const serverAddr = server.address();
    const port = typeof serverAddr === 'object' && serverAddr ? serverAddr.port : 0;
    await close(server);

    // Create a new server where chat always times out / fails
    const failServer = createServer(async (req, res) => {
      const path = new URL(req.url || '/', 'http://localhost').pathname;
      if (path === '/api/health') return writeJson(res, 200, { ok: true });
      if (req.method === 'GET' && path === '/v1/models') return writeJson(res, 200, { data: [{ id: 'oc/deepseek-v4-flash-free' }] });
      if (req.method === 'POST' && path === '/v1/chat/completions') {
        writeJson(res, 503, { error: { type: 'service_unavailable', message: 'model temporarily unavailable' } });
        return;
      }
      return writeJson(res, 404, { error: { message: 'not found' } });
    });
    await new Promise<void>(resolve => failServer.listen(port, resolve));

    try {
      process.env.NINEROUTER_URL = `http://127.0.0.1:${port}`;
      const config = {
        currentProvider: 'ninerouter',
        currentModel: 'oc/deepseek-v4-flash-free',
        apiKeys: {},
        ollamaBaseUrl: 'http://localhost:11434',
        debug: false,
        lightMode: false,
        promptMode: 'auto',
        agentMode: 'chat',
      } as HysaConfig;

      // Discovery should succeed (models endpoint works)
      const disc = await discoverNinerouter(config, { timeoutMs: 2000, force: true });
      assert.equal(disc.available, true, 'discovery should succeed because /v1/models works');

      // But probe should fail
      const probe = await probe9RouterModel(config, 'oc/deepseek-v4-flash-free', { timeoutMs: 2000 });
      assert.equal(probe.usable, false);
      assert.equal(probe.httpStatus, 503);
      assert.equal(probe.status, 'unavailable');
      assert.ok(probe.rawBody?.includes('model temporarily unavailable'), 'body should include error detail');
    } finally {
      delete process.env.NINEROUTER_URL;
      await close(failServer);
    }
  });
});

describe('final chat error is never unknown', () => {
  it('categorizeError never returns unknown for Connection error', () => {
    const errors = [
      'Connection error.',
      'Connection error: fetch failed',
      'Connection refused: connect',
      'fetch failed: getaddrinfo ENOTFOUND',
      'Network error: socket hang up',
      'ECONNREFUSED connect',
      'ECONNRESET read',
    ];
    for (const err of errors) {
      const cat = categorizeError(err);
      assert.notEqual(cat, 'unknown', `"${err}" should not be categorized as unknown (got: ${cat})`);
      assert.equal(cat, 'network', `"${err}" should be network (got: ${cat})`);
    }
  });

  it('categorizeError returns network for timeout-related network errors', () => {
    const cat = categorizeError('network timeout');
    // "network timeout" matches timeout first, which is fine
    assert.ok(cat === 'timeout' || cat === 'network', `network timeout should be timeout or network (got: ${cat})`);
  });

  it('classifyNinerouterFailure never returns unknown for connection issues', () => {
    const result = classifyNinerouterFailure({
      errorMessage: 'Connection error.',
      rawBody: 'Connection error.',
    });
    assert.notEqual(result, 'unknown_error', 'Connection error should not be unknown_error');
    assert.equal(result, 'unavailable');
  });
});

describe('OpenAI Router /v1 maps to 9Router root for discovery', () => {
  afterEach(() => {
    clearNinerouterDiscoveryCache();
  });

  it('discovers 9Router from openaiRouterBaseUrl when same server', async () => {
    const { server, rootUrl } = await startRouterServer(
      ['oc/deepseek-v4-flash-free', 'gemini/gemini-2.0-flash-lite'],
      { healthStatus: 200, healthBody: { ok: true } },
    );

    try {
      // Config with openaiRouterBaseUrl but NO ninerouter config
      const config = {
        currentProvider: 'openai_router',
        currentModel: 'oc/deepseek-v4-flash-free',
        openaiRouterBaseUrl: `${rootUrl}/v1`,
        apiKeys: {},
        ollamaBaseUrl: 'http://localhost:11434',
        debug: false,
        lightMode: false,
        promptMode: 'auto',
        agentMode: 'chat',
      } as HysaConfig;

      const result = await discoverNinerouter(config, { timeoutMs: 2000, force: true });
      assert.equal(result.available, true, 'should discover 9Router from openaiRouterBaseUrl');
      assert.ok(result.models.includes('oc/deepseek-v4-flash-free'), 'should have the model');
      assert.equal(result.models.length, 2);
    } finally {
      await close(server);
    }
  });

  it('discovers 9Router via NINEROUTER_URL without /v1', async () => {
    const { server, rootUrl } = await startRouterServer(
      ['oc/deepseek-v4-flash-free'],
      { healthStatus: 200, healthBody: { ok: true } },
    );

    try {
      process.env.NINEROUTER_URL = rootUrl; // rootUrl has no /v1
      const config = {
        currentProvider: 'ninerouter',
        currentModel: 'oc/deepseek-v4-flash-free',
        apiKeys: {},
        ollamaBaseUrl: 'http://localhost:11434',
        debug: false,
        lightMode: false,
        promptMode: 'auto',
        agentMode: 'chat',
      } as HysaConfig;

      const result = await discoverNinerouter(config, { timeoutMs: 2000, force: true });
      assert.equal(result.available, true);
      assert.ok(result.apiBaseUrl.endsWith('/v1'), 'apiBaseUrl should have /v1 suffix');
      assert.ok(!result.rootUrl.endsWith('/v1'), 'rootUrl should NOT have /v1 suffix');
    } finally {
      delete process.env.NINEROUTER_URL;
      await close(server);
    }
  });
});
