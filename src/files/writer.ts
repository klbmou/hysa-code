import { writeFileSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve, normalize, relative } from 'node:path';
import { homedir } from 'node:os';
import { structuredPatch } from 'diff';
import { readFile } from './reader.js';

export function isPathTraversal(filePath: string, projectRoot: string): boolean {
  const resolved = resolve(normalize(filePath));
  const root = resolve(normalize(projectRoot));
  const rel = relative(root, resolved);
  return rel.startsWith('..') || relative(resolved, root).startsWith('..') || rel === resolved;
}

export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

export interface DiffSummary {
  additions: number;
  deletions: number;
  hunks: number;
}

export function summarizeDiff(diff: string): DiffSummary {
  const lines = diff.split('\n');
  let additions = 0;
  let deletions = 0;
  let hunks = 0;
  for (const line of lines) {
    if (line.startsWith('@@')) hunks++;
    else if (line.startsWith('+') && !line.startsWith('+++')) additions++;
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
  }
  return { additions, deletions, hunks };
}

const BACKUP_DIR = join(homedir(), '.hysa', 'backups');

function ensureBackupDir(): void {
  if (!existsSync(BACKUP_DIR)) {
    mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

function backupPath(originalFilePath: string): string {
  const timestamp = Date.now();
  const sanitized = originalFilePath.replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(BACKUP_DIR, `${timestamp}_${sanitized}.bak`);
}

export function generateDiff(original: string, modified: string, filePath: string): string {
  const changes = structuredPatch(filePath, filePath, original, modified);
  return changes.hunks
    .map(hunk => {
      const lines: string[] = [];
      lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
      hunk.lines.forEach(line => {
        lines.push(line);
      });
      return lines.join('\n');
    })
    .join('\n');
}

export function writeFileWithBackup(filePath: string, content: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  if (existsSync(filePath)) {
    ensureBackupDir();
    const backup = backupPath(filePath);
    copyFileSync(filePath, backup);
  }

  writeFileSync(filePath, content, 'utf-8');
}

export function previewEdit(filePath: string, newContent: string): string | null {
  const original = readFile(filePath) || '';
  if (original === newContent) return null;
  return generateDiff(original, newContent, filePath);
}
