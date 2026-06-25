import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { HysaConfig } from '../../config/keys.js';
import type { VerificationPlan, VerificationCommand } from './verification-planner.js';
import type { OrchestrationPlan } from './types.js';

export type VerificationOutcome = 'pass' | 'fail' | 'skip' | 'error';

export type VerificationStepResult = {
  kind: string;
  command: string;
  outcome: VerificationOutcome;
  durationMs: number;
  output: string;
  error?: string;
};

export type VerificationResult = {
  passed: boolean;
  steps: VerificationStepResult[];
  totalDurationMs: number;
  goalValidation: GoalValidationResult | null;
};

export type GoalValidationKind =
  | 'port_alive'
  | 'url_ok'
  | 'file_exists'
  | 'file_contains'
  | 'build_ok'
  | 'typecheck_ok'
  | 'test_pass';

export type GoalValidationResult = {
  kind: GoalValidationKind;
  target: string;
  passed: boolean;
  detail: string;
};

export type VerificationGateAttempt = {
  attempt: number;
  result: VerificationResult;
  timestamp: string;
};

export type VerificationGateResult = {
  passed: boolean;
  attempts: VerificationGateAttempt[];
  totalAttempts: number;
  healed: boolean;
  finalResult: VerificationResult;
};

export const MAX_VERIFICATION_ATTEMPTS = 3;

const MAX_OUTPUT_LENGTH = 2000;

function runCommand(cmd: string, cwd: string, timeoutMs: number = 60000): { stdout: string; stderr: string; exitCode: number } {
  try {
    const result = execSync(cmd, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout: (result || '').slice(0, MAX_OUTPUT_LENGTH), stderr: '', exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number; message?: string };
    return {
      stdout: (e.stdout || '').slice(0, MAX_OUTPUT_LENGTH),
      stderr: (e.stderr || e.message || '').slice(0, MAX_OUTPUT_LENGTH),
      exitCode: e.status ?? 1,
    };
  }
}

async function executeStep(command: VerificationCommand, cwd: string): Promise<VerificationStepResult> {
  if (command.kind === 'none') {
    return { kind: 'none', command: '', outcome: 'skip', durationMs: 0, output: '' };
  }

  const start = Date.now();
  let outcome: VerificationOutcome = 'pass';
  let output = '';
  let error: string | undefined;

  try {
    const timeoutMs = command.timeoutMs ?? 60000;
    const result = runCommand(command.command, cwd, timeoutMs);

    output = (result.stdout || '').trim();
    const errOutput = (result.stderr || '').trim();
    if (errOutput) output = output ? `${output}\n${errOutput}` : errOutput;

    if (result.exitCode !== 0) {
      outcome = 'fail';
      error = `Exit code ${result.exitCode}: ${errOutput.slice(0, 500) || 'command failed'}`;
    }
  } catch (err) {
    outcome = 'error';
    error = (err as Error).message;
  }

  return {
    kind: command.kind,
    command: command.command.slice(0, 200),
    outcome,
    durationMs: Date.now() - start,
    output: output.slice(0, MAX_OUTPUT_LENGTH),
    error,
  };
}

