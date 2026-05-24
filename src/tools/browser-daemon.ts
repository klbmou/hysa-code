import http from 'node:http';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, normalize, isAbsolute } from 'node:path';

const HEADLESS_DEFAULT = process.env.HYSA_BROWSER_HEADLESS !== 'false';
const TIMEOUT_MS = parseInt(process.env.HYSA_BROWSER_TIMEOUT_MS || '15000', 10);
const SCREENSHOT_DIR = process.env.HYSA_BROWSER_SCREENSHOT_DIR || '.hysa/screenshots';

let browser: any = null;
let page: any = null;
let currentUrl = '';
let currentTitle = '';

function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'file:') return false;
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return true;
  } catch {
    return false;
  }
}

function isScreenshotPathSafe(targetPath: string): boolean {
  if (!isAbsolute(targetPath)) {
    const resolved = resolve(process.cwd(), targetPath);
    return resolved.startsWith(resolve(process.cwd(), SCREENSHOT_DIR));
  }
  return false;
}

async function importPlaywright(): Promise<any> {
  try {
    return await import('playwright');
  } catch {
    return null;
  }
}

async function performOpen(url: string, headless?: boolean, timeout?: number): Promise<any> {
  if (!isAllowedUrl(url)) return { ok: false, error: `Unsupported URL scheme: ${url}. Only http:// and https:// are allowed.` };

  const pw = await importPlaywright();
  if (!pw) return { ok: false, error: 'Playwright is not installed. Run: npx playwright install chromium' };

  if (browser) {
    try { await browser.close(); } catch {}
    browser = null;
    page = null;
  }

  try {
    const h = headless !== undefined ? headless : HEADLESS_DEFAULT;
    const t = timeout || TIMEOUT_MS;

    browser = await pw.chromium.launch({ headless: h });
    const context = await browser.newContext();
    page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: t });
    currentTitle = await page.title();
    currentUrl = url;

    return { ok: true, url, title: currentTitle, message: `Opened ${url} (title: "${currentTitle}")` };
  } catch (err: unknown) {
    if (browser) { try { await browser.close(); } catch {} browser = null; page = null; }
    return { ok: false, error: `Failed to open browser: ${(err as Error).message}` };
  }
}

async function performStatus(): Promise<any> {
  if (!browser || !page) return { ok: true, active: false, url: currentUrl, title: currentTitle };
  try {
    const u = page.url();
    const t = await page.title();
    currentUrl = u;
    currentTitle = t;
    return { ok: true, active: true, url: u, title: t };
  } catch {
    return { ok: true, active: false, url: currentUrl, title: currentTitle };
  }
}

async function performText(): Promise<any> {
  if (!browser || !page) return { ok: false, error: 'No active browser session.' };
  try {
    const text = await page.evaluate(() => document.body.innerText);
    const clean = (text || '').trim();
    return { ok: true, text: clean, message: clean ? `Got ${clean.length} chars of visible text` : 'Page has no visible text' };
  } catch (err: unknown) {
    return { ok: false, error: `Failed to get page text: ${(err as Error).message}` };
  }
}

async function performScreenshot(customPath?: string, fullPage?: boolean): Promise<any> {
  if (!browser || !page) return { ok: false, error: 'No active browser session.' };
  if (customPath && !isScreenshotPathSafe(customPath)) {
    return { ok: false, error: `Screenshot path must be inside ${SCREENSHOT_DIR}/. Got: ${customPath}` };
  }
  try {
    if (!existsSync(SCREENSHOT_DIR)) mkdirSync(SCREENSHOT_DIR, { recursive: true });
    let screenshotPath: string;
    if (customPath) {
      screenshotPath = resolve(process.cwd(), customPath);
    } else {
      screenshotPath = resolve(process.cwd(), SCREENSHOT_DIR, `screenshot-${Date.now()}.png`);
    }
    await page.screenshot({ path: screenshotPath, fullPage: fullPage ?? false });
    return { ok: true, path: screenshotPath, message: `Screenshot saved to ${screenshotPath}` };
  } catch (err: unknown) {
    return { ok: false, error: `Screenshot failed: ${(err as Error).message}` };
  }
}

