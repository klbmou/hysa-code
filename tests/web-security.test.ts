import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { RateLimiter } from '../src/web/rate-limiter.js';
import { securityHeaders, getClientIP, createOriginGuard, createEndpointBlocker, rateLimitResponse } from '../src/web/security.js';

// ── HTTP helper (same pattern as web-server-routes.test.ts) ──

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

function createTestServer(app: express.Express): Promise<{ server: http.Server; port: number; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port, baseUrl: `http://localhost:${addr.port}` });
    });
  });
}

// ─────────────────────────────────────────────────────────────
// 1. RateLimiter class unit tests
// ─────────────────────────────────────────────────────────────

describe('RateLimiter (unit)', () => {

  it('allows requests under the limit', () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 5 });
    for (let i = 0; i < 5; i++) {
      const result = limiter.check('ip-test');
      assert.equal(result.allowed, true, `Request ${i} should be allowed`);
      assert.equal(result.retryAfter, 0);
    }
  });

  it('blocks requests over the limit and returns retryAfter', () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 3 });
    for (let i = 0; i < 3; i++) limiter.check('ip-over');
    const result = limiter.check('ip-over');
    assert.equal(result.allowed, false);
    assert.ok(result.retryAfter > 0, `retryAfter should be > 0, got ${result.retryAfter}`);
    assert.ok(result.retryAfter <= 60, `retryAfter should be <= 60, got ${result.retryAfter}`);
  });

  it('tracks different keys independently', () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 2 });
    assert.equal(limiter.check('ip-a').allowed, true);
    assert.equal(limiter.check('ip-b').allowed, true);
    assert.equal(limiter.check('ip-a').allowed, true);
    assert.equal(limiter.check('ip-b').allowed, true);
    assert.equal(limiter.check('ip-a').allowed, false);
    assert.equal(limiter.check('ip-b').allowed, false);
  });

  it('allows after window expires (single key)', () => {
    const limiter = new RateLimiter({ windowMs: 1, maxRequests: 1 }); // 1ms window
    assert.equal(limiter.check('ip-window').allowed, true);
    // After the window expires, the next check should reset
    const result = limiter.check('ip-window');
    assert.equal(result.allowed, false, 'Should still be limited (1ms window not yet expired)');
  });

  it('clear resets all buckets', () => {
    const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 1 });
    limiter.check('ip-clear');
    limiter.clear();
    assert.equal(limiter.check('ip-clear').allowed, true);
  });

});

// ─────────────────────────────────────────────────────────────
// 2. Rate limit middleware integration
// ─────────────────────────────────────────────────────────────

describe('Rate limit middleware integration', () => {

  it('chat endpoint returns 429 after exceeding limit', async () => {
    const app = express();
    app.use(express.json());

    const chatLimiter = new RateLimiter({ windowMs: 600_000, maxRequests: 3 });
    app.post('/api/chat', (req, res, next) => {
      const result = chatLimiter.check(getClientIP(req));
      if (!result.allowed) return rateLimitResponse(res, result.retryAfter);
      next();
    }, (_req, res) => {
      res.json({ ok: true });
    });

    const { server, baseUrl } = await createTestServer(app);
    try {
      for (let i = 0; i < 4; i++) {
        const res = await fetchJson(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
        });
        if (i < 3) {
          assert.equal(res.status, 200, `Request ${i} should succeed, got ${res.status}`);
        } else {
          assert.equal(res.status, 429, `Request ${i} should be rate limited, got ${res.status}`);
          assert.equal(res.json.error, 'RATE_LIMITED');
          assert.equal(res.json.message, 'Too many requests. Please wait and try again.');
          assert.ok(res.json.retryAfter > 0);
          assert.ok(res.headers['retry-after'], 'Retry-After header should be set');
          assert.equal(res.headers['retry-after'], String(res.json.retryAfter));
        }
      }
    } finally {
      server.close();
    }
  });

  it('image proxy endpoint returns 429 after exceeding limit', async () => {
    const app = express();
    app.use(express.json());

    const proxyLimiter = new RateLimiter({ windowMs: 600_000, maxRequests: 2 });
    app.get('/api/image/proxy', (req, res, next) => {
      const result = proxyLimiter.check(getClientIP(req));
      if (!result.allowed) return rateLimitResponse(res, result.retryAfter);
      next();
    }, (_req, res) => {
      res.json({ ok: true });
    });

    const { server, baseUrl } = await createTestServer(app);
    try {
      for (let i = 0; i < 3; i++) {
        const res = await fetchJson(`${baseUrl}/api/image/proxy?prompt=cat`);
        if (i < 2) {
          assert.equal(res.status, 200, `Request ${i} should succeed, got ${res.status}`);
        } else {
          assert.equal(res.status, 429, `Request ${i} should be rate limited, got ${res.status}`);
          assert.equal(res.json.error, 'RATE_LIMITED');
          assert.ok(res.json.retryAfter > 0);
        }
      }
    } finally {
      server.close();
    }
  });

});

