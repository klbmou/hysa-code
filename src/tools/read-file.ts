import { readFileSync, statSync, existsSync } from 'node:fs';
import { resolve, normalize, relative } from 'node:path';
import type { ToolDefinition, ToolRunContext } from './types.js';

const MAX_FILE_SIZE = 1 * 1024 * 1024; // 1MB
const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.txt', '.html', '.css',
  '.scss', '.less', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.env', '.npmrc',
  '.gitignore', '.gitattributes', '.editorconfig', '.prettierrc', '.eslintrc',
  '.rs', '.py', '.rb', '.go', '.java', '.c', '.cpp', '.h', '.hpp', '.cs', '.swift',
  '.kt', '.scala', '.php', '.sh', '.bash', '.ps1', '.bat', '.cmd', '.fish', '.zsh',
  '.sql', '.graphql', '.gql', '.proto', '.xml', '.svg', '.vue', '.svelte', '.astro',
  '.dockerfile', '.flake8', '.mypy.ini', '.terraform', '.tf', '.hcl',
]);

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.avif',
  '.mp3', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.mkv',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.wasm',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
  '.o', '.obj', '.lib', '.a', '.class', '.jar',
  '.pyc', '.pyo',
]);

function isTextFile(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  if (BINARY_EXTENSIONS.has(ext)) return false;
  // Unknown extension — try reading as text, fall back to binary check
  return true;
}

function isWithinCwd(targetPath: string, cwd: string): boolean {
  const resolved = resolve(normalize(targetPath));
  const resolvedCwd = resolve(normalize(cwd));
  const rel = relative(resolvedCwd, resolved);
  return !rel.startsWith('..') && rel !== resolved;
}

interface ReadFileInput {
  path: string;
  maxBytes?: number;
}

interface ReadFileOutput {
  path: string;
  content: string;
  size: number;
  truncated: boolean;
}

export const readFileTool: ToolDefinition<ReadFileInput, ReadFileOutput> = {
  name: 'read_file',
  description: 'Read the contents of a text file',
  riskLevel: 'safe',
  approvalPolicy: 'auto',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path from cwd' },
      maxBytes: { type: 'number', description: 'Maximum bytes to read (default 100000)' },
    },
    required: ['path'],
  },
  async run(input: ReadFileInput, context: ToolRunContext) {
    const cwd = resolve(normalize(context.cwd));
    const filePath = resolve(cwd, input.path);

    if (!isWithinCwd(filePath, cwd)) {
      return { ok: false, error: `Path "${input.path}" is outside the working directory`, summary: 'Path traversal blocked' };
    }

    if (!existsSync(filePath)) {
      return { ok: false, error: `File not found: ${input.path}`, summary: 'File not found' };
    }

    try {
      const stats = statSync(filePath);
      if (stats.size > MAX_FILE_SIZE) {
        return { ok: false, error: `File too large: ${stats.size} bytes (max ${MAX_FILE_SIZE})`, summary: 'File too large' };
      }

      if (!isTextFile(filePath)) {
        return { ok: false, error: `Binary file: ${input.path}`, summary: 'Binary file not readable as text' };
      }

      const maxBytes = Math.min(input.maxBytes ?? 100000, MAX_FILE_SIZE);
      const full = readFileSync(filePath, 'utf-8');
      const truncated = full.length > maxBytes;
      const content = truncated ? full.slice(0, maxBytes) : full;

      const relPath = relative(cwd, filePath).replace(/\\/g, '/');

      return {
        ok: true,
        output: { path: relPath, content, size: full.length, truncated },
        summary: `Read ${relPath} (${full.length} chars${truncated ? `, truncated to ${maxBytes}` : ''})`,
      };
    } catch (err: unknown) {
      const e = err as Error;
      return { ok: false, error: e.message, summary: `Failed to read file: ${e.message}` };
    }
  },
};
