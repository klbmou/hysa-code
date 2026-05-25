import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

// ── Types ──

export type SessionEventKind =
  | 'command_run' | 'file_read' | 'file_edited' | 'tool_used'
  | 'error_encountered' | 'auto_fix' | 'provider_fallback'
  | 'memory_injected' | 'build_result' | 'test_result'
  | 'session_started' | 'session_ended';

export type SessionEvent = {
  kind: SessionEventKind;
  timestamp: string;
  detail: string;
};

export type SessionState = {
  id: string;
  startedAt: string;
  endedAt?: string;
  events: SessionEvent[];
  commandsRun: string[];
  filesRead: string[];
  filesEdited: string[];
  toolsUsed: string[];
  errorsEncountered: string[];
  autoFixAttempts: number;
  providerFallbacks: number;
  memoriesInjected: number;
  finalStatus: 'success' | 'partial' | 'failure' | 'running';
};

export type SessionSummary = {
  sessionId: string;
  startedAt: string;
  duration: string;
  commandsRun: string[];
  filesChanged: string[];
  decisionsMade: string[];
  lessonsLearned: string[];
  unresolvedIssues: string[];
  autoFixAttempts: number;
  providerFallbacks: number;
  memoriesSaved: number;
  testsBuildStatus: string;
  finalStatus: string;
  charCount: number;
};

// ── Constants ──

const MAX_SUMMARY_LENGTH = 4000;
const SESSION_DIR = join('.hysa', 'brain');
const SESSION_FILE = join(SESSION_DIR, 'session-state.json');

const SECRET_PATTERNS = [
  /API_KEY/i, /TOKEN/i, /SECRET/i, /PASSWORD/i,
  /\bsk-\S+/i, /\btvly-\S+/i, /\bghp_\S+/i, /\bBearer\s+\S+/i,
  /\beyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+/i,
  /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/,
];

// ── Helpers ──

function containsSecret(text: string): boolean {
  return SECRET_PATTERNS.some(p => p.test(text));
}

function redactSecrets(text: string): string {
  let result = text;
  for (const p of SECRET_PATTERNS) {
    result = result.replace(p, '[REDACTED]');
  }
  return result;
}

function sanitizeSummary(text: string, maxLen = MAX_SUMMARY_LENGTH): string {
  let cleaned = redactSecrets(text.trim());
  if (cleaned.length > maxLen) {
    cleaned = cleaned.slice(0, maxLen) + `... (truncated ${text.length - maxLen} chars)`;
  }
  return cleaned;
}

