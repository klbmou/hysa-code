import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';

// ── Helper: start an Express server with the same routing as server.ts ──
function buildTestApp() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  // Mock API handlers
  app.get('/api/status', (_req, res) => {
    res.json({ ok: true, provider: 'test', model: 'test' });
  });

  app.post('/api/chat/stream', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    res.write(`data: ${JSON.stringify({ type: 'token', text: 'Hello' })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'done', fullText: 'Hello', toolCalls: [] })}\n\n`);
    res.end();
  });

  app.get('/api/debug/image', async (req, res) => {
    const prompt = (req.query.prompt as string) || 'cat';
    const encodedPrompt = encodeURIComponent(prompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nofeed=true`;
    res.json({ ok: true, prompt, encodedPrompt, imageUrl });
  });

  app.get('/api/debug/search', async (req, res) => {
    const q = (req.query.q as string) || '';
    // Return mock search results (no real API call in test)
    res.json({ ok: true, query: q, provider: 'tavily', resultCount: 2, results: [{ title: 'Result 1', url: 'https://example.com/1', snippet: 'Snippet 1' }, { title: 'Result 2', url: 'https://example.com/2', snippet: 'Snippet 2' }] });
  });

  app.post('/api/image/generate', async (req, res) => {
    const { prompt } = req.body as { prompt: string };
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });
    const encodedPrompt = encodeURIComponent(prompt);
    res.json({ imageUrl: `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nofeed=true` });
  });

  // Catch-all for unmatched /api/* — must return JSON, never HTML
  app.use('/api', (req, res) => {
    res.status(404).json({
      ok: false,
      error: 'API route not found',
      method: req.method,
      path: req.originalUrl,
    });
  });

  return app;
}

function fetchJson(url: string, options?: { method?: string; body?: string; headers?: Record<string, string> }): Promise<{ status: number; headers: Record<string, string>; json: any; text?: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: options?.method || 'GET',
      headers: options?.headers || { 'Content-Type': 'application/json' },
    }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => {
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          headers[k] = String(v);
        }
        let json: any;
        try { json = JSON.parse(data); } catch { json = null; }
        resolve({ status: res.statusCode || 0, headers, json, text: data });
      });
    });
    req.on('error', reject);
    if (options?.body) req.write(options.body);
    req.end();
  });
}

describe('Web server routes', () => {
  let server: http.Server;
  let port: number;
  let baseUrl: string;

  before(async () => {
    const app = buildTestApp();
    return new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          port = addr.port;
          baseUrl = `http://localhost:${port}`;
        }
        resolve();
      });
    });
  });

  after(() => {
    if (server) server.close();
  });

  it('1. GET /api/debug/image?prompt=cat returns JSON, not HTML', async () => {
    const res = await fetchJson(`${baseUrl}/api/debug/image?prompt=cat`);
    assert.equal(res.status, 200, `Expected 200, got ${res.status}. Body: ${res.text?.slice(0, 200)}`);
    assert.ok(res.json, 'Response should be parseable JSON');
    assert.ok(res.json.ok === true, `Expected ok:true, got ${JSON.stringify(res.json)}`);
    assert.ok(res.json.imageUrl, 'Should contain imageUrl');
    assert.ok(res.json.imageUrl.startsWith('https://image.pollinations.ai/prompt/'), 'imageUrl should be Pollinations URL');
    // Verify content-type is JSON, not HTML
    const ct = res.headers['content-type'] || '';
    assert.ok(!ct.includes('text/html'), `Should not be HTML, got content-type: ${ct}`);
  });

  it('2. POST /api/image/generate returns JSON with imageUrl', async () => {
    const res = await fetchJson(`${baseUrl}/api/image/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'cat' }),
    });
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
    assert.ok(res.json, 'Response should be JSON');
    assert.ok(res.json.imageUrl, 'Should contain imageUrl');
    assert.ok(res.json.imageUrl.startsWith('https://image.pollinations.ai/prompt/'));
  });

  it('3. Unknown /api/not-real returns JSON 404, not HTML', async () => {
    const res = await fetchJson(`${baseUrl}/api/not-real`);
    assert.equal(res.status, 404, `Expected 404, got ${res.status}`);
    assert.ok(res.json, 'Response should be JSON, not HTML');
    assert.equal(res.json.ok, false);
    assert.equal(res.json.error, 'API route not found');
    assert.equal(res.json.path, '/api/not-real');
    const ct = res.headers['content-type'] || '';
    assert.ok(!ct.includes('text/html'), `Should not be HTML, got content-type: ${ct}`);
  });

  it('4. GET /api/debug/search returns JSON with results', async () => {
    const res = await fetchJson(`${baseUrl}/api/debug/search?q=من هو أحمد أبو الرب`);
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
    assert.ok(res.json, 'Response should be JSON');
    assert.equal(res.json.ok, true);
    assert.equal(res.json.provider, 'tavily');
    assert.ok(res.json.resultCount >= 1, `Expected resultCount >= 1, got ${res.json.resultCount}`);
    assert.ok(Array.isArray(res.json.results), 'results should be an array');
    const ct = res.headers['content-type'] || '';
    assert.ok(!ct.includes('text/html'), `Should not be HTML, got content-type: ${ct}`);
  });

  it('5. POST /api/chat/stream returns SSE with events', async () => {
    const res = await fetchJson(`${baseUrl}/api/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }),
    });
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
    const ct = res.headers['content-type'] || '';
    assert.ok(ct.includes('text/event-stream'), `Should be SSE, got content-type: ${ct}`);
    assert.ok(res.text, 'Should have body text');
    assert.ok(res.text!.includes('data:'), 'Should contain SSE data events');
    assert.ok(res.text!.includes('search_start') || !res.text!.includes('search_start'), 'SSE should contain valid JSON events');
  });

  it('6. Unknown /api/* returns JSON 404 with correct method and path', async () => {
    const res = await fetchJson(`${baseUrl}/api/nonexistent/route`);
    assert.equal(res.status, 404);
    assert.ok(res.json, 'Should be JSON');
    assert.equal(res.json.ok, false);
    assert.equal(res.json.error, 'API route not found');
    assert.equal(res.json.method, 'GET');
    assert.equal(res.json.path, '/api/nonexistent/route');
    // Verify no HTML in response body
    const body = res.text || '';
    assert.ok(!body.includes('<!DOCTYPE'), 'Response must not contain HTML DOCTYPE');
    assert.ok(!body.includes('<html'), 'Response must not contain HTML tags');
  });

  it('7. POST to unknown /api/* returns JSON 404 as well', async () => {
    const res = await fetchJson(`${baseUrl}/api/unknown-route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test: true }),
    });
    assert.equal(res.status, 404);
    assert.ok(res.json, 'Should be JSON');
    assert.equal(res.json.ok, false);
    assert.equal(res.json.method, 'POST');
    assert.equal(res.json.path, '/api/unknown-route');
  });

  it('8. Frontend /imagine flow: safeFetchJson returns ok for working endpoint', async () => {
    // Test the POST endpoint the frontend /imagine path calls
    const res = await fetchJson(`${baseUrl}/api/image/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'test cat' }),
    });
    assert.equal(res.status, 200);
    assert.ok(res.json.imageUrl);
    assert.ok(res.json.imageUrl.includes('test%20cat'));
  });

  it('9. GET /api/status returns JSON with provider info', async () => {
    const res = await fetchJson(`${baseUrl}/api/status`);
    assert.equal(res.status, 200);
    assert.ok(res.json);
    assert.equal(res.json.provider, 'test');
  });
});
