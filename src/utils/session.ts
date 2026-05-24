import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const SESSION_DIR = join(homedir(), '.hysa');
const SESSION_PATH = join(SESSION_DIR, 'session.json');

export interface SessionEdit {
  file: string;
  timestamp: string;
  summary: string;
}

export interface ProviderHealthEntry {
  provider: string;
  model: string;
  reason: string;
  category: string;
  timestamp: number;
  failedCount: number;
  lastSuccessTime?: number;
  lastFailureTime?: number;
  failureReason?: string;
  rateLimited?: boolean;
  timedOut?: boolean;
  cooldownUntil?: number;
  cooldownReason?: string;
  averageResponseTimeMs?: number;
  requestCount?: number;
  totalResponseTimeMs?: number;
}

export interface ProviderCooldownEntry {
  provider: string;
  reason: string;
  category: string;
  timestamp: number;
  cooldownUntil: number;
  failedCount?: number;
}

export interface LastChatErrorEntry {
  provider: string;
  model: string;
  category: string;
  reason: string;
  timestamp: number;
}

export interface FallbackEventEntry {
  provider: string;
  model: string;
  reason: string;
  timestamp: number;
}

export interface ChatRuntimeState {
  lastError?: LastChatErrorEntry | null;
  lastFallbackUsed?: string | null;
  lastSuccessfulProvider?: string | null;
  lastSuccessfulModel?: string | null;
  providerCooldowns?: ProviderCooldownEntry[];
  fallbackEvents?: FallbackEventEntry[];
  updatedAt?: number;
}

export interface SessionUsage {
  lastRequestDuration?: number;
  lastRequestTimestamp?: number;
  lastRequestTokens?: number;
  lastPromptMode?: string;
  lastError?: string;
  lastProvider?: string;
  lastModel?: string;
  totalRequests: number;
  totalErrors: number;
}

export interface SessionData {
  recentTasks: string[];
  recentFiles: string[];
  recentEdits: SessionEdit[];
  lastDirectory: string;
  sessionCount: number;
  yolo?: boolean;
  providerHealth?: ProviderHealthEntry[];
  chatState?: ChatRuntimeState;
  usage?: SessionUsage;
}

const MAX_HISTORY = 20;

function ensureDir(): void {
  if (!existsSync(SESSION_DIR)) {
    mkdirSync(SESSION_DIR, { recursive: true });
  }
}

export function loadSession(): SessionData {
  try {
    if (!existsSync(SESSION_PATH)) {
      return { recentTasks: [], recentFiles: [], recentEdits: [], lastDirectory: '', sessionCount: 0 };
    }
    const data = readFileSync(SESSION_PATH, 'utf-8');
    return JSON.parse(data) as SessionData;
  } catch {
    return { recentTasks: [], recentFiles: [], recentEdits: [], lastDirectory: '', sessionCount: 0 };
  }
}

export function saveSession(session: SessionData): void {
  ensureDir();
  writeFileSync(SESSION_PATH, JSON.stringify(session, null, 2), 'utf-8');
}

export function addTask(task: string): void {
  const session = loadSession();
  session.recentTasks = session.recentTasks.filter(t => t !== task);
  session.recentTasks.unshift(task);
  if (session.recentTasks.length > MAX_HISTORY) {
    session.recentTasks = session.recentTasks.slice(0, MAX_HISTORY);
  }
  saveSession(session);
}

export function addRecentFile(file: string): void {
  const session = loadSession();
  session.recentFiles = session.recentFiles.filter(f => f !== file);
  session.recentFiles.unshift(file);
  if (session.recentFiles.length > MAX_HISTORY) {
    session.recentFiles = session.recentFiles.slice(0, MAX_HISTORY);
  }
  saveSession(session);
}

export function addEdit(edit: SessionEdit): void {
  const session = loadSession();
  session.recentEdits.unshift(edit);
  if (session.recentEdits.length > MAX_HISTORY) {
    session.recentEdits = session.recentEdits.slice(0, MAX_HISTORY);
  }
  saveSession(session);
}

export function incrementSessionCount(): number {
  const session = loadSession();
  session.sessionCount++;
  session.lastDirectory = process.cwd();
  saveSession(session);
  return session.sessionCount;
}

export function getYolo(): boolean {
  return loadSession().yolo ?? false;
}

export function setYolo(enabled: boolean): void {
  const session = loadSession();
  session.yolo = enabled;
  saveSession(session);
}

export function getProviderHealth(): ProviderHealthEntry[] {
  return loadSession().providerHealth ?? [];
}

export function saveProviderHealth(entries: ProviderHealthEntry[]): void {
  const session = loadSession();
  session.providerHealth = entries;
  saveSession(session);
}

export function clearProviderHealth(): void {
  const session = loadSession();
  session.providerHealth = [];
  session.chatState = undefined;
  saveSession(session);
}

export function getLastProviderError(): string | null {
  const entries = getProviderHealth();
  if (entries.length === 0) return null;
  const last = entries[entries.length - 1];
  return `${last.provider}/${last.model}: ${last.reason}`;
}

export function getChatRuntimeState(): ChatRuntimeState {
  return loadSession().chatState ?? {};
}

export function saveChatRuntimeState(state: ChatRuntimeState): void {
  const session = loadSession();
  session.chatState = { ...state, updatedAt: Date.now() };
  saveSession(session);
}

export function clearChatRuntimeState(): void {
  const session = loadSession();
  session.chatState = undefined;
  saveSession(session);
}

// ── Usage Tracking ──────────────────────────────────

export function saveUsage(data: SessionUsage): void {
  const session = loadSession();
  session.usage = data;
  saveSession(session);
}

export function getUsage(): SessionUsage {
  return loadSession().usage ?? { totalRequests: 0, totalErrors: 0 };
}

export function recordRequest(durationMs: number, tokens?: number): void {
  const usage = getUsage();
  usage.totalRequests++;
  usage.lastRequestDuration = durationMs;
  usage.lastRequestTimestamp = Date.now();
  if (tokens !== undefined) usage.lastRequestTokens = tokens;
  saveUsage(usage);
}

export function recordPromptMode(mode: string): void {
  const usage = getUsage();
  usage.lastPromptMode = mode;
  saveUsage(usage);
}

export function recordError(error: string, provider: string, model: string): void {
  const usage = getUsage();
  usage.totalErrors++;
  usage.lastError = error;
  usage.lastProvider = provider;
  usage.lastModel = model;
  saveUsage(usage);
}
