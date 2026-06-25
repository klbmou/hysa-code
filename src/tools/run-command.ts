import { execSync } from 'node:child_process';
import { resolve, normalize } from 'node:path';
import type { ToolDefinition, ToolRunContext } from './types.js';
import { classifyCommand, formatCommandOutput } from '../utils/commands.js';
import { isDangerousCommand } from './approval.js';
import { translateCommand } from '../utils/shell.js';

const MAX_OUTPUT_SIZE = 5000;
const MAX_COMMAND_LENGTH = 8192;

interface RunCommandInput {
  command: string;
  timeoutMs?: number;
}

interface RunCommandOutput {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  truncated: boolean;
}

export const runCommandTool: ToolDefinition<RunCommandInput, RunCommandOutput> = {
  name: 'run_command',
  description: 'Execute a shell command (requires approval)',
  riskLevel: 'review',
  approvalPolicy: 'requires_approval',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to execute' },
      timeoutMs: { type: 'number', description: 'Timeout in milliseconds (default 30000)' },
    },
    required: ['command'],
  },
  async run(input: RunCommandInput, context: ToolRunContext) {
    const cmd = input.command;
    if (!cmd || cmd.length === 0) {
      return { ok: false, error: 'Empty command', summary: 'No command provided' };
    }
    if (cmd.length > MAX_COMMAND_LENGTH) {
      return { ok: false, error: `Command too long (${cmd.length} chars, max ${MAX_COMMAND_LENGTH})`, summary: 'Command too long' };
    }

    const safety = classifyCommand(cmd);
    const dangerous = isDangerousCommand(cmd);

    if (dangerous || safety === 'dangerous') {
      return {
        ok: false,
        error: `Blocked: dangerous command not allowed: ${cmd}`,
        summary: 'Dangerous command blocked',
        approvalReason: 'This command is classified as dangerous',
        proposedAction: { command: cmd, safety },
      };
    }

    if (context.dryRun) {
      return {
        ok: true,
        output: { command: cmd, stdout: '', stderr: '', exitCode: null, truncated: false },
        summary: `[DRY-RUN] Would execute: ${cmd}`,
        proposedAction: { command: cmd, safety, cwd: context.cwd },
        requiresApproval: true,
        approvalReason: 'Running commands may modify the system or files',
      };
    }

    if (!context.approved) {
      return {
        ok: false,
        error: 'Command execution requires approval. Use approved=true or dryRun=true to preview',
        summary: 'Command requires approval',
        requiresApproval: true,
        approvalReason: 'Running commands may modify the system or files',
        proposedAction: { command: cmd, safety },
      };
    }

    try {
      const translated = translateCommand(cmd);
      const shell = process.platform === 'win32'
        ? (translated !== cmd && (translated.includes('Get-') || translated.includes('Select-'))
          ? 'powershell.exe -NoProfile -Command'
          : process.env.ComSpec || 'cmd.exe')
        : undefined;

      const timeout = input.timeoutMs ?? 30000;
      const stdout = execSync(translated, {
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
        cwd: resolve(normalize(context.cwd)),
        shell,
        timeout,
      });

      const truncated = stdout.length > MAX_OUTPUT_SIZE;
      const display = formatCommandOutput(stdout, 80);

      return {
        ok: true,
        output: {
          command: cmd,
          stdout: truncated ? stdout.slice(0, MAX_OUTPUT_SIZE) : stdout,
          stderr: '',
          exitCode: 0,
          truncated,
        },
        summary: `Command completed (${stdout.length} chars stdout${truncated ? ', truncated' : ''})`,
      };
    } catch (err: unknown) {
      const e = err as Error & { stderr?: string; status?: number };
      const stderr = e.stderr || e.message || 'Unknown error';
      const truncated = stderr.length > MAX_OUTPUT_SIZE;

      return {
        ok: false,
        error: truncated ? stderr.slice(0, MAX_OUTPUT_SIZE) : stderr,
        summary: `Command failed: ${(truncated ? stderr.slice(0, 200) : stderr).split('\n')[0]}`,
        output: {
          command: cmd,
          stdout: '',
          stderr: truncated ? stderr.slice(0, MAX_OUTPUT_SIZE) : stderr,
          exitCode: e.status ?? 1,
          truncated,
        },
      };
    }
  },
};
