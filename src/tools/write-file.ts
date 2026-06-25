import { existsSync, mkdirSync } from 'node:fs';
import { resolve, normalize, relative, dirname } from 'node:path';
import type { ToolDefinition, ToolRunContext } from './types.js';
import { writeFileWithBackup, previewEdit } from '../files/writer.js';
import { readFile } from '../files/reader.js';

function isWithinCwd(targetPath: string, cwd: string): boolean {
  const resolved = resolve(normalize(targetPath));
  const resolvedCwd = resolve(normalize(cwd));
  const rel = relative(resolvedCwd, resolved);
  return !rel.startsWith('..') && rel !== resolved;
}

interface WriteFileInput {
  path: string;
  content: string;
  createDirectories?: boolean;
}

interface WriteFileOutput {
  path: string;
  diff?: string;
  backupCreated: boolean;
}

export const writeFileTool: ToolDefinition<WriteFileInput, WriteFileOutput> = {
  name: 'write_file',
  description: 'Write content to a file (requires approval)',
  riskLevel: 'review',
  approvalPolicy: 'requires_approval',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path from cwd' },
      content: { type: 'string', description: 'File content to write' },
      createDirectories: { type: 'boolean', description: 'Create parent directories if missing (default false)' },
    },
    required: ['path', 'content'],
  },
  async run(input: WriteFileInput, context: ToolRunContext) {
    const cwd = resolve(normalize(context.cwd));
    const filePath = resolve(cwd, input.path);

    if (!isWithinCwd(filePath, cwd)) {
      return { ok: false, error: `Path "${input.path}" is outside the working directory`, summary: 'Path traversal blocked' };
    }

    const relPath = relative(cwd, filePath).replace(/\\/g, '/');

    // Generate diff for preview
    const originalContent = readFile(filePath);
    const diff = originalContent !== null ? previewEdit(filePath, input.content) : null;

    if (context.dryRun) {
      return {
        ok: true,
        output: { path: relPath, diff: diff ?? undefined, backupCreated: false },
        summary: `[DRY-RUN] Would write ${relPath}${diff ? ' (changes: see diff)' : ' (new file)'}`,
        proposedAction: { path: relPath, diff, isNewFile: originalContent === null },
        requiresApproval: true,
        approvalReason: 'Writing files may modify project source code',
      };
    }

    if (!context.approved) {
      return {
        ok: false,
        error: 'Write requires approval. Use approved=true or dryRun=true to preview',
        summary: 'Write requires approval',
        requiresApproval: true,
        approvalReason: 'Writing files may modify project source code',
        proposedAction: { path: relPath, diff, isNewFile: originalContent === null },
      };
    }

    try {
      if (input.createDirectories) {
        const dir = dirname(filePath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
      }
      const hadBackup = existsSync(filePath);
      writeFileWithBackup(filePath, input.content);

      return {
        ok: true,
        output: { path: relPath, diff: diff ?? undefined, backupCreated: hadBackup },
        summary: `Wrote ${relPath}${diff ? ` (${diff.split('\n').filter(l => l.startsWith('+') || l.startsWith('-')).length} line changes)` : ' (new file)'}`,
      };
    } catch (err: unknown) {
      const e = err as Error;
      return { ok: false, error: e.message, summary: `Failed to write ${relPath}: ${e.message}` };
    }
  },
};
