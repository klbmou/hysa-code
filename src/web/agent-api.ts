import { planToolActionsForTask } from '../agent/tool-planner.js';
import { runTool, listTools } from '../tools/registry.js';
import { isDangerousCommand } from '../tools/approval.js';
import type { AgentToolPlan } from '../agent/tool-planner.js';
import type { ToolRunContext } from '../tools/types.js';
import { randomUUID } from 'node:crypto';

interface PlanRequest {
  message: string;
  sessionId?: string;
}

interface PlanAction {
  id: string;
  toolName: string;
  status: 'ready' | 'requires_approval' | 'blocked' | 'proposed';
  summary: string;
  reason: string;
  approvalRequired: boolean;
  blockedReason?: string;
  inputPreview: string;
}

interface PlanResponse {
  planId: string;
  actions: PlanAction[];
  hasExecutableActions: boolean;
  hasBlockedActions: boolean;
}

interface ExecuteRequest {
  planId: string;
  approvedActionIds: string[];
  rejectedActionIds: string[];
}

interface ExecuteActionResult {
  actionId: string;
  status: 'executed' | 'skipped' | 'blocked' | 'failed';
  summary: string;
  outputPreview?: string;
  error?: string;
}

interface ExecuteResponse {
  planId: string;
  results: ExecuteActionResult[];
  toolContextForAi: string;
}

const plans = new Map<string, AgentToolPlan>();

function sanitizeInputPreview(input: Record<string, unknown>): string {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === 'command' && typeof value === 'string') {
      safe[key] = value.length > 120 ? value.slice(0, 120) + '...' : value;
    } else if (key === 'content' && typeof value === 'string') {
      safe[key] = value.length > 100 ? `[${value.length} chars]` : value;
    } else if (key === 'path' && typeof value === 'string') {
      safe[key] = value.length > 150 ? '...' + value.slice(-150) : value;
    } else if (typeof value === 'string') {
      safe[key] = value.length > 200 ? value.slice(0, 200) + '...' : value;
    } else {
      safe[key] = String(value);
    }
  }
  return JSON.stringify(safe);
}

function truncateOutput(text: string, maxLen = 1000): string {
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + `\n... [truncated, ${text.length - maxLen} more chars]`;
}

