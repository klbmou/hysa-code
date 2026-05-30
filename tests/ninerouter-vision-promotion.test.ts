import { afterEach, beforeEach, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { createSingleClient } from '../src/ai/client-factory.js';
import { hasVisionCapability } from '../src/ai/provider-capabilities.js';
import type { HysaConfig } from '../src/config/keys.js';
import {
  buildVisionMessages,
  clearNinerouterVisionCache,
  getVisionFallbackCandidates,
} from '../src/web/api.js';

function mockConfig(overrides: Partial<HysaConfig> = {}): HysaConfig {
  return {
    currentProvider: 'deepseek',
    currentModel: 'deepseek-chat',
    apiKeys: {},
    ollamaBaseUrl: 'http://localhost:11434',
    debug: false,
    lightMode: false,
    promptMode: 'auto',
    agentMode: 'chat',
    ...overrides,
  } as HysaConfig;
}

async function startMockNinerouter(): Promise<{ server: Server; rootUrl: string; apiBaseUrl: string; bodies: any[] }> {
  const bodies: any[] = [];
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const path = new URL(req.url || '/', 'http://localhost').pathname;
    if (req.method === 'GET' && path === '/api/health') {
      return writeJson(res, 200, { ok: true });
    }
    if (req.method === 'GET' && path === '/v1/models') {
      return writeJson(res, 200, {
        data: [
          { id: 'oc/deepseek-v4-flash-free' },
          { id: 'gemini/gemini-3.1-flash-lite-preview' },
          { id: 'gemini/gemini-3-flash-preview' },
          { id: 'gemini/gemini-2.0-flash-lite' },
        ],
      });
    }
    if (req.method === 'GET' && path === '/v1/models/image-to-text') {
      return writeJson(res, 200, { data: [] });
    }
    if (req.method === 'POST' && path === '/v1/chat/completions') {
      const parsed = JSON.parse(await readBody(req) || '{}');
      bodies.push(parsed);
      const hasImage = parsed.messages?.some((m: any) =>
        Array.isArray(m.content) && m.content.some((part: any) => part.type === 'image_url' && part.image_url?.url),
      );
      if (parsed.model === 'gemini/gemini-3.1-flash-lite-preview' && hasImage) {
        return writeJson(res, 200, { choices: [{ message: { content: 'vision ok' } }] });
      }
      return writeJson(res, 400, { error: { message: 'expected promoted Gemini model with image_url payload' } });
    }
    return writeJson(res, 404, { error: 'not found' });
  });

  await listen(server);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    server,
    rootUrl: `http://127.0.0.1:${port}`,
    apiBaseUrl: `http://127.0.0.1:${port}/v1`,
    bodies,
  };
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

describe('9Router vision promotion', () => {
  beforeEach(() => {
    delete process.env.NINEROUTER_URL;
    delete process.env.HYSA_9ROUTER_VISION_MODEL;
    clearNinerouterVisionCache();
  });

  afterEach(() => {
    delete process.env.NINEROUTER_URL;
    delete process.env.HYSA_9ROUTER_VISION_MODEL;
    clearNinerouterVisionCache();
  });

  it('empty /image-to-text still allows discovered Gemini vision candidates', async () => {
    const nr = await startMockNinerouter();
    process.env.NINEROUTER_URL = nr.rootUrl;
    try {
      const config = mockConfig();
      const candidates = await getVisionFallbackCandidates(config);

      assert.ok(candidates.some(c => c.provider === 'ninerouter' && c.model === 'gemini/gemini-3.1-flash-lite-preview'));
      assert.ok(candidates.some(c => c.provider === 'ninerouter' && c.model === 'gemini/gemini-3-flash-preview'));
      assert.ok(candidates.some(c => c.provider === 'ninerouter' && c.model === 'gemini/gemini-2.0-flash-lite'));
      assert.equal(candidates.some(c => c.model === 'oc/deepseek-v4-flash-free'), false);
    } finally {
      await close(nr.server);
    }
  });

  it('Gemini chat models are valid 9Router vision fallbacks', async () => {
    assert.equal(hasVisionCapability('ninerouter', 'gemini/gemini-3.1-flash-lite-preview'), true);
    assert.equal(hasVisionCapability('ninerouter', 'gemini/gemini-3-flash-preview'), true);
    assert.equal(hasVisionCapability('ninerouter', 'gemini/gemini-2.0-flash-lite'), true);
  });

  it('image analysis succeeds through promoted Gemini chat model using multimodal chat payload', async () => {
    const nr = await startMockNinerouter();
    process.env.NINEROUTER_URL = nr.rootUrl;
    try {
      const config = mockConfig();
      const candidates = await getVisionFallbackCandidates(config);
      const promoted = candidates.find(c => c.provider === 'ninerouter' && c.model === 'gemini/gemini-3.1-flash-lite-preview');
      assert.ok(promoted, 'promoted Gemini model should be a vision candidate');

      const messages = buildVisionMessages(
        [{ role: 'user', content: 'describe this image' }],
        [{ name: 'photo.png', ext: 'png', size: 12, kind: 'image', dataUrl: 'data:image/png;base64,abc' }],
      );
      const client = createSingleClient(
        promoted.provider,
        promoted.model,
        config.apiKeys,
        config.ollamaBaseUrl,
        config.localOpenAiBaseUrl,
        config.localOpenAiModel,
        config,
      );

      const result = await client.sendMessage(messages, 'system');

      assert.equal(result.message, 'vision ok');
      assert.equal(nr.bodies[0].model, 'gemini/gemini-3.1-flash-lite-preview');
      const userMessage = nr.bodies[0].messages.find((m: any) => m.role === 'user');
      assert.ok(Array.isArray(userMessage.content), '9Router should receive OpenAI multimodal chat content');
      assert.equal(userMessage.content[1].type, 'image_url');
      assert.equal(userMessage.content[1].image_url.url, 'data:image/png;base64,abc');
    } finally {
      await close(nr.server);
    }
  });
});
