import { afterEach, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { clearNinerouterDiscoveryCache, probe9RouterModel } from '../src/ai/ninerouter.js';
import type { HysaConfig } from '../src/config/keys.js';

function mockConfig(apiBaseUrl: string): HysaConfig {
  return {
    currentProvider: 'ninerouter',
    currentModel: 'oc/deepseek-v4-flash-free',
    apiKeys: {},
    ollamaBaseUrl: 'http://localhost:11434',
    ninerouterBaseUrl: apiBaseUrl,
    debug: false,
    lightMode: false,
    promptMode: 'auto',
    agentMode: 'chat',
  } as HysaConfig;
}

async function startProbeServer(status: number, body: unknown): Promise<{ server: Server; apiBaseUrl: string }> {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const path = new URL(req.url || '/', 'http://localhost').pathname;
    if (req.method === 'POST' && path === '/v1/chat/completions') {
      await readBody(req);
      return writeJson(res, status, body);
    }
    return writeJson(res, 404, { error: { message: 'not found' } });
  });
  await listen(server);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { server, apiBaseUrl: `http://127.0.0.1:${port}/v1` };
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

describe('9Router model probe', () => {
  afterEach(() => {
    clearNinerouterDiscoveryCache();
  });

  it('classifies HTTP 429 as rate_limited', async () => {
    const server = await startProbeServer(429, { error: { type: 'rate_limit', message: 'too many requests' } });
    try {
      const result = await probe9RouterModel(mockConfig(server.apiBaseUrl), 'oc/deepseek-v4-flash-free', { timeoutMs: 1000 });
      assert.equal(result.status, 'rate_limited');
      assert.equal(result.usable, false);
      assert.equal(result.httpStatus, 429);
    } finally {
      await close(server.server);
    }
  });

  it('classifies FreeUsageLimitError as rate_limited', async () => {
    const server = await startProbeServer(400, { error: { type: 'FreeUsageLimitError', message: 'free usage limit reached' } });
    try {
      const result = await probe9RouterModel(mockConfig(server.apiBaseUrl), 'oc/deepseek-v4-flash-free', { timeoutMs: 1000 });
      assert.equal(result.status, 'rate_limited');
      assert.equal(result.usable, false);
    } finally {
      await close(server.server);
    }
  });

  it('classifies 404 No active credentials as missing_credentials', async () => {
    const server = await startProbeServer(404, { error: { message: 'No active credentials. openai | total connections: 0' } });
    try {
      const result = await probe9RouterModel(mockConfig(server.apiBaseUrl), 'openai/auto', { timeoutMs: 1000 });
      assert.equal(result.status, 'missing_credentials');
      assert.equal(result.usable, false);
      assert.equal(result.httpStatus, 404);
    } finally {
      await close(server.server);
    }
  });

  it('classifies invalid model errors as invalid_model', async () => {
    const server = await startProbeServer(404, { error: { message: 'invalid model: missing/model' } });
    try {
      const result = await probe9RouterModel(mockConfig(server.apiBaseUrl), 'missing/model', { timeoutMs: 1000 });
      assert.equal(result.status, 'invalid_model');
      assert.equal(result.usable, false);
    } finally {
      await close(server.server);
    }
  });

  it('classifies network errors as unavailable', async () => {
    const result = await probe9RouterModel(mockConfig('http://127.0.0.1:1/v1'), 'oc/deepseek-v4-flash-free', { timeoutMs: 1000 });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.usable, false);
  });

  it('classifies successful ping as usable', async () => {
    const server = await startProbeServer(200, { choices: [{ message: { content: 'pong' } }] });
    try {
      const result = await probe9RouterModel(mockConfig(server.apiBaseUrl), 'gemini/gemini-3.1-flash-lite-preview', { timeoutMs: 1000 });
      assert.equal(result.status, 'usable');
      assert.equal(result.usable, true);
      assert.equal(result.httpStatus, 200);
    } finally {
      await close(server.server);
    }
  });
});
