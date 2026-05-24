import { existsSync, mkdirSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
let browserInstance = null;
let pageInstance = null;
let currentPage = null;
const SCREENSHOT_DIR = process.env.HYSA_BROWSER_SCREENSHOT_DIR || '.hysa/screenshots';
const HEADLESS_DEFAULT = process.env.HYSA_BROWSER_HEADLESS !== 'false';
const TIMEOUT_MS = parseInt(process.env.HYSA_BROWSER_TIMEOUT_MS || '15000', 10);
function ensureScreenshotDir() {
    if (!existsSync(SCREENSHOT_DIR)) {
        mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }
}
function sanitizeFilename(name) {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
}
function isAllowedUrl(url) {
    try {
        const parsed = new URL(url);
        if (parsed.protocol === 'file:')
            return false;
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
            return false;
        return true;
    }
    catch {
        return false;
    }
}
function isScreenshotPathSafe(targetPath) {
    if (!isAbsolute(targetPath)) {
        const resolved = resolve(process.cwd(), targetPath);
        return resolved.startsWith(resolve(process.cwd(), SCREENSHOT_DIR));
    }
    return false;
}
async function getPlaywright() {
    try {
        return await import('playwright');
    }
    catch {
        return null;
    }
}
async function ensureBrowser() {
    if (browserInstance && pageInstance)
        return true;
    return false;
}
export async function browserOpen(url, options) {
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
    }
    catch (err) {
        const msg = err.message || 'Unknown error';
        if (browserInstance) {
            try {
                await browserInstance.close();
            }
            catch { }
            browserInstance = null;
            pageInstance = null;
            currentPage = null;
        }
        return { ok: false, message: `Failed to open browser: ${msg}` };
    }
}
export async function browserScreenshot(options) {
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
        let screenshotPath;
        if (options?.path) {
            screenshotPath = resolve(process.cwd(), options.path);
        }
        else {
            const ts = Date.now();
            screenshotPath = resolve(process.cwd(), SCREENSHOT_DIR, `screenshot-${ts}.png`);
        }
        await pageInstance.screenshot({ path: screenshotPath, fullPage: options?.fullPage ?? false });
        return {
            ok: true,
            path: screenshotPath,
            message: `Screenshot saved to ${screenshotPath}`,
        };
    }
    catch (err) {
        return { ok: false, message: `Screenshot failed: ${err.message}` };
    }
}
export async function browserText() {
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
    }
    catch (err) {
        return { ok: false, text: '', message: `Failed to get page text: ${err.message}` };
    }
}
export async function browserSnapshot() {
    if (!(await ensureBrowser())) {
        return { ok: false, snapshot: '', message: 'No active browser session. Open a URL first with browserOpen().' };
    }
    try {
        const snapshot = await pageInstance.evaluate(() => {
            const root = document.documentElement;
            if (!root)
                return '';
            const ignoreTags = new Set(['script', 'style', 'link', 'meta', 'noscript']);
            function getAria(el, depth) {
                if (ignoreTags.has(el.tagName.toLowerCase()))
                    return '';
                const role = el.getAttribute('role') || '';
                const name = el.getAttribute('aria-label') || '';
                const tag = el.tagName.toLowerCase();
                const text = el.innerText?.trim().slice(0, 80) || '';
                const isInteractive = ['a', 'button', 'input', 'textarea', 'select', 'details'].includes(tag) || role;
                if (!isInteractive && !text && !name)
                    return '';
                const indent = '  '.repeat(depth);
                const parts = [`${indent}<${tag}`];
                if (role)
                    parts.push(` role="${role}"`);
                if (name)
                    parts.push(` aria-label="${name}"`);
                const id = el.id;
                if (id)
                    parts.push(` id="${id}"`);
                const cls = el.className && typeof el.className === 'string' ? el.className.trim().slice(0, 40) : '';
                if (cls)
                    parts.push(` class="${cls}"`);
                if (text)
                    parts.push(` > "${text.slice(0, 60)}"`);
                parts.push('>');
                return parts.join('');
            }
            const lines = [];
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
            let node;
            while ((node = walker.nextNode())) {
                const line = getAria(node, 0);
                if (line)
                    lines.push(line);
            }
            return lines.join('\n');
        });
        return {
            ok: true,
            snapshot: snapshot || '(empty snapshot)',
            message: snapshot ? `Got ${snapshot.split('\n').length} interactive elements` : 'No interactive elements found',
        };
    }
    catch (err) {
        return { ok: false, snapshot: '', message: `Failed to get snapshot: ${err.message}` };
    }
}
export async function browserClick(target) {
    if (!(await ensureBrowser())) {
        return { ok: false, message: 'No active browser session. Open a URL first with browserOpen().' };
    }
    try {
        const clicked = await pageInstance.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (el) {
                el.click();
                return true;
            }
            const byText = Array.from(document.querySelectorAll('button, a, [role="button"], [tabindex]'))
                .find(e => e.textContent?.trim().toLowerCase() === sel.toLowerCase());
            if (byText) {
                byText.click();
                return true;
            }
            const byPartial = Array.from(document.querySelectorAll('button, a, [role="button"], [tabindex]'))
                .find(e => e.textContent?.trim().toLowerCase().includes(sel.toLowerCase()));
            if (byPartial) {
                byPartial.click();
                return true;
            }
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
    }
    catch (err) {
        return { ok: false, message: `Click failed: ${err.message}` };
    }
}
export async function browserType(target, value) {
    if (!(await ensureBrowser())) {
        return { ok: false, message: 'No active browser session. Open a URL first with browserOpen().' };
    }
    try {
        const filled = await pageInstance.evaluate((sel, val) => {
            const el = document.querySelector(sel);
            if (el) {
                el.value = val;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                return true;
            }
            const byPlaceholder = Array.from(document.querySelectorAll('input, textarea'))
                .find(e => (e.getAttribute('placeholder') || '').toLowerCase().includes(sel.toLowerCase()));
            if (byPlaceholder) {
                byPlaceholder.value = val;
                byPlaceholder.dispatchEvent(new Event('input', { bubbles: true }));
                return true;
            }
            return false;
        }, target, value);
        if (filled) {
            return { ok: true, message: `Typed "${value}" into "${target}"` };
        }
        return { ok: false, message: `Could not find input: "${target}"` };
    }
    catch (err) {
        return { ok: false, message: `Type failed: ${err.message}` };
    }
}
export async function browserClose() {
    if (!browserInstance) {
        return { ok: true, message: 'No active browser session to close.' };
    }
    try {
        await browserInstance.close();
    }
    catch (err) {
        return { ok: false, message: `Error closing browser: ${err.message}` };
    }
    finally {
        browserInstance = null;
        pageInstance = null;
        currentPage = null;
    }
    return { ok: true, message: 'Browser closed.' };
}
export async function getBrowserStatus() {
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
    }
    catch {
        return { active: false };
    }
}
export async function checkPlaywrightInstalled() {
    const pw = await getPlaywright();
    return pw !== null;
}
export async function checkChromiumInstalled() {
    try {
        const pw = await getPlaywright();
        if (!pw)
            return 'unknown';
        const { chromium } = pw;
        const executablePath = chromium.executablePath();
        return existsSync(executablePath);
    }
    catch {
        return 'unknown';
    }
}
export function getBrowserConfig() {
    return {
        headless: HEADLESS_DEFAULT,
        screenshotDir: SCREENSHOT_DIR,
        timeoutMs: TIMEOUT_MS,
    };
}
// ── Daemon-aware CLI functions ────────────────────────
import { getValidSession, saveSession, clearSession, isDaemonAlive, loadSession } from './browser-session.js';
import { spawn } from 'node:child_process';
import { resolve as pathResolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
function getDaemonScriptPath() {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    return pathResolve(__dirname, 'browser-daemon.js');
}
async function ensureDaemon() {
    const existing = await getValidSession();
    if (existing)
        return { port: existing.port, pid: existing.pid };
    const scriptPath = getDaemonScriptPath();
    const env = {
        ...process.env,
        HYSA_BROWSER_DAEMON_PORT: '0',
    };
    return new Promise((resolvePromise, reject) => {
        const child = spawn(process.execPath, [scriptPath], {
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: true,
        });
        let output = '';
        child.stdout.on('data', (data) => {
            output += data.toString();
            try {
                const info = JSON.parse(output.trim());
                if (info.pid && info.port) {
                    saveSession({
                        pid: info.pid,
                        port: info.port,
                        startedAt: new Date().toISOString(),
                        headless: HEADLESS_DEFAULT,
                    });
                    child.unref();
                    resolvePromise({ port: info.port, pid: info.pid });
                }
            }
            catch {
                // wait for more data
            }
        });
        child.on('error', (err) => {
            reject(new Error(`Failed to start browser daemon: ${err.message}`));
        });
        child.on('exit', (code) => {
            if (!output.includes('"pid"')) {
                reject(new Error(`Browser daemon exited with code ${code} before starting`));
            }
        });
        const timer = setTimeout(() => {
            if (!output.includes('"pid"')) {
                child.kill();
                reject(new Error('Browser daemon failed to start within 10s'));
            }
        }, 10000);
        child.on('exit', () => clearTimeout(timer));
    });
}
async function daemonCall(action, params = {}, timeoutMs = 30000) {
    const session = await getValidSession();
    if (!session) {
        if (action === 'open') {
            await ensureDaemon();
            return daemonCall(action, params, timeoutMs);
        }
        return { ok: false, error: 'No active browser session. Run: hysa browser open <url>' };
    }
    const { daemonCommand } = await import('./browser-daemon.js');
    const result = await daemonCommand(session.port, { action, ...params }, timeoutMs);
    if (action === 'open' && result.ok) {
        const s = loadSession();
        if (s) {
            s.url = result.url;
            s.title = result.title;
            saveSession(s);
        }
    }
    if (action === 'close' && result.ok) {
        clearSession();
    }
    return result;
}
export async function cliBrowserOpen(url, options) {
    try {
        const result = await daemonCall('open', { url, headless: options?.headless, timeout: options?.timeoutMs });
        if (result.ok) {
            return { ok: true, url: result.url, title: result.title, message: result.message };
        }
        return { ok: false, message: result.error || 'Failed to open URL' };
    }
    catch (err) {
        return { ok: false, message: `Failed to open browser: ${err.message}` };
    }
}
export async function cliBrowserStatus() {
    const session = loadSession();
    if (session) {
        const alive = await isDaemonAlive(session.port);
        if (alive) {
            try {
                const result = await daemonCall('status');
                if (result.ok && result.active) {
                    return { active: true, url: result.url, title: result.title, browser: 'chromium', daemon: true, pid: session.pid, port: session.port };
                }
            }
            catch { }
            return { active: false, daemon: true, pid: session.pid, port: session.port };
        }
        clearSession();
    }
    return { active: false };
}
export async function cliBrowserText() {
    try {
        const result = await daemonCall('text', {}, 15000);
        if (result.ok)
            return { ok: true, text: result.text || '', message: result.message || '' };
        return { ok: false, text: '', message: result.error || 'Failed to get page text' };
    }
    catch (err) {
        return { ok: false, text: '', message: `Failed to get page text: ${err.message}` };
    }
}
export async function cliBrowserScreenshot(options) {
    if (options?.path && !isScreenshotPathSafe(options.path)) {
        return { ok: false, message: `Screenshot path must be inside ${SCREENSHOT_DIR}/. Got: ${options.path}` };
    }
    try {
        const result = await daemonCall('screenshot', { path: options?.path, fullPage: options?.fullPage ?? false });
        if (result.ok)
            return { ok: true, path: result.path, message: result.message };
        return { ok: false, message: result.error || 'Screenshot failed' };
    }
    catch (err) {
        return { ok: false, message: `Screenshot failed: ${err.message}` };
    }
}
export async function cliBrowserSnapshot() {
    try {
        const result = await daemonCall('snapshot', {}, 15000);
        if (result.ok)
            return { ok: true, snapshot: result.snapshot || '', message: `Got ${(result.snapshot || '').split('\n').length} elements` };
        return { ok: false, snapshot: '', message: result.error || 'Snapshot failed' };
    }
    catch (err) {
        return { ok: false, snapshot: '', message: `Snapshot failed: ${err.message}` };
    }
}
export async function cliBrowserClick(target) {
    try {
        const result = await daemonCall('click', { target }, 15000);
        if (result.ok)
            return { ok: true, message: result.message || `Clicked "${target}"` };
        return { ok: false, message: result.error || 'Click failed' };
    }
    catch (err) {
        return { ok: false, message: `Click failed: ${err.message}` };
    }
}
export async function cliBrowserType(target, value) {
    try {
        const result = await daemonCall('type', { target, value }, 15000);
        if (result.ok)
            return { ok: true, message: result.message || `Typed into "${target}"` };
        return { ok: false, message: result.error || 'Type failed' };
    }
    catch (err) {
        return { ok: false, message: `Type failed: ${err.message}` };
    }
}
export async function cliBrowserClose() {
    try {
        const session = loadSession();
        if (!session)
            return { ok: true, message: 'No active browser session to close.' };
        const result = await daemonCall('close');
        clearSession();
        if (result.ok)
            return { ok: true, message: 'Browser closed.' };
        return { ok: true, message: 'Browser session cleaned up.' };
    }
    catch {
        clearSession();
        return { ok: true, message: 'Browser session cleaned up.' };
    }
}
export function cliBrowserCleanStale() {
    const session = loadSession();
    if (session) {
        clearSession();
    }
}
export function getDaemonConfig() {
    return { enabled: process.env.HYSA_BROWSER_DAEMON_ENABLED !== 'false' };
}
//# sourceMappingURL=browser.js.map