function stripSecrets(text: string): string {
  const patterns = [
    /sk-[a-zA-Z0-9]{20,}/g,
    /[Aa][Pp][Ii]_[Kk][Ee][Yy]=["']?[^"'\s]{8,}/gi,
    /ghp_[a-zA-Z0-9]{36,}/g,
    /token["']?\s*[:=]\s*["'][^"']{8,}["']/gi,
    /password["']?\s*[:=]\s*["'][^"']{8,}["']/gi,
  ];
  let clean = text;
  for (const p of patterns) {
    clean = clean.replace(p, '[REDACTED]');
  }
  return clean;
}

function buildSummary(action: { toolName: string; reason: string; status: string; riskLevel?: string }): string {
  const parts: string[] = [];
  parts.push(`${action.toolName}: ${action.reason}`);
  return parts.join(' ');
}

function getBlockedReason(toolName: string, input: Record<string, unknown>): string | undefined {
  if (toolName === 'run_command') {
    const cmd = typeof input.command === 'string' ? input.command : '';
    if (isDangerousCommand(cmd)) {
      return 'Blocked by safety policy';
    }
  }
  return undefined;
}

export function handlePlanTools(reqBody: unknown): PlanResponse {
  const { message, sessionId } = reqBody as PlanRequest;
  if (!message || typeof message !== 'string') {
    throw new Error('Missing or invalid message field');
  }

  const plan = planToolActionsForTask({ userText: message });
  const planId = randomUUID();
  plans.set(planId, plan);

  const actions: PlanAction[] = plan.actions.map(a => {
    const blockedReason = a.status === 'blocked' ? (getBlockedReason(a.toolName, a.input) || 'Blocked by safety policy') : undefined;
    return {
      id: a.id,
      toolName: a.toolName,
      status: a.status,
      summary: buildSummary(a),
      reason: a.reason,
      approvalRequired: a.approvalPolicy === 'requires_approval',
      blockedReason,
      inputPreview: sanitizeInputPreview(a.input),
    };
  });

  return {
    planId,
    actions,
    hasExecutableActions: actions.some(a => a.status === 'ready' || a.status === 'requires_approval' || a.status === 'proposed'),
    hasBlockedActions: actions.some(a => a.status === 'blocked'),
  };
}

export async function handleExecuteTools(reqBody: unknown): Promise<ExecuteResponse> {
  const { planId, approvedActionIds = [], rejectedActionIds = [] } = reqBody as ExecuteRequest;

  if (!planId) {
    throw new Error('Missing planId');
  }

  const plan = plans.get(planId);
  if (!plan) {
    throw new Error(`Plan not found: ${planId}`);
  }

  const results: ExecuteActionResult[] = [];
  const executedOk: Array<{ actionId: string; toolName: string; ok: boolean; summary: string; error?: string }> = [];

  for (const action of plan.actions) {
    if (action.status === 'blocked') {
      results.push({
        actionId: action.id,
        status: 'blocked',
        summary: `${action.toolName}: blocked by safety policy`,
        error: 'Blocked by safety policy',
      });
      continue;
    }

    if (rejectedActionIds.includes(action.id)) {
      results.push({
        actionId: action.id,
        status: 'skipped',
        summary: `${action.toolName}: rejected by user`,
      });
      continue;
    }

    if (!approvedActionIds.includes(action.id)) {
      results.push({
        actionId: action.id,
        status: 'skipped',
        summary: `${action.toolName}: not approved`,
      });
      continue;
    }

    if (action.approvalPolicy === 'blocked') {
      results.push({
        actionId: action.id,
        status: 'blocked',
        summary: `${action.toolName}: blocked by safety policy`,
        error: 'Blocked by safety policy',
      });
      continue;
    }

    try {
      const context: ToolRunContext = {
        cwd: process.cwd(),
        approved: true,
        source: 'web',
      };
      const toolResult = await runTool(action.toolName, action.input as Record<string, unknown>, context);
      const outputPreview = toolResult.summary ? truncateOutput(stripSecrets(toolResult.summary), 500) : undefined;
      results.push({
        actionId: action.id,
        status: toolResult.ok ? 'executed' : 'failed',
        summary: `${action.toolName}: ${toolResult.summary}`,
        outputPreview,
        error: toolResult.error,
      });
      executedOk.push({
        actionId: action.id,
        toolName: action.toolName,
        ok: toolResult.ok,
        summary: toolResult.summary,
        error: toolResult.error,
      });
    } catch (err: unknown) {
      const e = err as Error;
      results.push({
        actionId: action.id,
        status: 'failed',
        summary: `${action.toolName}: execution error`,
        error: e.message,
      });
      executedOk.push({
        actionId: action.id,
        toolName: action.toolName,
        ok: false,
        summary: `Execution error: ${e.message}`,
        error: e.message,
      });
    }
  }

  const toolContextForAi = buildToolContextForAi(executedOk, plan);

  return {
    planId,
    results,
    toolContextForAi,
  };
}

function buildToolContextForAi(
  executed: Array<{ actionId: string; toolName: string; ok: boolean; summary: string; error?: string }>,
  plan: AgentToolPlan,
): string {
  if (executed.length === 0) {
    if (plan.blocked) return 'All tool actions were blocked by safety policy.';
    return 'No tool actions were executed.';
  }

  const lines: string[] = [];
  lines.push(`[Tool Results: ${executed.length} action(s) executed]`);
  for (const r of executed) {
    const status = r.ok ? 'OK' : 'ERROR';
    lines.push(`  ${status} ${r.toolName}: ${truncateOutput(stripSecrets(r.summary), 300)}`);
    if (r.error) {
      lines.push(`    Error: ${truncateOutput(stripSecrets(r.error), 200)}`);
    }
  }
  return lines.join('\n');
}

export function resetPlans(): void {
  plans.clear();
}

export function getStoredPlan(planId: string): AgentToolPlan | undefined {
  return plans.get(planId);
}
