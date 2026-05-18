import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SEARCH_IGNORE = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.cache',
  '__pycache__', '.venv', 'venv', 'env', '.env', 'coverage',
]);

export interface SearchResult {
  file: string;
  line: number;
  content: string;
}

export function grepSearch(rootDir: string, pattern: string, maxResults = 20): SearchResult[] {
  const results: SearchResult[] = [];
  const regex = tryCreateRegex(pattern);
  if (!regex) return results;

  try {
    searchInDir(rootDir, rootDir, regex, results, maxResults);
  } catch {
    // stop on any error
  }

  return results;
}

function tryCreateRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, 'gi');
  } catch {
    try {
      return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    } catch {
      return null;
    }
  }
}

function searchInDir(dir: string, rootDir: string, regex: RegExp, results: SearchResult[], maxResults: number): void {
  if (results.length >= maxResults) return;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (results.length >= maxResults) return;
    if (SEARCH_IGNORE.has(entry)) continue;

    const fullPath = join(dir, entry);
    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        searchInDir(fullPath, rootDir, regex, results, maxResults);
      } else if (stat.isFile() && isSearchableFile(entry)) {
        searchInFile(fullPath, rootDir, regex, results, maxResults);
      }
    } catch {
      // skip inaccessible
    }
  }
}

const SEARCHABLE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.yaml', '.yml', '.toml',
  '.md', '.txt', '.html', '.css', '.scss', '.less',
  '.py', '.rb', '.go', '.rs', '.java', '.cpp', '.c', '.h', '.hpp',
  '.sh', '.bash', '.zsh', '.ps1',
  '.env', '.gitignore', '.dockerfile',
  '.xml', '.svg', '.sql',
  '.vue', '.svelte', '.astro',
  '.php', '.swift', '.kt', '.scala',
]);

function isSearchableFile(filename: string): boolean {
  const dot = filename.lastIndexOf('.');
  if (dot === -1) return false;
  const ext = filename.slice(dot).toLowerCase();
  return SEARCHABLE_EXTENSIONS.has(ext);
}

const MAX_FILE_SIZE = 1024 * 100;

function searchInFile(filePath: string, rootDir: string, regex: RegExp, results: SearchResult[], maxResults: number): void {
  try {
    const stat = statSync(filePath);
    if (stat.size > MAX_FILE_SIZE) return;

    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const relPath = relative(rootDir, filePath);

    for (let i = 0; i < lines.length && results.length < maxResults; i++) {
      regex.lastIndex = 0;
      if (regex.test(lines[i])) {
        results.push({
          file: relPath,
          line: i + 1,
          content: lines[i].trim().slice(0, 200),
        });
      }
    }
  } catch {
    // skip unreadable
  }
}

export function findFiles(rootDir: string, filename: string): string[] {
  const results: string[] = [];
  const lowerName = filename.toLowerCase();

  try {
    findFilesInDir(rootDir, rootDir, lowerName, results);
  } catch {}

  return results;
}

function findFilesInDir(dir: string, rootDir: string, filename: string, results: string[]): void {
  if (results.length >= 50) return;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (results.length >= 50) return;
    if (SEARCH_IGNORE.has(entry)) continue;

    const fullPath = join(dir, entry);
    try {
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        findFilesInDir(fullPath, rootDir, filename, results);
      } else if (stat.isFile() && entry.toLowerCase().includes(filename)) {
        results.push(relative(rootDir, fullPath));
      }
    } catch {
      // skip inaccessible
    }
  }
}
