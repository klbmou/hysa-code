import { app, BrowserWindow } from 'electron';
import { startWebServer } from '../web/server.js';

const PORT = parseInt(process.env.PORT || '10000', 10);
const HOST = process.env.HYSA_BIND_HOST || '127.0.0.1';
const SERVER_TIMEOUT_MS = 15000;
const REMOTE_URL = process.env.HYSA_REMOTE_URL || '';
const IS_REMOTE_CLIENT = !!REMOTE_URL;

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const targetUrl = REMOTE_URL || `http://${HOST}:${PORT}`;
  mainWindow.loadURL(targetUrl);

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function waitForServer(port: number, host: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: Error | undefined;
  while (Date.now() < deadline) {
    try {
      await startWebServer(port, host);
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (lastError.message.includes('already in use')) throw lastError;
      await new Promise(r => setTimeout(r, 500));
    }
  }
  throw lastError || new Error(`Server did not start within ${timeoutMs}ms`);
}

app.whenReady().then(async () => {
  if (IS_REMOTE_CLIENT) {
    console.log(`  [HYSA Desktop] Remote client mode — connecting to ${REMOTE_URL}`);
    createWindow();
    console.log(`  [HYSA Desktop] Electron window opened (remote backend)`);
    return;
  }

  const loadingWindow = new BrowserWindow({
    width: 400,
    height: 200,
    autoHideMenuBar: true,
    frame: false,
    show: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  loadingWindow.loadURL(`data:text/html,
    <html><body style="display:flex;align-items:center;justify-content:center;
    font-family:sans-serif;background:#1e1e1e;color:#ccc;margin:0;height:100%">
    <div style="text-align:center">
      <h2 style="margin:0 0 8px;color:#fff">HYSA</h2>
      <p style="margin:0;font-size:13px">Starting server…</p>
    </div></body></html>`);

  try {
    await waitForServer(PORT, HOST, SERVER_TIMEOUT_MS);
    console.log(`  [HYSA Desktop] Express server ready on ${HOST}:${PORT}`);
    if (!loadingWindow.isDestroyed()) loadingWindow.close();
    createWindow();
    console.log(`  [HYSA Desktop] Electron window opened`);
  } catch (err) {
    console.error('[HYSA Desktop] Failed to start:', err);
    if (!loadingWindow.isDestroyed()) {
      loadingWindow.loadURL(`data:text/html,
        <html><body style="display:flex;align-items:center;justify-content:center;
        font-family:sans-serif;background:#1e1e1e;color:#f55;margin:0;height:100%">
        <div style="text-align:center">
          <h2 style="margin:0 0 8px;color:#f55">Startup Failed</h2>
          <p style="margin:0;font-size:13px">${String(err).slice(0, 120)}</p>
        </div></body></html>`);
      setTimeout(() => app.quit(), 3000);
    } else {
      app.quit();
    }
  }
});

app.on('window-all-closed', () => {
  if (!IS_REMOTE_CLIENT) {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