async function performSnapshot(): Promise<any> {
  if (!browser || !page) return { ok: false, error: 'No active browser session.' };
  try {
    const snapshot = await page.evaluate(() => {
      const root = document.documentElement;
      if (!root) return '';
      const ignoreTags = new Set(['script', 'style', 'link', 'meta', 'noscript']);
      function format(el: Element): string {
        if (ignoreTags.has(el.tagName.toLowerCase())) return '';
        const role = el.getAttribute('role') || '';
        const name = el.getAttribute('aria-label') || '';
        const tag = el.tagName.toLowerCase();
        const text = (el as HTMLElement).innerText?.trim().slice(0, 80) || '';
        const isInteractive = ['a', 'button', 'input', 'textarea', 'select', 'details'].includes(tag) || role;
        if (!isInteractive && !text && !name) return '';
        const parts: string[] = [`<${tag}`];
        if (role) parts.push(` role="${role}"`);
        if (name) parts.push(` aria-label="${name}"`);
        const id = el.id;
        if (id) parts.push(` id="${id}"`);
        if (text) parts.push(` > "${text.slice(0, 60)}"`);
        parts.push('>');
        return parts.join('');
      }
      const lines: string[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let node: Element | null;
      while ((node = walker.nextNode() as Element | null)) {
        const line = format(node);
        if (line) lines.push(line);
      }
      return lines.join('\n');
    });
    return { ok: true, snapshot: snapshot || '(empty snapshot)' };
  } catch (err: unknown) {
    return { ok: false, error: `Snapshot failed: ${(err as Error).message}` };
  }
}

async function performClick(target: string): Promise<any> {
  if (!browser || !page) return { ok: false, error: 'No active browser session.' };
  if (!target) return { ok: false, error: 'No target provided' };
  try {
    const clicked = await page.evaluate((sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (el) { el.click(); return true; }
      const byText = Array.from(document.querySelectorAll('button, a, [role="button"], [tabindex]'))
        .find(e => e.textContent?.trim().toLowerCase() === sel.toLowerCase()) as HTMLElement | null;
      if (byText) { byText.click(); return true; }
      const byPartial = Array.from(document.querySelectorAll('button, a, [role="button"], [tabindex]'))
        .find(e => e.textContent?.trim().toLowerCase().includes(sel.toLowerCase())) as HTMLElement | null;
      if (byPartial) { byPartial.click(); return true; }
      return false;
    }, target);
    if (clicked) {
      await page.waitForTimeout(500);
      currentUrl = page.url();
      currentTitle = await page.title();
      return { ok: true, message: `Clicked "${target}"` };
    }
    return { ok: false, error: `Could not find element: "${target}"` };
  } catch (err: unknown) {
    return { ok: false, error: `Click failed: ${(err as Error).message}` };
  }
}

async function performType(target: string, value: string): Promise<any> {
  if (!browser || !page) return { ok: false, error: 'No active browser session.' };
  if (!target || value === undefined) return { ok: false, error: 'Target and value required' };
  try {
    const filled = await page.evaluate((sel: string, val: string) => {
      const el = document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement | null;
      if (el) { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); return true; }
      const byPlaceholder = Array.from(document.querySelectorAll('input, textarea'))
        .find(e => (e.getAttribute('placeholder') || '').toLowerCase().includes(sel.toLowerCase())) as HTMLInputElement | HTMLTextAreaElement | null;
      if (byPlaceholder) { byPlaceholder.value = val; byPlaceholder.dispatchEvent(new Event('input', { bubbles: true })); return true; }
      return false;
    }, target, value);
    if (filled) return { ok: true, message: `Typed "${value}" into "${target}"` };
    return { ok: false, error: `Could not find input: "${target}"` };
  } catch (err: unknown) {
    return { ok: false, error: `Type failed: ${(err as Error).message}` };
  }
}

async function performClose(): Promise<any> {
  try {
    if (browser) await browser.close();
  } catch {}
  browser = null;
  page = null;
  currentUrl = '';
  currentTitle = '';
  return { ok: true, message: 'Browser closed.' };
}

async function handleCommand(cmd: any): Promise<any> {
  switch (cmd.action) {
    case 'open': return performOpen(cmd.url, cmd.headless, cmd.timeout);
    case 'status': return performStatus();
    case 'text': return performText();
    case 'screenshot': return performScreenshot(cmd.path, cmd.fullPage);
    case 'snapshot': return performSnapshot();
    case 'click': return performClick(cmd.target);
    case 'type': return performType(cmd.target, cmd.value);
    case 'close': return performClose();
    default: return { ok: false, error: `Unknown action: ${cmd.action}` };
  }
}

// ── Server ─────────────────────────────────────────────

function startServer(port: number): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = http.createServer(async (req, res) => {
      res.setHeader('Connection', 'close');
      if (req.method === 'GET' && req.url === '/api/ping') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (req.method === 'POST' && req.url === '/api/command') {
        let body = '';
        req.on('data', (chunk: string) => body += chunk);
        req.on('end', async () => {
          try {
            const cmd = JSON.parse(body);
            const result = await handleCommand(cmd);
            const json = JSON.stringify(result);
            res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) });
            res.end(json);
          } catch (err: unknown) {
            const json = JSON.stringify({ ok: false, error: (err as Error).message });
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(json);
          }
        });
        return;
      }

      res.writeHead(404);
      res.end();
    });

    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      resolvePort(actualPort);
    });
    server.on('error', reject);
  });
}

// ── Client ─────────────────────────────────────────────

export async function daemonCommand(port: number, cmd: any, timeoutMs = 30000): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd),
      signal: controller.signal,
    });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export { startServer, importPlaywright };

// ── Entry point for spawned daemon process ────────────

const isDaemonEntry = process.argv[1]?.replace(/\\/g, '/').endsWith('browser-daemon.js');

if (isDaemonEntry) {
  const daemonPort = parseInt(process.env.HYSA_BROWSER_DAEMON_PORT || '0', 10);
  startServer(daemonPort).then(port => {
    process.stdout.write(JSON.stringify({ pid: process.pid, port }) + '\n');
  });
}
