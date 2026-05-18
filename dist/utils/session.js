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
//# sourceMappingURL=session.js.map