// ─────────────────────────────────────────────────────────────
// 3. Production endpoint blocking
// ─────────────────────────────────────────────────────────────

describe('Production endpoint blocking', () => {

  it('debug endpoint blocked in production without HYSA_ENABLE_DEBUG_API', async () => {
    const app = express();
    const blocker = createEndpointBlocker({ envVar: 'HYSA_ENABLE_DEBUG_API', label: 'debug', isProduction: true });
    app.get('/api/debug/image', blocker, (_req, res) => res.json({ ok: true }));
    app.get('/api/debug/search', blocker, (_req, res) => res.json({ ok: true }));

    const { server, baseUrl } = await createTestServer(app);
    try {
      const res1 = await fetchJson(`${baseUrl}/api/debug/image?prompt=cat`);
      assert.equal(res1.status, 403);
      assert.equal(res1.json.error, 'ENDPOINT_DISABLED');
      assert.ok(res1.json.message.includes('HYSA_ENABLE_DEBUG_API'));

      const res2 = await fetchJson(`${baseUrl}/api/debug/search?q=test`);
      assert.equal(res2.status, 403);
      assert.equal(res2.json.error, 'ENDPOINT_DISABLED');
    } finally {
      server.close();
    }
  });

  it('debug endpoint allowed in production when HYSA_ENABLE_DEBUG_API=true', async () => {
    const orig = process.env.HYSA_ENABLE_DEBUG_API;
    process.env.HYSA_ENABLE_DEBUG_API = 'true';

    const app = express();
    const blocker = createEndpointBlocker({ envVar: 'HYSA_ENABLE_DEBUG_API', label: 'debug', isProduction: true });
    app.get('/api/debug/image', blocker, (_req, res) => res.json({ ok: true }));

    const { server, baseUrl } = await createTestServer(app);
    try {
      const res = await fetchJson(`${baseUrl}/api/debug/image?prompt=cat`);
      assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
      assert.equal(res.json.ok, true);
    } finally {
      server.close();
      process.env.HYSA_ENABLE_DEBUG_API = orig;
    }
  });

  it('/api/run blocked in production without HYSA_ENABLE_DANGEROUS_WEB_ACTIONS', async () => {
    const app = express();
    app.use(express.json());
    const blocker = createEndpointBlocker({ envVar: 'HYSA_ENABLE_DANGEROUS_WEB_ACTIONS', label: 'dangerous', isProduction: true });
    app.post('/api/run', blocker, (_req, res) => res.json({ ok: true }));

    const { server, baseUrl } = await createTestServer(app);
    try {
      const res = await fetchJson(`${baseUrl}/api/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'echo test' }),
      });
      assert.equal(res.status, 403);
      assert.equal(res.json.error, 'ENDPOINT_DISABLED');
      assert.ok(res.json.message.includes('HYSA_ENABLE_DANGEROUS_WEB_ACTIONS'));
    } finally {
      server.close();
    }
  });

  it('/api/yolo blocked in production without HYSA_ENABLE_DANGEROUS_WEB_ACTIONS', async () => {
    const app = express();
    const blocker = createEndpointBlocker({ envVar: 'HYSA_ENABLE_DANGEROUS_WEB_ACTIONS', label: 'dangerous', isProduction: true });
    app.get('/api/yolo', blocker, (_req, res) => res.json({ enabled: false }));

    const { server, baseUrl } = await createTestServer(app);
    try {
      const res = await fetchJson(`${baseUrl}/api/yolo`);
      assert.equal(res.status, 403);
      assert.equal(res.json.error, 'ENDPOINT_DISABLED');
    } finally {
      server.close();
    }
  });

  it('/api/run and /api/yolo allowed in dev mode', async () => {
    const app = express();
    app.use(express.json());
    const blocker = createEndpointBlocker({ envVar: 'HYSA_ENABLE_DANGEROUS_WEB_ACTIONS', label: 'dangerous', isProduction: false });
    app.post('/api/run', blocker, (_req, res) => res.json({ ok: true }));
    app.get('/api/yolo', blocker, (_req, res) => res.json({ enabled: false }));

    const { server, baseUrl } = await createTestServer(app);
    try {
      const res1 = await fetchJson(`${baseUrl}/api/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'echo test' }),
      });
      assert.equal(res1.status, 200, 'Run endpoint should be allowed in dev mode');

      const res2 = await fetchJson(`${baseUrl}/api/yolo`);
      assert.equal(res2.status, 200, 'YOLO endpoint should be allowed in dev mode');
    } finally {
      server.close();
    }
  });

  it('debug endpoint allowed in dev mode without env var', async () => {
    const app = express();
    const blocker = createEndpointBlocker({ envVar: 'HYSA_ENABLE_DEBUG_API', label: 'debug', isProduction: false });
    app.get('/api/debug/image', blocker, (_req, res) => res.json({ ok: true }));

    const { server, baseUrl } = await createTestServer(app);
    try {
      const res = await fetchJson(`${baseUrl}/api/debug/image?prompt=cat`);
      assert.equal(res.status, 200, 'Debug endpoint should be allowed in dev mode');
    } finally {
      server.close();
    }
  });

});

