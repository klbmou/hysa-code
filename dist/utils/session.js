import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
const SESSION_DIR = join(homedir(), '.hysa');
const SESSION_PATH = join(SESSION_DIR, 'session.json');
const MAX_HISTORY = 20;
function ensureDir() {
    if (!existsSync(SESSION_DIR)) {
        mkdirSync(SESSION_DIR, { recursive: true });
    }
}
export function loadSession() {
    try {
        if (!existsSync(SESSION_PATH)) {
            return { recentTasks: [], recentFiles: [], recentEdits: [], lastDirectory: '', sessionCount: 0 };
        }
        const data = readFileSync(SESSION_PATH, 'utf-8');
        return JSON.parse(data);
    }
    catch {
        return { recentTasks: [], recentFiles: [], recentEdits: [], lastDirectory: '', sessionCount: 0 };
    }
}
export function saveSession(session) {
    ensureDir();
    writeFileSync(SESSION_PATH, JSON.stringify(session, null, 2), 'utf-8');
}
export function addTask(task) {
    const session = loadSession();
    session.recentTasks = session.recentTasks.filter(t => t !== task);
    session.recentTasks.unshift(task);
    if (session.recentTasks.length > MAX_HISTORY) {
        session.recentTasks = session.recentTasks.slice(0, MAX_HISTORY);
    }
    saveSession(session);
}
export function addRecentFile(file) {
    const session = loadSession();
    session.recentFiles = session.recentFiles.filter(f => f !== file);
    session.recentFiles.unshift(file);
    if (session.recentFiles.length > MAX_HISTORY) {
        session.recentFiles = session.recentFiles.slice(0, MAX_HISTORY);
    }
    saveSession(session);
}
export function addEdit(edit) {
    const session = loadSession();
    session.recentEdits.unshift(edit);
    if (session.recentEdits.length > MAX_HISTORY) {
        session.recentEdits = session.recentEdits.slice(0, MAX_HISTORY);
    }
    saveSession(session);
}
export function incrementSessionCount() {
    const session = loadSession();
    session.sessionCount++;
    session.lastDirectory = process.cwd();
    saveSession(session);
    return session.sessionCount;
}
export function getYolo() {
    return loadSession().yolo ?? false;
}
export function setYolo(enabled) {
    const session = loadSession();
    session.yolo = enabled;
    saveSession(session);
}
export function getProviderHealth() {
    return loadSession().providerHealth ?? [];
}
export function saveProviderHealth(entries) {
    const session = loadSession();
    session.providerHealth = entries;
    saveSession(session);
}
export function clearProviderHealth() {
    const session = loadSession();
    session.providerHealth = [];
    saveSession(session);
}
export function getLastProviderError() {
    const entries = getProviderHealth();
    if (entries.length === 0)
        return null;
    const last = entries[entries.length - 1];
    return `${last.provider}/${last.model}: ${last.reason}`;
}
// ── Usage Tracking ──────────────────────────────────
export function saveUsage(data) {
    const session = loadSession();
    session.usage = data;
    saveSession(session);
}
export function getUsage() {
    return loadSession().usage ?? { totalRequests: 0, totalErrors: 0 };
}
export function recordRequest(durationMs, tokens) {
    const usage = getUsage();
    usage.totalRequests++;
    usage.lastRequestDuration = durationMs;
    usage.lastRequestTimestamp = Date.now();
    if (tokens !== undefined)
        usage.lastRequestTokens = tokens;
    saveUsage(usage);
}
export function recordPromptMode(mode) {
    const usage = getUsage();
    usage.lastPromptMode = mode;
    saveUsage(usage);
}
export function recordError(error, provider, model) {
    const usage = getUsage();
    usage.totalErrors++;
    usage.lastError = error;
    usage.lastProvider = provider;
    usage.lastModel = model;
    saveUsage(usage);
}
//# sourceMappingURL=session.js.map