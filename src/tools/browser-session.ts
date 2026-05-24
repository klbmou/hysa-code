import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import http from 'node:http';

export type BrowserSessionMeta = {
  pid: number;
  port: number;
  startedAt: string;
  url?: string;
  title?: string;
  headless: boolean;
};

const SESSION_DIR = join(homedir(), '.hysa', 'browser');
const SESSION_PATH = join(SESSION_DIR, 'session.json');

function ensureDir(): void {
  if (!existsSync(SESSION_DIR)) mkdirSync(SESSION_DIR, { recursive: true });
}

export function loadSession(): BrowserSessionMeta | null {
  try {
    if (!existsSync(SESSION_PATH)) return null;
    const raw = readFileSync(SESSION_PATH, 'utf-8');
    return JSON.parse(raw) as BrowserSessionMeta;
  } catch {
    return null;
  }
}

export function saveSession(meta: BrowserSessionMeta): void {
  ensureDir();
  writeFileSync(SESSION_PATH, JSON.stringify(meta, null, 2), 'utf-8');
}

export function clearSession(): void {
  try {
    if (existsSync(SESSION_PATH)) unlinkSync(SESSION_PATH);
  } catch {
    // ignore
  }
}

export async function isDaemonAlive(port: number, timeoutMs = 2000): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/ping`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function getValidSession(): Promise<BrowserSessionMeta | null> {
  const session = loadSession();
  if (!session) return null;
  if (!isProcessAlive(session.pid)) {
    clearSession();
    return null;
  }
  if (!(await isDaemonAlive(session.port))) {
    clearSession();
    return null;
  }
  return session;
}
