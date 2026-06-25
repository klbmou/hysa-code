import { planToolActionsForTask, executeApprovedToolPlan, formatPlanForDisplay } from './tool-planner.js';
import type { AgentToolPlan, ProposedToolAction } from './tool-planner.js';
import { appendActionLog } from '../tools/action-log.js';

export interface ToolExecutionLoopInput {
  userText: string;
  cwd: string;
  source: 'cli' | 'web' | 'test';
  approvedActionIds?: string[];
  dryRun?: boolean;
  sessionId?: string;
  filesMentioned?: string[];
}

export interface ExecutedActionSummary {
  actionId: string;
  toolName: string;
  ok: boolean;
  summary: string;
  error?: string;
}

export interface ToolExecutionLoopResult {
  plan: AgentToolPlan;
  executedActions: ExecutedActionSummary[];
  pendingApproval: ProposedToolAction[];
  blockedActions: ProposedToolAction[];
  toolContextForAi: string;
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

function buildToolContext(executed: ExecutedActionSummary[], plan: AgentToolPlan): string {
  if (executed.length === 0) {
    if (plan.blocked) return 'All tool actions were blocked by safety policy.';
    if (plan.actions.some(a => a.status === 'requires_approval')) {
      return 'Tool actions require approval before execution. Use --approve with specific action IDs.';
    }
    return 'No tool actions were proposed for this task.';
  }

  const lines: string[] = [];
  lines.push(`[Tool Results: ${executed.length} action(s) executed]`);
  for (const r of executed) {
    const status = r.ok ? '✓' : '✗';
    lines.push(`  ${status} ${r.toolName}: ${truncateOutput(stripSecrets(r.summary), 300)}`);
    if (r.error) {
      lines.push(`    Error: ${truncateOutput(stripSecrets(r.error), 200)}`);
    }
  }
  return lines.join('\n');
}

async function executeWithApproval(
  plan: AgentToolPlan,
  approvedActionIds: string[],
  context: { cwd: string; approved: boolean; source: 'cli' | 'web' | 'test' },
): Promise<ExecutedActionSummary[]> {
  const readyActions = plan.actions.filter(a => {
    if (a.status === 'blocked') return false;
    if (a.status === 'ready') return true;
    if (a.status === 'requires_approval') {
      return approvedActionIds.includes(a.id);
    }
    return false;
  });

  if (readyActions.length === 0) return [];

  const approvedPlan: AgentToolPlan = {
    ...plan,
    actions: readyActions.map(a => ({
      ...a,
      status: (a.status === 'requires_approval' && approvedActionIds.includes(a.id))
        ? 'ready'
        : a.status,
    })),
  };

  const results = await executeApprovedToolPlan(approvedPlan, context);

  return results.map(r => ({
    actionId: r.actionId,
    toolName: r.toolName,
    ok: r.ok,
    summary: truncateOutput(r.summary, 500),
    error: r.error ? truncateOutput(r.error, 300) : undefined,
  }));
}

export async function runToolExecutionLoop(input: ToolExecutionLoopInput): Promise<ToolExecutionLoopResult> {
  const dryRun = input.dryRun !== false;
  const cwd = input.cwd || process.cwd();

  // Build plan
  const plan = planToolActionsForTask({
    userText: input.userText,
    cwd,
    filesMentioned: input.filesMentioned,
  });

  const approvedActionIds = input.approvedActionIds || [];
  const executedActions: ExecutedActionSummary[] = [];
  const pendingApproval: ProposedToolAction[] = [];
  const blockedActions: ProposedToolAction[] = [];

  // Classify actions
  for (const action of plan.actions) {
    if (action.status === 'blocked') {
      blockedActions.push(action);
    } else if (action.status === 'requires_approval' && !approvedActionIds.includes(action.id)) {
      pendingApproval.push(action);
    }
  }

  // Execute approved/ready actions
  if (!dryRun && !plan.blocked) {
    const approvedCtx = {
      cwd,
      approved: approvedActionIds.length > 0,
      source: input.source,
    };

    const results = await executeWithApproval(plan, approvedActionIds, {
      ...approvedCtx,
      approved: approvedActionIds.length > 0,
    });

    for (const r of results) {
      executedActions.push(r);
    }
  }

  // Log each execution
  for (const r of executedActions) {
    appendActionLog({
      timestamp: new Date().toISOString(),
      toolName: r.toolName,
      riskLevel: 'safe',
      approved: true,
      dryRun: false,
      source: input.source,
      cwd,
      inputSummary: `Execution loop: ${r.toolName} (${r.actionId})`,
      resultSummary: r.summary,
      error: r.error,
      sessionId: input.sessionId,
    });
  }

  const toolContextForAi = buildToolContext(executedActions, plan);

  return {
    plan,
    executedActions,
    pendingApproval,
    blockedActions,
    toolContextForAi,
  };
}

export function formatExecutionResult(result: ToolExecutionLoopResult): string {
  const lines: string[] = [];
  lines.push(formatPlanForDisplay(result.plan));
  lines.push('');

  if (result.executedActions.length > 0) {
    lines.push(`Executed: ${result.executedActions.length} action(s)`);
    for (const r of result.executedActions) {
      const icon = r.ok ? '✓' : '✗';
      lines.push(`  ${icon} [${r.actionId}] ${r.toolName}: ${r.summary}`);
    }
    lines.push('');
  }

  if (result.pendingApproval.length > 0) {
    lines.push(`Pending approval: ${result.pendingApproval.length} action(s)`);
    for (const a of result.pendingApproval) {
      lines.push(`  ⚠ [${a.id}] ${a.toolName}: ${a.reason}`);
    }
    lines.push('');
  }

  if (result.blockedActions.length > 0) {
    lines.push(`Blocked: ${result.blockedActions.length} action(s)`);
    for (const a of result.blockedActions) {
      lines.push(`  🚫 [${a.id}] ${a.toolName}: ${a.reason}`);
    }
    lines.push('');
  }

  lines.push(`Tool context for AI:`);
  lines.push(result.toolContextForAi);

  return lines.join('\n');
}
