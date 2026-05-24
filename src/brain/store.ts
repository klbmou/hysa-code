import { readFile, writeFile, appendFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BrainEvent, BrainEventKind, ProjectMap } from './types.js';

const BRAIN_DIR_NAME = '.hysa/brain';

const SECRET_PATTERNS = [
  /API_KEY/i, /TOKEN/i, /SECRET/i, /PASSWORD/i,
  /\bsk-\S+/i, /\btvly-\S+/i, /\bghp_\S+/i, /\bBearer\s+\S+/i,
  /\beyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+/i,
  /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/,
];

function containsSecret(value: unknown): boolean {
  const str = String(value);
  return SECRET_PATTERNS.some(p => p.test(str));
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return containsSecret(value) ? '[REDACTED]' : value;
  }
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (containsSecret(k)) {
        result[k] = '[REDACTED]';
      } else {
        result[k] = redactValue(v);
      }
    }
    return result;
  }
  return value;
}

function redact(obj: unknown): unknown {
  return redactValue(obj);
}

export function getBrainDir(): string {
  const cwd = process.cwd();
  return join(cwd, BRAIN_DIR_NAME);
}

export async function ensureBrainDir(): Promise<void> {
  const dir = getBrainDir();
  await mkdir(dir, { recursive: true });
}

function projectMapPath(): string {
  return join(getBrainDir(), 'project-map.json');
}

function eventLogPath(): string {
  return join(getBrainDir(), 'experience-log.jsonl');
}

function lessonsPath(): string {
  return join(getBrainDir(), 'lessons.md');
}

function decisionsPath(): string {
  return join(getBrainDir(), 'decisions.md');
}

function readmePath(): string {
  return join(getBrainDir(), 'README.md');
}

export async function readProjectMap(): Promise<ProjectMap | null> {
  try {
    const raw = await readFile(projectMapPath(), 'utf8');
    return JSON.parse(raw) as ProjectMap;
  } catch {
    return null;
  }
}

export async function writeProjectMap(map: ProjectMap): Promise<void> {
  await ensureBrainDir();
  const redacted = redact(map);
  await writeFile(projectMapPath(), JSON.stringify(redacted, null, 2), 'utf8');
}

export async function appendBrainEvent(event: Omit<BrainEvent, 'id' | 'timestamp'>): Promise<BrainEvent> {
  await ensureBrainDir();
  const full: BrainEvent = {
    ...event,
    id: randomUUID().slice(0, 8),
    timestamp: new Date().toISOString(),
  };
  const redacted = redact(full);
  await appendFile(eventLogPath(), JSON.stringify(redacted) + '\n', 'utf8');
  return full;
}

export async function readRecentEvents(limit: number = 10): Promise<BrainEvent[]> {
  try {
    const raw = await readFile(eventLogPath(), 'utf8');
    const lines = raw.trim().split('\n').filter(Boolean);
    const events: BrainEvent[] = lines.map(line => JSON.parse(line));
    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return events.slice(0, limit);
  } catch {
    return [];
  }
}

export async function countEvents(): Promise<number> {
  try {
    const raw = await readFile(eventLogPath(), 'utf8');
    return raw.trim().split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

export async function appendLesson(title: string, content: string, tags: string[] = []): Promise<void> {
  await ensureBrainDir();
  const ts = new Date().toISOString().slice(0, 10);
  const tagStr = tags.length > 0 ? ` **Tags:** ${tags.join(', ')}` : '';
  const entry = `\n## ${title}\n\n- **Date:** ${ts}${tagStr}\n\n${content}\n`;
  await appendFile(lessonsPath(), entry, 'utf8');
}

export async function appendDecision(title: string, content: string, tags: string[] = []): Promise<void> {
  await ensureBrainDir();
  const ts = new Date().toISOString().slice(0, 10);
  const tagStr = tags.length > 0 ? ` **Tags:** ${tags.join(', ')}` : '';
  const entry = `\n## ${title}\n\n- **Date:** ${ts}${tagStr}\n\n${content}\n`;
  await appendFile(decisionsPath(), entry, 'utf8');
}

export async function initBrainFiles(): Promise<void> {
  await ensureBrainDir();
  const dir = getBrainDir();

  // README
  if (!existsSync(readmePath())) {
    await writeFile(readmePath(), `# HYSA Project Brain

Local project memory for HYSA Code.

## Files

- **project-map.json** — Auto-generated project structure map
- **experience-log.jsonl** — Append-only event log (JSONL)
- **lessons.md** — Lessons learned
- **decisions.md** — Architecture/design decisions

## Commands

- \`hysa brain init\` — Initialize brain files
- \`hysa brain map\` — Generate/update project map
- \`hysa brain status\` — Show brain status
- \`hysa brain recent\` — Show last events
- \`hysa brain note <text>\` — Add a note
- \`hysa brain lesson <title> <text>\` — Add a lesson
- \`hysa brain decision <title> <text>\` — Add a decision

## Notes

- This directory is local-only and should not be committed.
- No secrets or API keys are stored here.
`, 'utf8');
  }

  // Empty JSONL starter
  if (!existsSync(eventLogPath())) {
    await writeFile(eventLogPath(), '', 'utf8');
  }

  // Lessons header
  if (!existsSync(lessonsPath())) {
    await writeFile(lessonsPath(), `# Lessons Learned\n\n`, 'utf8');
  }

  // Decisions header
  if (!existsSync(decisionsPath())) {
    await writeFile(decisionsPath(), `# Design Decisions\n\n`, 'utf8');
  }

  // Project map placeholder
  if (!existsSync(projectMapPath())) {
    await writeProjectMap({
      version: 1,
      updatedAt: new Date().toISOString(),
      importantFiles: {},
      modules: {},
      commands: {},
      knownSystems: [],
    });
  }
}

export async function getBrainStatus(): Promise<{
  exists: boolean;
  projectMapDate: string | null;
  eventCount: number;
  knownSystems: string[];
}> {
  const dir = getBrainDir();
  const exists = existsSync(dir);
  let projectMapDate: string | null = null;
  let knownSystems: string[] = [];

  if (exists) {
    const pm = await readProjectMap();
    if (pm) {
      projectMapDate = pm.updatedAt;
      knownSystems = pm.knownSystems || [];
    }
  }

  const eventCount = exists ? await countEvents() : 0;

  return { exists, projectMapDate, eventCount, knownSystems };
}

export { containsSecret, redact };