function formatGoalTarget(taskKind: string, messages?: { role: string; content: string }[]): { kind: GoalValidationKind; target: string } | null {
  const lastMsg = messages?.filter(m => m.role === 'user').pop()?.content || '';
  const msgLower = lastMsg.toLowerCase();

  if (/port\s+\d+|localhost:\d+|127\.0\.0\.1:\d+|:\d+\/|server.*start|backend.*run/i.test(msgLower)) {
    const portMatch = msgLower.match(/(\d{4,5})/);
    if (portMatch) return { kind: 'port_alive', target: portMatch[1] };
    return { kind: 'port_alive', target: '10000' };
  }

  if (/api.*status|health.*check|endpoint.*\w/.test(msgLower) || /http(?:s)?:\/\//.test(msgLower)) {
    const urlMatch = lastMsg.match(/https?:\/\/[^\s\)\]]+/);
    if (urlMatch) return { kind: 'url_ok', target: urlMatch[0] };
  }

  if (/file.*exist|file.*creat|config.*file|\.env|package\.json/i.test(msgLower)) {
    const fileMatch = lastMsg.match(/(?:`)?([a-zA-Z0-9_\/\.-]+\.[a-z]+)/);
    if (fileMatch) return { kind: 'file_exists', target: fileMatch[1] };
  }

  return null;
}

function validateGoal(kind: GoalValidationKind, target: string, cwd: string): GoalValidationResult {
  const start = Date.now();

  switch (kind) {
    case 'port_alive': {
      const port = parseInt(target, 10);
      if (isNaN(port)) {
        return { kind, target, passed: false, detail: `Invalid port: ${target}` };
      }
      try {
        const result = runCommand(`powershell -Command "try{$r=Invoke-WebRequest -Uri 'http://127.0.0.1:${port}/api/status' -UseBasicParsing -TimeoutSec 3;exit 0}catch{exit 1}"`, cwd, 10000);
        if (result.exitCode === 0) {
          return { kind, target, passed: true, detail: `Port ${port} responds: ${result.stdout.slice(0, 200)}` };
        }
        return { kind, target, passed: false, detail: `Port ${port} not responding within 3s` };
      } catch (err) {
        return { kind, target, passed: false, detail: `Port check error: ${(err as Error).message}` };
      }
    }

    case 'url_ok': {
      try {
        const result = runCommand(`powershell -Command "try{$r=Invoke-WebRequest -Uri '${target}' -UseBasicParsing -TimeoutSec 5;exit 0}catch{exit 1}"`, cwd, 10000);
        if (result.exitCode === 0) {
          return { kind, target, passed: true, detail: `URL ${target} responds OK` };
        }
        return { kind, target, passed: false, detail: `URL ${target} unreachable` };
      } catch (err) {
        return { kind, target, passed: false, detail: `URL check error: ${(err as Error).message}` };
      }
    }

    case 'file_exists': {
      const exists = existsSync(target);
      return {
        kind, target,
        passed: exists,
        detail: exists ? `File exists: ${target}` : `File not found: ${target}`,
      };
    }

    case 'file_contains': {
      const exists = existsSync(target);
      if (!exists) return { kind, target, passed: false, detail: `File not found: ${target}` };
      return { kind, target, passed: true, detail: `File exists: ${target}` };
    }

    case 'typecheck_ok': {
      const result = runCommand('npx tsc --noEmit', cwd, 60000);
      const passed = result.exitCode === 0;
      return {
        kind, target, passed,
        detail: passed ? 'Typecheck passed' : `Typecheck failed: ${result.stderr.slice(0, 300) || 'errors found'}`,
      };
    }

    case 'build_ok': {
      const result = runCommand('npm run build', cwd, 120000);
      const passed = result.exitCode === 0;
      return {
        kind, target, passed,
        detail: passed ? 'Build passed' : `Build failed: ${result.stderr.slice(0, 300) || 'build error'}`,
      };
    }

    case 'test_pass': {
      const result = runCommand('npm test 2>&1', cwd, 120000);
      const passed = result.exitCode === 0;
      return {
        kind, target, passed,
        detail: passed ? 'Tests passed' : `Tests failed: ${result.stderr.slice(0, 300) || result.stdout.slice(-300)}`,
      };
    }

    default:
      return { kind, target, passed: false, detail: `Unknown validation kind: ${kind}` };
  }
}

export async function executeVerificationPlan(
  plan: VerificationPlan,
  cwd: string,
  messages?: { role: string; content: string }[],
): Promise<VerificationResult> {
  const totalStart = Date.now();
  const steps: VerificationStepResult[] = [];

  for (const command of plan.commands) {
    const result = await executeStep(command, cwd);
    steps.push(result);
  }

  const goalTarget = formatGoalTarget(plan.taskKind, messages);
  let goalValidation: GoalValidationResult | null = null;

  if (goalTarget) {
    goalValidation = validateGoal(goalTarget.kind, goalTarget.target, cwd);
    const goalStep: VerificationStepResult = {
      kind: `goal:${goalTarget.kind}`,
      command: goalTarget.target,
      outcome: goalValidation.passed ? 'pass' : 'fail',
      durationMs: 0,
      output: goalValidation.detail,
    };
    steps.push(goalStep);
  }

  const passed = steps.every(s => s.outcome === 'pass' || s.outcome === 'skip');

  return {
    passed,
    steps,
    totalDurationMs: Date.now() - totalStart,
    goalValidation,
  };
}

export async function executeVerificationGate(
  config: HysaConfig,
  plan: VerificationPlan,
  orchestrationPlan: OrchestrationPlan,
  cwd: string,
  messages?: { role: string; content: string }[],
  signal?: AbortSignal,
): Promise<VerificationGateResult> {
  const attempts: VerificationGateAttempt[] = [];
  let lastResult: VerificationResult | null = null;

  for (let attempt = 1; attempt <= MAX_VERIFICATION_ATTEMPTS; attempt++) {
    if (signal?.aborted) break;

    lastResult = await executeVerificationPlan(plan, cwd, messages);
    const attemptRecord: VerificationGateAttempt = {
      attempt,
      result: lastResult,
      timestamp: new Date().toISOString(),
    };
    attempts.push(attemptRecord);

    if (lastResult.passed) {
      return {
        passed: true,
        attempts,
        totalAttempts: attempt,
        healed: attempt > 1,
        finalResult: lastResult,
      };
    }
  }

  return {
    passed: false,
    attempts,
    totalAttempts: MAX_VERIFICATION_ATTEMPTS,
    healed: false,
    finalResult: lastResult!,
  };
}
