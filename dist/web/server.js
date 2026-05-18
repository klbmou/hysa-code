import express from 'express';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
export async function startWebServer(port = 8787) {
    const app = express();
    app.use(express.json({ limit: '10mb' }));
    // API routes
    const { getStatus, getConfig, updateConfig, getProjectTree, getFileContent, saveFile, handleChat, runCommand, getFilePreview, getYoloStatus, setYoloStatus } = await import('./api.js');
    app.get('/api/status', (_req, res) => {
        res.json(getStatus());
    });
    app.get('/api/config', (_req, res) => {
        const config = getConfig();
        if (!config)
            return res.status(404).json({ error: 'No config found' });
        res.json(config);
    });
    app.post('/api/config', (req, res) => {
        try {
            const updated = updateConfig(req.body);
            res.json(updated);
        }
        catch (err) {
            res.status(400).json({ error: err.message });
        }
    });
    app.get('/api/project/tree', (_req, res) => {
        try {
            res.json(getProjectTree());
        }
        catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
    app.get('/api/file', (req, res) => {
        const filePath = req.query.path;
        if (!filePath)
            return res.status(400).json({ error: 'Missing path parameter' });
        const result = getFileContent(filePath);
        if (result.content === null) {
            return res.status(404).json({ error: result.error || 'File not found' });
        }
        res.json({ content: result.content });
    });
    app.post('/api/file/save', (req, res) => {
        const { path, content } = req.body;
        if (!path)
            return res.status(400).json({ error: 'Missing path' });
        const result = saveFile(path, content);
        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }
        res.json({ success: true, diff: result.diff });
    });
    app.post('/api/file/preview', (req, res) => {
        const { path, content } = req.body;
        if (!path)
            return res.status(400).json({ error: 'Missing path' });
        const diff = getFilePreview(path, content);
        res.json({ diff });
    });
    app.post('/api/chat', async (req, res) => {
        try {
            const result = await handleChat(req.body);
            res.json(result);
        }
        catch (err) {
            const e = err;
            res.status(500).json({ error: e.message });
        }
    });
    app.post('/api/run', async (req, res) => {
        const { command } = req.body;
        if (!command)
            return res.status(400).json({ error: 'Missing command' });
        try {
            const result = await runCommand(command);
            res.json(result);
        }
        catch (err) {
            const e = err;
            res.json({ stdout: '', stderr: e.message, error: e.message });
        }
    });
    app.get('/api/yolo', (_req, res) => {
        res.json(getYoloStatus());
    });
    app.post('/api/yolo', (req, res) => {
        const { enabled } = req.body;
        res.json(setYoloStatus(enabled));
    });
    // Serve static frontend
    const webDist = join(__dirname, '..', '..', 'web', 'dist');
    if (existsSync(webDist)) {
        app.use(express.static(webDist));
        // Catch-all: serve index.html for non-API GET requests (Express 5 compatible)
        app.use((req, res, next) => {
            if (req.method === 'GET' && !req.path.startsWith('/api/')) {
                res.sendFile(join(webDist, 'index.html'));
            }
            else {
                next();
            }
        });
    }
    else {
        app.get('/', (_req, res) => {
            res.send('HYSA Web UI not built. Run: cd web && npm install && npm run build');
        });
    }
    return new Promise((resolveStart, reject) => {
        const server = app.listen(port, () => {
            console.log(`\n  🌐 HYSA Web running at http://localhost:${port}\n`);
            resolveStart();
        });
        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                reject(new Error(`Port ${port} is already in use. Try a different port or close the other process.`));
            }
            else {
                reject(err);
            }
        });
    });
}
//# sourceMappingURL=server.js.map