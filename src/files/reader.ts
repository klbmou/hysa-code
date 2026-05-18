import { readFileSync, existsSync } from 'node:fs';
import { relative } from 'node:path';

const IGNORED_PATTERNS = [
  '.env',
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.cache',
  '__pycache__',
  '*.pyc',
  '*.log',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
];

export function readFile(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

export function shouldIgnore(filePath: string, rootDir: string): boolean {
  const rel = relative(rootDir, filePath).replace(/\\/g, '/');
  const parts = rel.split('/');
  const fileName = parts[parts.length - 1];

  return IGNORED_PATTERNS.some(pattern => {
    if (pattern.startsWith('*.')) {
      return fileName.endsWith(pattern.slice(1));
    }
    return rel.includes(pattern) || parts.some(part => part === pattern);
  });
}
