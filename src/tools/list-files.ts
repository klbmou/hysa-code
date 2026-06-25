import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, normalize } from 'node:path';
import type { ToolDefinition, ToolRunContext } from './types.js';

const IGNORE_DIRS = new Set(['node_modules', '.git', '.hysa', 'dist', 'build', '.next', '.cache', '__pycache__', 'coverage']);
const IGNORE_FILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.DS_Store']);

function isWithinCwd(targetDir: string, cwd: string): boolean {
  const resolved = resolve(normalize(targetDir));
  const resolvedCwd = resolve(normalize(cwd));
  const rel = relative(resolvedCwd, resolved);
  return !rel.startsWith('..') && rel !== resolved;
}

interface ListFilesInput {
  path?: string;
  maxDepth?: number;
  includeHidden?: boolean;
}

interface ListFilesOutput {
  entries: Array<{ name: string; path: string; type: 'file' | 'dir'; size: number }>;
  totalFiles: number;
  totalDirs: number;
  path: string;
}

export const listFilesTool: ToolDefinition<ListFilesInput, ListFilesOutput> = {
  name: 'list_files',
  description: 'List files and directories under a path',
  riskLevel: 'safe',
  approvalPolicy: 'auto',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path from cwd (defaults to cwd)' },
      maxDepth: { type: 'number', description: 'Maximum directory depth (default 1)' },
      includeHidden: { type: 'boolean', description: 'Include hidden files (default false)' },
    },
  },
  async run(input: ListFilesInput, context: ToolRunContext) {
    const cwd = resolve(normalize(context.cwd));
    const targetDir = input.path ? resolve(cwd, input.path) : cwd;

    if (!isWithinCwd(targetDir, cwd)) {
      return { ok: false, error: `Path "${input.path || cwd}" is outside the working directory`, summary: 'Path traversal blocked' };
    }

    const maxDepth = Math.min(input.maxDepth ?? 1, 5);
    const includeHidden = input.includeHidden ?? false;

    try {
      const entries: ListFilesOutput['entries'] = [];
      let totalFiles = 0;
      let totalDirs = 0;

      function walk(dir: string, depth: number): void {
        if (depth > maxDepth) return;
        let names: string[];
        try {
          names = readdirSync(dir);
        } catch {
          return;
        }
        for (const name of names) {
          if (!includeHidden && name.startsWith('.')) continue;
          if (IGNORE_FILES.has(name)) continue;

          const fullPath = join(dir, name);
          try {
            const stats = statSync(fullPath);
            const relPath = relative(cwd, fullPath).replace(/\\/g, '/');
            if (stats.isDirectory()) {
              if (IGNORE_DIRS.has(name)) continue;
              entries.push({ name, path: relPath, type: 'dir', size: 0 });
              totalDirs++;
              walk(fullPath, depth + 1);
            } else {
              entries.push({ name, path: relPath, type: 'file', size: stats.size });
              totalFiles++;
            }
          } catch {
            // skip inaccessible entries
          }
        }
      }

      walk(targetDir, 0);

      return {
        ok: true,
        output: { entries, totalFiles, totalDirs, path: relative(cwd, targetDir).replace(/\\/g, '/') || '.' },
        summary: `Listed ${totalFiles} files, ${totalDirs} dirs in ${relative(cwd, targetDir).replace(/\\/g, '/') || '.'}`,
      };
    } catch (err: unknown) {
      const e = err as Error;
      return { ok: false, error: e.message, summary: `Failed to list files: ${e.message}` };
    }
  },
};
