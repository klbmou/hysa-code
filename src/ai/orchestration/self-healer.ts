import { execSync } from 'node:child_process';
import type { HysaConfig } from '../../config/keys.js';
import { sendVia9Router } from './provider-router.js';
import type { Message } from '../types.js';

const MAX_HEALING_ATTEMPTS = 3;
const HEAL_SYSTEM_PROMPT = `You are a self-healing agent. The TypeScript compiler reported errors in the code. Your task is to fix ALL reported errors. Output ONLY the corrected file contents. Do not explain, do not add comments. Fix the exact issues reported.`;

export interface SelfHealingAttempt {
  attempt: number;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  errors: string[];
  fixed: boolean;
}

export interface SelfHealingResult {
  healed: boolean;
  attempts: SelfHealingAttempt[];
  remainingErrors: string[];
  finalExitCode: number;
}

function runCommand(cmd: string, cwd: string): { exitCode: number; stdout: string; stderr: string } {
  try {
    const stdout = execSync(cmd, {
      encoding: 'utf-8',
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60000,
      windowsHide: true,
    }).trim();
    return { exitCode: 0, stdout, stderr: '' };
  } catch (err: unknown) {
    const e = err as { status?: number; stderr?: string; message?: string; stdout?: string };
    return {
      exitCode: e.status ?? 1,
      stdout: (e.stdout?.toString() || '').trim(),
      stderr: (e.stderr?.toString() || e.message || 'Build failed').trim(),
    };
  }
}

function parseTypeScriptErrors(stderr: string): string[] {
  return stderr
    .split('\n')
    .filter(l => l.includes('error TS') || l.includes('Error:') || l.includes('error('))
    .map(l => l.trim())
    .slice(0, 20);
}

export async function executeSelfHealingLoop(
  config: HysaConfig,
  cwd: string,
  buildCommand: string,
  changedFiles: string[],
  signal?: AbortSignal,
): Promise<SelfHealingResult> {
  const taskKind = 'debug_error';
  const attempts: SelfHealingAttempt[] = [];

  // Run initial build
  const initial = runCommand(buildCommand, cwd);
  let errors = parseTypeScriptErrors(initial.stderr || initial.stdout);
  let exitCode = initial.exitCode;

  if (exitCode === 0) {
    return {
      healed: true,
      attempts: [],
      remainingErrors: [],
      finalExitCode: 0,
    };
  }

  for (let attempt = 1; attempt <= MAX_HEALING_ATTEMPTS; attempt++) {
    if (errors.length === 0) break;

    const fixMessages: Message[] = [
      { role: 'user', content: `The TypeScript compiler reported these errors:\n${errors.join('\n')}\n\nFiles to fix:\n${changedFiles.join('\n')}\n\nFix all errors and output the corrected file contents.` },
    ];

    const { response } = await sendVia9Router(config, taskKind, fixMessages, HEAL_SYSTEM_PROMPT, signal);

    if (!response?.message) {
      attempts.push({
        attempt,
        command: buildCommand,
        exitCode: -1,
        stdout: '',
        stderr: 'No fix generated',
        errors,
        fixed: false,
      });
      continue;
    }

    // Re-run build to verify
    const check = runCommand(buildCommand, cwd);
    const newErrors = parseTypeScriptErrors(check.stderr || check.stdout);
    const fixed = check.exitCode === 0;

    attempts.push({
      attempt,
      command: buildCommand,
      exitCode: check.exitCode,
      stdout: check.stdout.slice(0, 500),
      stderr: check.stderr.slice(0, 500),
      errors,
      fixed,
    });

    if (fixed) {
      return {
        healed: true,
        attempts,
        remainingErrors: [],
        finalExitCode: 0,
      };
    }

    errors = newErrors;
    exitCode = check.exitCode;
  }

  return {
    healed: exitCode === 0,
    attempts,
    remainingErrors: errors,
    finalExitCode: exitCode,
  };
}
