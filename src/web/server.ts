import express from 'express';
import { dirname, join, basename } from 'node:path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Use __dirname for CJS (pkg), ESM fallback otherwise
let _dirname: string;
try {
  _dirname = dirname(fileURLToPath(import.meta.url));
} catch {
  _dirname = typeof __dirname !== 'undefined' ? __dirname : process.cwd();
}

import { getStatus, getConfig, updateConfig, getProjectTree, getFileContent, saveFile, handleChat, handleChatStream, continueChat, runCommand, getFilePreview, getYoloStatus, setYoloStatus, getFallbackStatus, handleImageGen, handleImageProxy } from './api.js';
import { searchWeb, formatSearchResults, getSearchDiagnostics } from '../tools/web-search.js';
import { RateLimiter } from './rate-limiter.js';
import { securityHeaders, getClientIP, createOriginGuard, createPublicAccessGuard, createEndpointBlocker, rateLimitResponse } from './security.js';
import type { Server } from 'node:http';

// Keep server reference alive so GC doesn't close it
let _serverRef: Server | null = null;

export function getServerRef() { return _serverRef; }

// ── Rate limiters ────────────────────────────────────────────────
const generalLimiter = new RateLimiter({ windowMs: 60_000, maxRequests: 60 });
const chatLimiter = new RateLimiter({ windowMs: 600_000, maxRequests: 10 });
const imageLimiter = new RateLimiter({ windowMs: 600_000, maxRequests: 10 });
const proxyLimiter = new RateLimiter({ windowMs: 600_000, maxRequests: 30 });

function rateLimitRoute(limiter: RateLimiter, label: string) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = getClientIP(req);
    const result = limiter.check(ip);
    if (!result.allowed) {
      console.log(`[RateLimit] ip=${ip} route=${label} retryAfter=${result.retryAfter}`);
      return rateLimitResponse(res, result.retryAfter);
    }
    next();
  };
}