// ─────────────────────────────────────────────────────────────
// 4. Origin guard
// ─────────────────────────────────────────────────────────────

describe('Origin guard', () => {

  it('blocks unknown origins in production when HYSA_ALLOWED_ORIGINS is set', async () => {
    const app = express();
    app.use(createOriginGuard({ isProduction: true, allowedOrigins: 'https://example.com' }));
    app.get('/api/test', (_req, res) => res.json({ ok: true }));

    const { server, baseUrl } = await createTestServer(app);
    try {
      const res = await fetchJson(`${baseUrl}/api/test`, {
        headers: { Origin: 'https://evil.com' },
      });
      assert.equal(res.status, 403);
      assert.equal(res.json.error, 'ORIGIN_NOT_ALLOWED');
    } finally {
      server.close();
    }
  });

  it('allows matching origins in production', async () => {
    const app = express();
    app.use(createOriginGuard({ isProduction: true, allowedOrigins: 'https://example.com' }));
    app.get('/api/test', (_req, res) => res.json({ ok: true }));

    const { server, baseUrl } = await createTestServer(app);
    try {
      const res = await fetchJson(`${baseUrl}/api/test`, {
        headers: { Origin: 'https://example.com' },
      });
      assert.equal(res.status, 200);
    } finally {
      server.close();
    }
  });

  it('allows same-origin requests (no Origin header) in production', async () => {
    const app = express();
    app.use(createOriginGuard({ isProduction: true, allowedOrigins: 'https://example.com' }));
    app.get('/api/test', (_req, res) => res.json({ ok: true }));

    const { server, baseUrl } = await createTestServer(app);
    try {
      const res = await fetchJson(`${baseUrl}/api/test`); // no Origin header
      assert.equal(res.status, 200);
    } finally {
      server.close();
    }
  });

  it('allows all origins in dev mode even with HYSA_ALLOWED_ORIGINS set', async () => {
    const app = express();
    app.use(createOriginGuard({ isProduction: false, allowedOrigins: 'https://example.com' }));
    app.get('/api/test', (_req, res) => res.json({ ok: true }));

    const { server, baseUrl } = await createTestServer(app);
    try {
      const res = await fetchJson(`${baseUrl}/api/test`, {
        headers: { Origin: 'https://evil.com' },
      });
      assert.equal(res.status, 200, 'Should allow any origin in dev mode');
    } finally {
      server.close();
    }
  });

  it('supports multiple comma-separated allowed origins', async () => {
    const app = express();
    app.use(createOriginGuard({ isProduction: true, allowedOrigins: 'https://app1.com, https://app2.com' }));
    app.get('/api/test', (_req, res) => res.json({ ok: true }));

    const { server, baseUrl } = await createTestServer(app);
    try {
      const res1 = await fetchJson(`${baseUrl}/api/test`, { headers: { Origin: 'https://app1.com' } });
      assert.equal(res1.status, 200);

      const res2 = await fetchJson(`${baseUrl}/api/test`, { headers: { Origin: 'https://app2.com' } });
      assert.equal(res2.status, 200);

      const res3 = await fetchJson(`${baseUrl}/api/test`, { headers: { Origin: 'https://evil.com' } });
      assert.equal(res3.status, 403);
    } finally {
      server.close();
    }
  });

});

