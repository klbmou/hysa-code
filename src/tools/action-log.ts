import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { ToolRiskLevel } from './types.js';

const LOG_DIR = join(homedir(), '.hysa', 'action-logs');
const LOG_FILE = join(LOG_DIR, 'tool-executions.jsonl');

function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

export interface ActionLogEntry {
  timestamp: string;
  toolName: string;
  riskLevel: ToolRiskLevel;
  approved: boolean;
  dryRun: boolean;
  source: string;
  cwd: string;
  inputSummary: string;
  resultSummary: string;
  error?: string;
  sessionId?: string;
}

const SECRET_PATTERNS: RegExp[] = [
  /sk-[a-zA-Z0-9]{20,}/g,
  /[Aa][Pp][Ii]_[Kk][Ee][Yy]=["']?[^"'\s]{8,}/g,
  /ghp_[a-zA-Z0-9]{36,}/g,
  /gho_[a-zA-Z0-9]{36,}/g,
  /ghu_[a-zA-Z0-9]{36,}/g,
  /xox[bpras]-[a-zA-Z0-9-]{24,}/g,
  /-----BEGIN (RSA|OPENSSH|EC) PRIVATE KEY-----/g,
  /token["']?\s*[:=]\s*["'][^"']{8,}["']/gi,
  /password["']?\s*[:=]\s*["'][^"']{8,}["']/gi,
];

function redactSecrets(text: string): string {
  let clean = text;
  for (const pattern of SECRET_PATTERNS) {
    clean = clean.replace(pattern, '[REDACTED]');
  }
  return clean;
}

export function appendActionLog(entry: ActionLogEntry): void {
  try {
    ensureLogDir();
    const safe: ActionLogEntry = {
      ...entry,
      inputSummary: redactSecrets(entry.inputSummary.slice(0, 500)),
      resultSummary: redactSecrets(entry.resultSummary.slice(0, 500)),
      cwd: entry.cwd.slice(0, 200),
    };
    if (safe.error) {
      safe.error = redactSecrets(safe.error.slice(0, 500));
    }
    const line = JSON.stringify(safe) + '\n';
    appendFileSync(LOG_FILE, line, 'utf-8');
  } catch {
    // Non-fatal: if logging fails, tool execution continues
  }
}

export function getActionLogPath(): string {
  return LOG_FILE;
}

export async function getRecentActionLogs(n: number = 20): Promise<ActionLogEntry[]> {
  try {
    if (!existsSync(LOG_FILE)) return [];
    const fs = await import('node:fs/promises');
    const content = await fs.readFile(LOG_FILE, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const entries: ActionLogEntry[] = [];
    for (const line of lines.slice(-n)) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // skip malformed lines
      }
    }
    return entries;
  } catch {
    return [];
  }
}