export async function startWebServer(port = 8787, host?: string): Promise<void> {
  const app = express();

  // Trust proxy for Render (correct client IP from X-Forwarded-For)
  if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  }

  app.use(express.json({ limit: '50mb' }));
  app.use(securityHeaders);
  app.use(createOriginGuard());
  app.use(createPublicAccessGuard());

  // Health check (no auth)
  app.get('/api/health', (_req, res) => {
    const mem = process.memoryUsage();
    res.json({ status: 'ok', uptime: process.uptime(), memory: { rss: mem.rss, heapUsed: mem.heapUsed }, production: process.env.NODE_ENV === 'production', publicUrl: process.env.HYSA_PUBLIC_URL || null, publicAccessKey: !!process.env.HYSA_PUBLIC_API_KEY });
  });

  // General rate limiter for all /api/* routes (baseline)
  app.use('/api', rateLimitRoute(generalLimiter, '/api/*'));

  app.get('/api/status', (_req, res) => {
    res.json(getStatus());
  });

  // ── Live log tail (for LogViewer frontend) ──
  app.get('/api/logs', (req, res) => {
    const lines = Math.min(Math.max(parseInt(req.query.lines as string) || 50, 1), 500);
    const logFile = join(process.cwd(), 'logs', 'hysa-out.log');
    if (!existsSync(logFile)) return res.json({ ok: true, lines: [], file: logFile, totalLines: 0, truncated: false });
    try {
      const { statSync, openSync, readSync, closeSync } = require('node:fs');
      const st = statSync(logFile);
      if (st.size === 0) return res.json({ ok: true, lines: [], file: logFile, totalLines: 0, truncated: false });
      const avgBytesPerLine = 120;
      const readBytes = Math.min(lines * avgBytesPerLine, st.size);
      const fd = openSync(logFile, 'r');
      const buf = Buffer.alloc(readBytes);
      const br = readSync(fd, buf, 0, readBytes, Math.max(0, st.size - readBytes));
      closeSync(fd);
      const content = buf.toString('utf-8', 0, br);
      const tail = content.split('\n').filter(Boolean).slice(-lines);
      res.json({ ok: true, lines: tail, file: logFile, totalLines: tail.length, truncated: br < st.size, fileSize: st.size });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });



  app.get('/api/download/exe', (req, res) => {
    // Try process.execPath first (always the exact current version, no extra size)
    const execPath = process.execPath;
    const isNodeExe = basename(execPath).toLowerCase() === 'node.exe';
    const isTemp = execPath.toLowerCase().includes('\\temp\\') || execPath.toLowerCase().includes('\\tmp\\');
    let downloadPath: string | null = null;
    if (!isNodeExe && !isTemp && existsSync(execPath)) {
      downloadPath = execPath;
    } else {
      // Fall back to bundled download.exe
      const bundled = join(webDist, 'download.exe');
      if (existsSync(bundled)) {
        downloadPath = bundled;
      }
    }
    if (!downloadPath) {
      return res.status(404).json({ error: 'Download not available' });
    }
    try {
      const buffer = readFileSync(downloadPath);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', buffer.length);
      res.setHeader('Content-Disposition', 'attachment; filename="hysa.exe"');
      res.end(buffer);
    } catch (err: unknown) {
      res.status(500).json({ error: `Failed to read: ${(err as Error).message}` });
    }
  });

  app.get('/api/config', (_req, res) => {
    const config = getConfig();
    if (!config) return res.status(404).json({ error: 'No config found' });
    res.json(config);
  });

  app.post('/api/config', (req, res) => {
    try {
      const updated = updateConfig(req.body);
      res.json(updated);
    } catch (err: unknown) {
      res.status(400).json({ error: (err as Error).message });
    }
  });

  app.get('/api/project/tree', (_req, res) => {
    try {
      res.json(getProjectTree());
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/file', (req, res) => {
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ error: 'Missing path parameter' });
    const result = getFileContent(filePath);
    if (result.content === null) {
      return res.status(404).json({ error: result.error || 'File not found' });
    }
    res.json({ content: result.content });
  });

  app.post('/api/file/save', (req, res) => {
    const { path, content } = req.body as { path: string; content: string };
    if (!path) return res.status(400).json({ error: 'Missing path' });
    const result = saveFile(path, content);
    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }
    res.json({ success: true, diff: result.diff });
  });

  app.post('/api/file/preview', (req, res) => {
    const { path, content } = req.body as { path: string; content: string };
    if (!path) return res.status(400).json({ error: 'Missing path' });
    const diff = getFilePreview(path, content);
    res.json({ diff });
  });

  app.post('/api/chat', rateLimitRoute(chatLimiter, '/api/chat'), async (req, res) => {
    try {
      const result = await handleChat(req.body);
      res.json(result);
    } catch (err: unknown) {
      const e = err as Error;
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/chat/stream', rateLimitRoute(chatLimiter, '/api/chat/stream'), async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const writeEvent = (event: string) => {
      try { res.write(event); } catch { /* client disconnected */ }
    };

    await handleChatStream(req.body, writeEvent);
    res.end();
  });

  app.post('/api/chat/continue', rateLimitRoute(chatLimiter, '/api/chat/continue'), async (req, res) => {
    try {
      const { messages, toolCalls, toolResults } = req.body as { messages: { role: string; content: string }[]; toolCalls: { type: string; params: Record<string, string> }[]; toolResults: string[] };
      if (!messages || !toolCalls || !toolResults) {
        return res.status(400).json({ error: 'Missing messages, toolCalls, or toolResults' });
      }
      const result = await continueChat(messages, toolCalls, toolResults);
      res.json(result);
    } catch (err: unknown) {
      const e = err as Error;
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/run', createEndpointBlocker({ envVar: 'HYSA_ENABLE_DANGEROUS_WEB_ACTIONS', label: 'dangerous' }), async (req, res) => {
    const { command } = req.body as { command: string };
    if (!command) return res.status(400).json({ error: 'Missing command' });
    try {
      const result = await runCommand(command);
      res.json(result);
    } catch (err: unknown) {
      const e = err as Error;
      res.json({ stdout: '', stderr: e.message, error: e.message });
    }
  });

  app.get('/api/yolo', createEndpointBlocker({ envVar: 'HYSA_ENABLE_DANGEROUS_WEB_ACTIONS', label: 'dangerous' }), (_req, res) => {
    res.json(getYoloStatus());
  });

  app.post('/api/yolo', createEndpointBlocker({ envVar: 'HYSA_ENABLE_DANGEROUS_WEB_ACTIONS', label: 'dangerous' }), (req, res) => {
    const { enabled } = req.body as { enabled: boolean };
    res.json(setYoloStatus(enabled));
  });

  app.post('/api/image/generate', rateLimitRoute(imageLimiter, '/api/image/generate'), async (req, res) => {
    try {
      const { prompt } = req.body as { prompt: string };
      if (!prompt) return res.status(400).json({ error: 'Missing prompt' });
      const result = await handleImageGen(prompt);
      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/image/proxy', rateLimitRoute(proxyLimiter, '/api/image/proxy'), async (req, res) => {
    try {
      const prompt = (req.query.prompt as string || '').trim();
      if (!prompt) return res.status(400).json({ ok: false, error: 'Missing prompt' });
      const result = await handleImageProxy(prompt);
      if (result.ok && result.buffer) {
        res.setHeader('Content-Type', result.contentType || 'image/jpeg');
        res.setHeader('Content-Length', result.buffer.length);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.end(result.buffer);
      } else {
        res.status(502).json({ ok: false, error: result.error || 'Image proxy failed', upstreamUrl: result.upstreamUrl, contentType: result.contentType, status: result.status });
      }
    } catch (err: unknown) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  app.get('/api/debug/image', createEndpointBlocker({ envVar: 'HYSA_ENABLE_DEBUG_API', label: 'debug' }), async (req, res) => {
    try {
      const prompt = (req.query.prompt as string) || 'cat';
      const encodedPrompt = encodeURIComponent(prompt);
      const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nofeed=true`;
      let headStatus: number | null = null;
      let headError: string | null = null;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 12000);
        const check = await fetch(imageUrl, { method: 'HEAD', signal: controller.signal });
        clearTimeout(timeoutId);
        headStatus = check.status;
      } catch (err) {
        headError = (err as Error).message;
      }
      res.json({ ok: true, prompt, encodedPrompt, imageUrl, headStatus, headError });
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  app.get('/api/debug/search', createEndpointBlocker({ envVar: 'HYSA_ENABLE_DEBUG_API', label: 'debug' }), async (req, res) => {
    try {
      const q = (req.query.q as string) || 'test';
      const diag = getSearchDiagnostics();
      const results = await searchWeb(q, { maxResults: 5 });
      res.json({ ok: true, query: q, provider: diag.provider, hasTavilyKey: diag.hasTavilyKey, isReliable: diag.isReliable, resultCount: results.length, results: results.map(r => ({ title: r.title, url: r.url, snippet: r.snippet?.slice(0, 200) })) });
    } catch (err) {
      res.status(500).json({ ok: false, error: (err as Error).message });
    }
  });

  app.get('/api/fallback', (_req, res) => {
    res.json(getFallbackStatus());
  });

  // Catch-all for unmatched /api/* routes — return JSON, never HTML
  app.use('/api', (req, res) => {
    res.status(404).json({
      ok: false,
      error: 'API route not found',
      method: req.method,
      path: req.originalUrl,
    });
  });

  // Serve static frontend
  // __dirname depends on context:
  //   - pkg CJS bundle (dist/bundle.cjs): __dirname = snapshot root/dist/
  //   - plain Node.js: __dirname = src/web/
  //   - fallback: process.cwd()
  let webDist = join(_dirname, '..', 'web', 'dist');    // from dist/
  if (!existsSync(webDist)) {
    webDist = join(_dirname, '..', '..', 'web', 'dist'); // from src/web/
  }
  if (!existsSync(webDist)) {
    webDist = join(_dirname, 'web', 'dist');             // from project root
  }
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.use((req, res, next) => {
      if (req.method === 'GET' && !req.path.startsWith('/api/')) {
        res.sendFile(join(webDist, 'index.html'));
      } else {
        next();
      }
    });
  } else {
    app.get('/', (_req, res) => {
      res.send('HYSA Web UI not built. Run: cd web && npm install && npm run build');
    });
  }

  // Catch-all for non-API GET routes — serve error.html if available
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/')) {
      const errorPage = join(process.cwd(), 'web', 'public', 'error.html');
      if (existsSync(errorPage)) {
        res.status(503).sendFile(errorPage);
      } else {
        res.status(503).type('html').send('<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>HYSA Offline</title><style>body{background:#0d0d10;color:#e4e4e8;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif}.c{text-align:center}.t{color:#8a8f98;font-size:14px}.m{color:#555;font-size:12px;margin-top:8px}</style></head><body><div class="c"><div class="t">HYSA System Updating</div><div class="m">Please retry in 30 seconds.</div></div></body></html>');
      }
    } else {
      next();
    }
  });

  return new Promise<void>((resolveStart, reject) => {
    const listenHost = host || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : undefined);
    const server = listenHost
      ? app.listen(port, listenHost, () => {
          console.log(`\n  [HYSA Web] Frontend served on http://${listenHost}:${port}`);
          console.log(`  [HYSA Web] API server listening on port ${port}`);
          console.log(`  [HYSA Web] API routes registered:`);
          const apiRoutes = ['/api/status', '/api/config', '/api/project/tree', '/api/file', '/api/file/save', '/api/file/preview', '/api/chat', '/api/chat/stream', '/api/chat/continue', '/api/run', '/api/yolo', '/api/image/generate', '/api/image/proxy', '/api/debug/image', '/api/debug/search', '/api/fallback', '/api/download/exe'];
          for (const r of apiRoutes) console.log(`    · ${r}`);
          console.log(`  [HYSA Web] JSON 404 catch-all active for unmatched /api/*`);
          resolveStart();
        })
      : app.listen(port, () => {
          console.log(`\n  [HYSA Web] Frontend served on http://localhost:${port}`);
          console.log(`  [HYSA Web] API server listening on port ${port}`);
          console.log(`  [HYSA Web] API routes registered:`);
          const apiRoutes = ['/api/status', '/api/config', '/api/project/tree', '/api/file', '/api/file/save', '/api/file/preview', '/api/chat', '/api/chat/stream', '/api/chat/continue', '/api/run', '/api/yolo', '/api/image/generate', '/api/image/proxy', '/api/debug/image', '/api/debug/search', '/api/fallback', '/api/download/exe'];
          for (const r of apiRoutes) console.log(`    · ${r}`);
          console.log(`  [HYSA Web] JSON 404 catch-all active for unmatched /api/*`);
          resolveStart();
        });
    _serverRef = server;
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${port} is already in use. Try a different port or close the other process.`));
      } else {
        reject(err);
      }
    });
  });
}