// ─────────────────────────────────────────────────────────────
// 5. Security headers
// ─────────────────────────────────────────────────────────────

describe('Security headers', () => {

  it('sets X-Content-Type-Options, Referrer-Policy, Permissions-Policy', async () => {
    const app = express();
    app.use(securityHeaders);
    app.get('/api/test', (_req, res) => res.json({ ok: true }));

    const { server, baseUrl } = await createTestServer(app);
    try {
      const res = await fetchJson(`${baseUrl}/api/test`);
      assert.equal(res.status, 200);
      assert.equal(res.headers['x-content-type-options'], 'nosniff');
      assert.equal(res.headers['referrer-policy'], 'no-referrer');
      assert.equal(res.headers['permissions-policy'], 'camera=(), microphone=(), geolocation=()');
    } finally {
      server.close();
    }
  });

});

// ─────────────────────────────────────────────────────────────
// 6. getClientIP tests
// ─────────────────────────────────────────────────────────────

describe('getClientIP', () => {

  it('uses x-forwarded-for first IP', () => {
    const req = { headers: { 'x-forwarded-for': '203.0.113.1, 198.51.100.2' }, ip: '10.0.0.1', socket: { remoteAddress: '::1' } } as any;
    assert.equal(getClientIP(req), '203.0.113.1');
  });

  it('strips spaces from x-forwarded-for', () => {
    const req = { headers: { 'x-forwarded-for': '  203.0.113.1  , 198.51.100.2  ' }, ip: '10.0.0.1', socket: { remoteAddress: '::1' } } as any;
    assert.equal(getClientIP(req), '203.0.113.1');
  });

  it('falls back to req.ip when no x-forwarded-for', () => {
    const req = { headers: {}, ip: '10.0.0.1', socket: { remoteAddress: '::1' } } as any;
    assert.equal(getClientIP(req), '10.0.0.1');
  });

  it('falls back to socket.remoteAddress when no headers or ip', () => {
    const req = { headers: {}, socket: { remoteAddress: '::1' } } as any;
    assert.equal(getClientIP(req), '::1');
  });

  it('falls back to unknown when nothing available', () => {
    const req = { headers: {}, socket: {} } as any;
    assert.equal(getClientIP(req), 'unknown');
  });

});
