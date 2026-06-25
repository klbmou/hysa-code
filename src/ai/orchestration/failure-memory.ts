import { readFile, appendFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getBrainDir, ensureBrainDir, appendBrainEvent } from '../../brain/store.js';
import { redact } from '../../brain/store.js';

export type FailureStatus = 'FAILED' | 'SUCCESS' | 'PARTIAL';

export type FailureRecord = {
  id: string;
  timestamp: string;
  taskId: string;
  taskKind: string;
  proposedFixDiff: string;
  errorOutput: string;
  status: FailureStatus;
  commandAttempted: string;
  workingDirectory: string;
  filesTouched: string[];
  tags: string[];
  retryCount: number;
};

export type FailureQuery = {
  taskKind?: string;
  errorKeywords?: string[];
  filesTouched?: string[];
  maxAgeMs?: number;
};

export type AvoidanceResult = {
  found: boolean;
  count: number;
  avoidanceBlock: string;
  records: FailureRecord[];
};

const FAILURE_LOG_FILE = 'failure-memory.jsonl';
const MAX_RECORDS_IN_MEMORY = 200;
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function failureLogPath(): string {
  return join(getBrainDir(), FAILURE_LOG_FILE);
}

function extractErrorKeywords(error: string): string[] {
  const keywords: string[] = [];
  const patterns = [
    /error\s+TS\d+/gi, /cannot\s+find\s+module/gi, /cannot\s+find\s+name/gi,
    /is\s+not\s+assignable/gi, /Type\s+['"]([^'"]+)['"]/g,
    /Property\s+['"]([^'"]+)['"]/g, /Module\s+['"]([^'"]+)['"]/g,
    /Failed\s+to/gi, /EADDRINUSE/gi, /ECONNREFUSED/gi,
    /ENOENT/gi, /timeout/gi, /ETIMEDOUT/gi,
    /port\s+\d+\s+(?:is\s+)?already\s+in\s+use/gi,
    /Cannot\s+find\s+module/gi, /SyntaxError/gi,
    /TypeError/gi, /ReferenceError/gi,
  ];
  for (const p of patterns) {
    const matches = error.match(p);
    if (matches) keywords.push(...matches.map(m => m.toLowerCase()));
  }
  return [...new Set(keywords)].slice(0, 15);
}

function buildAvoidanceBlock(records: FailureRecord[]): string {
  if (records.length === 0) return '';

  const lines: string[] = [
    '[CRITICAL] Avoid the following approaches which failed previously in this codebase:',
  ];

  for (const record of records.slice(0, 5)) {
    const diffPreview = record.proposedFixDiff
      .split('\n').slice(0, 8).join('\n')
      .slice(0, 400);
    const errPreview = record.errorOutput
      .split('\n').slice(0, 6).join('\n')
      .slice(0, 300);

    lines.push('');
    lines.push(`--- Failed attempt (${record.timestamp}) for task: ${record.taskId} ---`);
    lines.push(`Task kind: ${record.taskKind}`);
    lines.push(`Error: ${errPreview}`);
    if (diffPreview) lines.push(`Avoided approach: ${diffPreview}`);
    if (record.filesTouched.length > 0) lines.push(`Related files: ${record.filesTouched.join(', ')}`);
    lines.push('---');
  }

  lines.push('');
  lines.push('Consider alternative strategies that do not repeat these known failure patterns.');

  return lines.join('\n');
}

