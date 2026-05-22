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

import { getStatus, getConfig, updateConfig, getProjectTree, getFileContent, saveFile, handleChat, handleChatStream, runCommand, getFilePreview, getYoloStatus, setYoloStatus, getFallbackStatus } from './api.js';
import type { Server } from 'node:http';

// Keep server reference alive so GC doesn't close it
let _serverRef: Server | null = null;

export function getServerRef() { return _serverRef; }

export async function startWebServer(port = 8787): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  app.get('/api/status', (_req, res) => {
    res.json(getStatus());
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

  app.post('/api/chat', async (req, res) => {
    try {
      const result = await handleChat(req.body);
      res.json(result);
    } catch (err: unknown) {
      const e = err as Error;
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/chat/stream', async (req, res) => {
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

  app.post('/api/run', async (req, res) => {
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

  app.get('/api/yolo', (_req, res) => {
    res.json(getYoloStatus());
  });

  app.post('/api/yolo', (req, res) => {
    const { enabled } = req.body as { enabled: boolean };
    res.json(setYoloStatus(enabled));
  });

  app.get('/api/fallback', (_req, res) => {
    res.json(getFallbackStatus());
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

  return new Promise<void>((resolveStart, reject) => {
    const server = app.listen(port, () => {
      console.log(`\n  🌐 HYSA Web running at http://localhost:${port}\n`);
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