function formatDuration(start: string, end?: string): string {
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const ms = Math.max(0, e - s);
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

// ── Persistence ──

async function ensureSessionDir(): Promise<void> {
  const dir = join(process.cwd(), SESSION_DIR);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

async function loadSession(): Promise<SessionState | null> {
  const filePath = join(process.cwd(), SESSION_FILE);
  if (!existsSync(filePath)) return null;
  try {
    const raw = await readFile(filePath, 'utf-8');
    return JSON.parse(raw) as SessionState;
  } catch {
    return null;
  }
}

async function saveSession(state: SessionState): Promise<void> {
  await ensureSessionDir();
  const filePath = join(process.cwd(), SESSION_FILE);
  await writeFile(filePath, JSON.stringify(state, null, 2), 'utf-8');
}

// ── Exported API ──

export { loadSession };

export function isTrivialSession(state: SessionState): boolean {
  return (
    state.commandsRun.length === 0 &&
    state.filesEdited.length === 0 &&
    state.filesRead.length === 0 &&
    state.errorsEncountered.length === 0 &&
    state.autoFixAttempts === 0 &&
    state.providerFallbacks === 0 &&
    state.memoriesInjected === 0
  );
}

export async function getOrCreateSession(): Promise<SessionState> {
  const existing = await loadSession();
  if (existing && existing.finalStatus === 'running') {
    return existing;
  }
  const session: SessionState = {
    id: randomUUID().slice(0, 12),
    startedAt: new Date().toISOString(),
    events: [{ kind: 'session_started', timestamp: new Date().toISOString(), detail: 'Session started' }],
    commandsRun: [],
    filesRead: [],
    filesEdited: [],
    toolsUsed: [],
    errorsEncountered: [],
    autoFixAttempts: 0,
    providerFallbacks: 0,
    memoriesInjected: 0,
    finalStatus: 'running',
  };
  await saveSession(session);
  return session;
}

export async function recordEvent(
  kind: SessionEventKind,
  detail: string,
): Promise<void> {
  const state = await getOrCreateSession();
  state.events.push({ kind, timestamp: new Date().toISOString(), detail: sanitizeSummary(detail, 500) });

  switch (kind) {
    case 'command_run':
      state.commandsRun.push(detail);
      break;
    case 'file_read':
      if (!state.filesRead.includes(detail)) state.filesRead.push(detail);
      break;
    case 'file_edited':
      if (!state.filesEdited.includes(detail)) state.filesEdited.push(detail);
      break;
    case 'tool_used':
      if (!state.toolsUsed.includes(detail)) state.toolsUsed.push(detail);
      break;
    case 'error_encountered':
      state.errorsEncountered.push(sanitizeSummary(detail, 300));
      break;
    case 'auto_fix':
      state.autoFixAttempts++;
      break;
    case 'provider_fallback':
      state.providerFallbacks++;
      break;
    case 'memory_injected':
      state.memoriesInjected++;
      break;
  }

  await saveSession(state);
}

export async function endSession(status: 'success' | 'partial' | 'failure'): Promise<SessionState> {
  const state = await getOrCreateSession();
  state.finalStatus = status;
  state.endedAt = new Date().toISOString();
  state.events.push({ kind: 'session_ended', timestamp: state.endedAt, detail: `Session ended: ${status}` });
  await saveSession(state);
  return state;
}

export async function generateSummary(): Promise<SessionSummary> {
  const state = (await loadSession()) ?? await getOrCreateSession();
  const decisionsMade: string[] = [];
  const lessonsLearned: string[] = [];
  const unresolvedIssues: string[] = [];

  for (const ev of state.events) {
    if (ev.detail.includes('decision') || ev.detail.includes('decided') || ev.detail.includes('Decision')) {
      if (!decisionsMade.includes(ev.detail)) decisionsMade.push(ev.detail);
    }
    if (ev.detail.includes('lesson') || ev.detail.includes('learned') || ev.detail.includes('Lesson')) {
      if (!lessonsLearned.includes(ev.detail)) lessonsLearned.push(ev.detail);
    }
    if (ev.kind === 'error_encountered') {
      if (!unresolvedIssues.includes(ev.detail)) unresolvedIssues.push(ev.detail);
    }
  }

  const hasTestRun = state.events.some(e => e.kind === 'test_result');
  const hasBuildRun = state.events.some(e => e.kind === 'build_result');
  const buildPass = state.events.some(e => e.kind === 'build_result' && e.detail.includes('pass'));
  const testPass = state.events.some(e => e.kind === 'test_result' && e.detail.includes('pass'));

  let testsBuildStatus = 'not run';
  if (hasBuildRun && hasTestRun) {
    testsBuildStatus = buildPass && testPass ? 'all passing' : 'has failures';
  } else if (hasBuildRun) {
    testsBuildStatus = buildPass ? 'build passing' : 'build failing';
  } else if (hasTestRun) {
    testsBuildStatus = testPass ? 'tests passing' : 'tests failing';
  }

  let summaryText = 'Session summary:\n';
  if (state.commandsRun.length > 0) {
    summaryText += `  Commands: ${state.commandsRun.join(', ')}\n`;
  }
  if (state.filesEdited.length > 0) {
    summaryText += `  Files changed: ${state.filesEdited.join(', ')}\n`;
  }
  if (decisionsMade.length > 0) {
    summaryText += `  Decisions: ${decisionsMade.join('; ')}\n`;
  }
  if (lessonsLearned.length > 0) {
    summaryText += `  Lessons: ${lessonsLearned.join('; ')}\n`;
  }
  if (unresolvedIssues.length > 0) {
    summaryText += `  Unresolved: ${unresolvedIssues.join('; ')}\n`;
  }
  summaryText += `  Status: ${state.finalStatus}`;

  const charCount = summaryText.length;

  return {
    sessionId: state.id,
    startedAt: state.startedAt,
    duration: formatDuration(state.startedAt, state.endedAt),
    commandsRun: [...state.commandsRun],
    filesChanged: [...state.filesEdited],
    decisionsMade,
    lessonsLearned,
    unresolvedIssues: [...unresolvedIssues],
    autoFixAttempts: state.autoFixAttempts,
    providerFallbacks: state.providerFallbacks,
    memoriesSaved: state.memoriesInjected,
    testsBuildStatus,
    finalStatus: state.finalStatus,
    charCount,
  };
}

export async function formatSummaryForChat(): Promise<string> {
  const summary = await generateSummary();
  const lines: string[] = [
    `📋 Session Report (${summary.sessionId})`,
    `   Duration: ${summary.duration}`,
    `   Status: ${summary.finalStatus}`,
  ];
  if (summary.commandsRun.length > 0) {
    lines.push(`   Commands (${summary.commandsRun.length}): ${summary.commandsRun.join(', ')}`);
  }
  if (summary.filesChanged.length > 0) {
    lines.push(`   Files changed (${summary.filesChanged.length}): ${summary.filesChanged.join(', ')}`);
  }
  if (summary.decisionsMade.length > 0) {
    lines.push(`   Decisions: ${summary.decisionsMade.join('; ')}`);
  }
  if (summary.lessonsLearned.length > 0) {
    lines.push(`   Lessons: ${summary.lessonsLearned.join('; ')}`);
  }
  if (summary.unresolvedIssues.length > 0) {
    lines.push(`   Unresolved: ${summary.unresolvedIssues.join('; ')}`);
  }
  lines.push(`   Build/Tests: ${summary.testsBuildStatus}`);
  lines.push(`   Auto-fix attempts: ${summary.autoFixAttempts}, Provider fallbacks: ${summary.providerFallbacks}`);
  lines.push(`   Memories saved: ${summary.memoriesSaved}`);
  return lines.join('\n');
}

export async function saveSessionToBrain(): Promise<{ saved: number; skipped: boolean; reason?: string }> {
  const state = await loadSession();
  if (!state) {
    return { saved: 0, skipped: true, reason: 'No active session' };
  }

  if (isTrivialSession(state)) {
    return { saved: 0, skipped: true, reason: 'Trivial session: no commands, files, or errors recorded' };
  }

  const summary = await generateSummary();
  let saved = 0;

  // Try to save decisions
  for (const decision of summary.decisionsMade) {
    try {
      const { writeMemoryFromText } = await import('../tools/memory-writer.js');
      const result = await writeMemoryFromText(`we decided ${decision}`);
      if (result) saved++;
    } catch {
      // skip individual failures
    }
  }

  // Try to save lessons
  for (const lesson of summary.lessonsLearned) {
    try {
      const { writeMemoryFromText } = await import('../tools/memory-writer.js');
      const result = await writeMemoryFromText(`we learned ${lesson}`);
      if (result) saved++;
    } catch {
      // skip individual failures
    }
  }

  // Save session summary as a lesson if there were files changed or errors
  if (summary.filesChanged.length > 0 || summary.unresolvedIssues.length > 0 || summary.autoFixAttempts > 0) {
    try {
      const { writeMemory } = await import('../tools/memory-writer.js');
      const title = `Session ${summary.sessionId}: ${summary.filesChanged.length} files, ${summary.unresolvedIssues.length} issues`;
      const summaryText = [
        `Session summary:`,
        `Duration: ${summary.duration}`,
        `Status: ${summary.finalStatus}`,
        summary.filesChanged.length > 0 ? `Files changed: ${summary.filesChanged.join(', ')}` : '',
        summary.commandsRun.length > 0 ? `Commands: ${summary.commandsRun.join(', ')}` : '',
        summary.unresolvedIssues.length > 0 ? `Unresolved: ${summary.unresolvedIssues.join('; ')}` : '',
        `Build/Tests: ${summary.testsBuildStatus}`,
        `Auto-fix: ${summary.autoFixAttempts}, Provider fallbacks: ${summary.providerFallbacks}`,
      ].filter(Boolean).join('\n');
      await writeMemory('lesson', title, sanitizeSummary(summaryText), ['session-summary', 'auto'], summary.filesChanged, 'auto-fix');
      saved++;
    } catch {
      // skip
    }
  }

  // Save provider issues as provider event
  if (summary.providerFallbacks > 0) {
    try {
      const { writeProviderEvent } = await import('../tools/memory-writer.js');
      await writeProviderEvent('unknown', 'unknown', 'failure', `${summary.providerFallbacks} fallback(s) during session`);
      saved++;
    } catch {
      // skip
    }
  }

  return { saved, skipped: false };
}

export async function clearSession(): Promise<void> {
  const filePath = join(process.cwd(), SESSION_FILE);
  try {
    if (existsSync(filePath)) {
      await writeFile(filePath, JSON.stringify({
        id: 'cleared',
        startedAt: new Date().toISOString(),
        events: [],
        commandsRun: [],
        filesRead: [],
        filesEdited: [],
        toolsUsed: [],
        errorsEncountered: [],
        autoFixAttempts: 0,
        providerFallbacks: 0,
        memoriesInjected: 0,
        finalStatus: 'cleared',
      }, null, 2), 'utf-8');
    }
  } catch {
    // silently fail
  }
}
