import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface GitInfo {
  isRepo: boolean;
  branch: string | null;
  hasChanges: boolean;
  lastCommitMessage: string | null;
  remoteUrl: string | null;
}

let cachedGitInfo: GitInfo | null = null;
let lastGitCheck = 0;
const GIT_CACHE_TTL = 5000;

export function getGitInfo(rootDir: string): GitInfo {
  if (cachedGitInfo && Date.now() - lastGitCheck < GIT_CACHE_TTL) {
    return cachedGitInfo;
  }

  const gitRoot = findGitRoot(resolve(rootDir));
  if (!gitRoot) {
    cachedGitInfo = { isRepo: false, branch: null, hasChanges: false, lastCommitMessage: null, remoteUrl: null };
    lastGitCheck = Date.now();
    return cachedGitInfo;
  }

  try {
    const branch = execSync('git branch --show-current', { encoding: 'utf-8', cwd: rootDir }).trim() || null;
    const hasChanges = execSync('git status --porcelain', { encoding: 'utf-8', cwd: rootDir }).trim().length > 0;
    let lastCommitMessage: string | null = null;
    let remoteUrl: string | null = null;

    try {
      lastCommitMessage = execSync('git log -1 --format=%s', { encoding: 'utf-8', cwd: rootDir }).trim();
    } catch {}

    try {
      remoteUrl = execSync('git remote get-url origin', { encoding: 'utf-8', cwd: rootDir }).trim();
    } catch {}

    cachedGitInfo = { isRepo: true, branch, hasChanges, lastCommitMessage, remoteUrl };
    lastGitCheck = Date.now();
    return cachedGitInfo;
  } catch {
    cachedGitInfo = { isRepo: false, branch: null, hasChanges: false, lastCommitMessage: null, remoteUrl: null };
    lastGitCheck = Date.now();
    return cachedGitInfo;
  }
}

export function getCommitSuggestion(rootDir: string): string {
  try {
    const changes = execSync('git status --short', { encoding: 'utf-8', cwd: rootDir }).trim();
    if (!changes) return 'No changes to commit';

    const lines = changes.split('\n').slice(0, 5);
    const files = lines.map(l => l.trim().slice(2).trim());
    const types = new Set(lines.map(l => {
      const op = l.trim().slice(0, 1);
      if (op === 'M') return 'update';
      if (op === 'A') return 'add';
      if (op === 'D') return 'delete';
      if (op === 'R') return 'rename';
      return 'change';
    }));

    const typeStr = Array.from(types).join('/');
    const fileStr = files.length <= 3 ? files.join(', ') : `${files[0]}, ${files[1]} +${files.length - 2} more`;
    return `${typeStr}: ${fileStr}`;
  } catch {
    return '';
  }
}

function findGitRoot(dir: string): string | null {
  let current = dir;
  while (true) {
    try {
      const gitDir = join(current, '.git');
      if (existsSync(gitDir)) return current;
    } catch {
      return null;
    }
    const parent = join(current, '..');
    if (resolve(parent) === resolve(current)) return null;
    current = parent;
  }
}
