import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, normalize, isAbsolute } from 'node:path';

export type BrowserSessionInfo = {
  active: boolean;
  url?: string;
  title?: string;
  browser?: string;
};

type BrowserPage = {
  url: string;
  title: string;
};

let browserInstance: any = null;
let pageInstance: any = null;
let currentPage: BrowserPage | null = null;

const SCREENSHOT_DIR = process.env.HYSA_BROWSER_SCREENSHOT_DIR || '.hysa/screenshots';
const HEADLESS_DEFAULT = process.env.HYSA_BROWSER_HEADLESS !== 'false';
const TIMEOUT_MS = parseInt(process.env.HYSA_BROWSER_TIMEOUT_MS || '15000', 10);

function ensureScreenshotDir(): void {
  if (!existsSync(SCREENSHOT_DIR)) {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
}

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

async function getPlaywright(): Promise<any> {
  try {
    return await import('playwright');
  } catch {
    return null;
  }
}

async function ensureBrowser(): Promise<boolean> {
  if (browserInstance && pageInstance) return true;
  return false;
}

export async function browserOpen(url: string, options?: {
  headless?: boolean;
  timeoutMs?: number;
}): Promise<{
  ok: boolean;
  url?: string;
  title?: string;
  message: string;
}> {
  if (!isAllowedUrl(url)) {
    return { ok: false, message: `Unsupported URL scheme: ${url}. Only http:// and https:// are allowed.` };
  }

  const pw = await getPlaywright();
  if (!pw) {
    return { ok: false, message: 'Playwright browser is not installed. Run: npx playwright install chromium' };
  }

  try {
    if (browserInstance) {
      await browserInstance.close();
      browserInstance = null;
      pageInstance = null;
      currentPage = null;
    }

    const headless = options?.headless ?? HEADLESS_DEFAULT;
    const timeout = options?.timeoutMs ?? TIMEOUT_MS;

    browserInstance = await pw.chromium.launch({ headless });
    const context = await browserInstance.newContext();
    pageInstance = await context.newPage();

    await pageInstance.goto(url, { waitUntil: 'networkidle', timeout });

    const title = await pageInstance.title();
    currentPage = { url, title };

    return {
      ok: true,
      url,
      title,
      message: `Opened ${url} (title: "${title}")`,
    };
  } catch (err: unknown) {
    const msg = (err as Error).message || 'Unknown error';
    if (browserInstance) {
      try { await browserInstance.close(); } catch { }
      browserInstance = null;
      pageInstance = null;
      currentPage = null;
    }
    return { ok: false, message: `Failed to open browser: ${msg}` };
  }
}

export async function browserScreenshot(options?: {
  path?: string;
  fullPage?: boolean;
}): Promise<{
  ok: boolean;
  path?: string;
  message: string;
}> {
  if (options?.path) {
    if (!isScreenshotPathSafe(options.path)) {
      return { ok: false, message: `Screenshot path must be inside ${SCREENSHOT_DIR}/. Got: ${options.path}` };
    }
  }

  if (!(await ensureBrowser())) {
    return { ok: false, message: 'No active browser session. Open a URL first with browserOpen().' };
  }

  try {
    ensureScreenshotDir();

    let screenshotPath: string;
    if (options?.path) {
      screenshotPath = resolve(process.cwd(), options.path);
    } else {
      const ts = Date.now();
      screenshotPath = resolve(process.cwd(), SCREENSHOT_DIR, `screenshot-${ts}.png`);
    }

    await pageInstance.screenshot({ path: screenshotPath, fullPage: options?.fullPage ?? false });
    return {
      ok: true,
      path: screenshotPath,
      message: `Screenshot saved to ${screenshotPath}`,
    };
  } catch (err: unknown) {
    return { ok: false, message: `Screenshot failed: ${(err as Error).message}` };
  }
}

export async function browserText(): Promise<{
  ok: boolean;
  text: string;
  message: string;
}> {
  if (!(await ensureBrowser())) {
    return { ok: false, text: '', message: 'No active browser session. Open a URL first with browserOpen().' };
  }

  try {
    const text = await pageInstance.evaluate(() => document.body.innerText);
    const clean = text.trim();
    return {
      ok: true,
      text: clean,
      message: clean ? `Got ${clean.length} chars of visible text` : 'Page has no visible text',
    };
  } catch (err: unknown) {
    return { ok: false, text: '', message: `Failed to get page text: ${(err as Error).message}` };
  }
}

export async function browserSnapshot(): Promise<{
  ok: boolean;
  snapshot: string;
  message: string;
}> {
  if (!(await ensureBrowser())) {
    return { ok: false, snapshot: '', message: 'No active browser session. Open a URL first with browserOpen().' };
  }

  try {
    const snapshot = await pageInstance.evaluate(() => {
      const root = document.documentElement;
      if (!root) return '';
      const ignoreTags = new Set(['script', 'style', 'link', 'meta', 'noscript']);
      function getAria(el: Element, depth: number): string {
        if (ignoreTags.has(el.tagName.toLowerCase())) return '';
        const role = el.getAttribute('role') || '';
        const name = el.getAttribute('aria-label') || '';
        const tag = el.tagName.toLowerCase();
        const text = (el as HTMLElement).innerText?.trim().slice(0, 80) || '';
        const isInteractive = ['a', 'button', 'input', 'textarea', 'select', 'details'].includes(tag) || role;
        if (!isInteractive && !text && !name) return '';
        const indent = '  '.repeat(depth);
        const parts: string[] = [`${indent}<${tag}`];
        if (role) parts.push(` role="${role}"`);
        if (name) parts.push(` aria-label="${name}"`);
        const id = el.id;
        if (id) parts.push(` id="${id}"`);
        const cls = el.className && typeof el.className === 'string' ? el.className.trim().slice(0, 40) : '';
        if (cls) parts.push(` class="${cls}"`);
        if (text) parts.push(` > "${text.slice(0, 60)}"`);
        parts.push('>');
        return parts.join('');
      }
      const lines: string[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let node: Element | null;
      while ((node = walker.nextNode() as Element | null)) {
        const line = getAria(node, 0);
        if (line) lines.push(line);
      }
      return lines.join('\n');
    });
    return {
      ok: true,
      snapshot: snapshot || '(empty snapshot)',
      message: snapshot ? `Got ${snapshot.split('\n').length} interactive elements` : 'No interactive elements found',
    };
  } catch (err: unknown) {
    return { ok: false, snapshot: '', message: `Failed to get snapshot: ${(err as Error).message}` };
  }
}

export async function browserClick(target: string): Promise<{
  ok: boolean;
  message: string;
}> {
  if (!(await ensureBrowser())) {
    return { ok: false, message: 'No active browser session. Open a URL first with browserOpen().' };
  }

  try {
    const clicked = await pageInstance.evaluate((sel: string) => {
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
      await pageInstance.waitForTimeout(500);
      const newUrl = pageInstance.url();
      const newTitle = await pageInstance.title();
      currentPage = { url: newUrl, title: newTitle };
      return { ok: true, message: `Clicked "${target}"` };
    }
    return { ok: false, message: `Could not find element: "${target}"` };
  } catch (err: unknown) {
    return { ok: false, message: `Click failed: ${(err as Error).message}` };
  }
}

export async function browserType(target: string, value: string): Promise<{
  ok: boolean;
  message: string;
}> {
  if (!(await ensureBrowser())) {
    return { ok: false, message: 'No active browser session. Open a URL first with browserOpen().' };
  }

  try {
    const filled = await pageInstance.evaluate((sel: string, val: string) => {
      const el = document.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement | null;
      if (el) { el.value = val; el.dispatchEvent(new Event('input', { bubbles: true })); return true; }
      const byPlaceholder = Array.from(document.querySelectorAll('input, textarea'))
        .find(e => (e.getAttribute('placeholder') || '').toLowerCase().includes(sel.toLowerCase())) as HTMLInputElement | HTMLTextAreaElement | null;
      if (byPlaceholder) { byPlaceholder.value = val; byPlaceholder.dispatchEvent(new Event('input', { bubbles: true })); return true; }
      return false;
    }, target, value);

    if (filled) {
      return { ok: true, message: `Typed "${value}" into "${target}"` };
    }
    return { ok: false, message: `Could not find input: "${target}"` };
  } catch (err: unknown) {
    return { ok: false, message: `Type failed: ${(err as Error).message}` };
  }
}

export async function browserClose(): Promise<{
  ok: boolean;
  message: string;
}> {
  if (!browserInstance) {
    return { ok: true, message: 'No active browser session to close.' };
  }

  try {
    await browserInstance.close();
  } catch (err: unknown) {
    return { ok: false, message: `Error closing browser: ${(err as Error).message}` };
  } finally {
    browserInstance = null;
    pageInstance = null;
    currentPage = null;
  }

  return { ok: true, message: 'Browser closed.' };
}

export async function getBrowserStatus(): Promise<BrowserSessionInfo> {
  if (!browserInstance || !pageInstance) {
    return { active: false };
  }

  try {
    const url = pageInstance.url();
    const title = await pageInstance.title();
    return {
      active: true,
      url,
      title,
      browser: 'chromium',
    };
  } catch {
    return { active: false };
  }
}

export async function checkPlaywrightInstalled(): Promise<boolean> {
  const pw = await getPlaywright();
  return pw !== null;
}

export async function checkChromiumInstalled(): Promise<boolean | 'unknown'> {
  try {
    const pw = await getPlaywright();
    if (!pw) return 'unknown';
    const { chromium } = pw;
    const executablePath = chromium.executablePath();
    return existsSync(executablePath);
  } catch {
    return 'unknown';
  }
}

export function getBrowserConfig(): {
  headless: boolean;
  screenshotDir: string;
  timeoutMs: number;
} {
  return {
    headless: HEADLESS_DEFAULT,
    screenshotDir: SCREENSHOT_DIR,
    timeoutMs: TIMEOUT_MS,
  };
}