export async function logFailure(record: Omit<FailureRecord, 'id' | 'timestamp'>): Promise<FailureRecord> {
  await ensureBrainDir();

  const full: FailureRecord = {
    ...record,
    id: randomUUID().slice(0, 8),
    timestamp: new Date().toISOString(),
  };

  const redacted = redact(full);
  const line = JSON.stringify(redacted) + '\n';

  try {
    await appendFile(failureLogPath(), line, 'utf8');
  } catch {
    // non-blocking
  }

  const keywords = extractErrorKeywords(record.errorOutput);
  try {
    await appendBrainEvent({
      kind: 'test_failed',
      title: `Failure: ${record.taskKind} - ${record.taskId}`,
      summary: `Task ${record.taskKind} failed. Errors: ${keywords.slice(0, 5).join(', ') || record.errorOutput.slice(0, 200)}`,
      files: record.filesTouched,
      commands: [record.commandAttempted],
      tags: ['failure_memory', record.taskKind, ...record.tags],
      metadata: { failureId: full.id, retryCount: record.retryCount, status: record.status },
    });
  } catch {
    // non-blocking
  }

  return full;
}

export async function queryFailures(query: FailureQuery): Promise<AvoidanceResult> {
  let records: FailureRecord[] = [];

  try {
    if (existsSync(failureLogPath())) {
      const raw = await readFile(failureLogPath(), 'utf8');
      records = raw.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    }
  } catch {
    return { found: false, count: 0, avoidanceBlock: '', records: [] };
  }

  if (records.length === 0) {
    return { found: false, count: 0, avoidanceBlock: '', records: [] };
  }

  const maxAge = query.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const cutoff = Date.now() - maxAge;

  let filtered = records.filter(r => {
    const age = new Date(r.timestamp).getTime();
    if (isNaN(age) || age < cutoff) return false;
    if (r.status === 'SUCCESS') return false;
    if (query.taskKind && r.taskKind !== query.taskKind) return false;
    return true;
  });

  if (query.errorKeywords && query.errorKeywords.length > 0) {
    const keywords = query.errorKeywords.map(k => k.toLowerCase());
    filtered = filtered.filter(r => {
      const errLower = r.errorOutput.toLowerCase();
      return keywords.some(k => errLower.includes(k));
    });
  }

  if (query.filesTouched && query.filesTouched.length > 0) {
    filtered = filtered.filter(r =>
      r.filesTouched.some(ft => query.filesTouched!.some(qf => ft.includes(qf) || qf.includes(ft))),
    );
  }

  filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  filtered = filtered.slice(0, 10);

  if (filtered.length === 0) {
    return { found: false, count: 0, avoidanceBlock: '', records: [] };
  }

  const avoidanceBlock = buildAvoidanceBlock(filtered);

  return {
    found: true,
    count: filtered.length,
    avoidanceBlock,
    records: filtered,
  };
}

export async function getFailureStats(): Promise<{
  total: number;
  failed: number;
  successful: number;
  byKind: Record<string, number>;
}> {
  try {
    if (!existsSync(failureLogPath())) {
      return { total: 0, failed: 0, successful: 0, byKind: {} };
    }
    const raw = await readFile(failureLogPath(), 'utf8');
    const records: FailureRecord[] = raw.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));

    const byKind: Record<string, number> = {};
    let failed = 0;
    let successful = 0;

    for (const r of records) {
      byKind[r.taskKind] = (byKind[r.taskKind] || 0) + 1;
      if (r.status === 'FAILED' || r.status === 'PARTIAL') failed++;
      else successful++;
    }

    return { total: records.length, failed, successful, byKind };
  } catch {
    return { total: 0, failed: 0, successful: 0, byKind: {} };
  }
}

export async function trimFailureLog(maxRecords: number = MAX_RECORDS_IN_MEMORY): Promise<number> {
  try {
    if (!existsSync(failureLogPath())) return 0;
    const raw = await readFile(failureLogPath(), 'utf8');
    const lines = raw.trim().split('\n').filter(Boolean);
    if (lines.length <= maxRecords) return 0;

    const records: FailureRecord[] = lines.map(line => JSON.parse(line));
    records.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const trimmed = records.slice(0, maxRecords);

    await writeFile(failureLogPath(), trimmed.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
    return lines.length - trimmed.length;
  } catch {
    return 0;
  }
}
