import { planToolActionsForTask, executeApprovedToolPlan } from './tool-planner.js';
import type { AgentToolPlan, ProposedToolAction } from './tool-planner.js';
import type { ExecutedActionSummary } from './execution-loop.js';
import { appendActionLog } from '../tools/action-log.js';
import { getMemoryContextForTask } from './memory-context.js';
import type { MemoryContextResult } from './memory-context.js';

export type AgentObservationType =
  | 'file_read_success'
  | 'file_read_empty'
  | 'file_empty'
  | 'command_failed'
  | 'command_success'
  | 'command_empty_output'
  | 'approval_required'
  | 'blocked'
  | 'write_file_success'
  | 'write_file_skipped'
  | 'list_files_success'
  | 'list_files_empty'
  | 'tool_error'
  | 'no_actions'
  | 'os_action_success'
  | 'os_action_failed';

export interface AgentObservation {
  actionId: string;
  toolName: string;
  type: AgentObservationType;
  detail: string;
}

export type AgentDecision = 'CONTINUE' | 'COMPLETE' | 'STOP' | 'BLOCKED' | 'REPLAN';

export type AgentCompletionReason =
  | 'completed'
  | 'max_iterations'
  | 'max_actions'
  | 'blocked'
  | 'approval_required'
  | 'no_new_actions'
  | 'repeated_action'
  | 'replanned';

export interface AgentStep {
  iteration: number;
  plan: AgentToolPlan;
  executedActions: ExecutedActionSummary[];
  observations: AgentObservation[];
  decision: AgentDecision;
}

export interface AgentExecutionInput {
  userText: string;
  cwd?: string;
  source: 'cli' | 'web' | 'test';
  approvedActionIds?: string[];
  maxIterations?: number;
  maxTotalActions?: number;
  filesMentioned?: string[];
}

export interface AgentExecutionResult {
  steps: AgentStep[];
  allExecutedActions: ExecutedActionSummary[];
  allObservations: AgentObservation[];
  iterationsUsed: number;
  totalActions: number;
  stoppedReason: AgentCompletionReason;
  toolContextForAi: string;
  memoryUsed?: boolean;
  memoryHits?: number;
}

const DEFAULT_MAX_ITERATIONS = 3;
const DEFAULT_MAX_TOTAL_ACTIONS = 20;

/**
 * Deterministic observation: turn a tool execution result into a structured observation.
 */
const OS_TOOLS = new Set(['move_mouse', 'click_mouse', 'type_keyboard', 'press_key']);

export function observe(action: ExecutedActionSummary): AgentObservation {
  const { actionId, toolName, ok, summary, error } = action;

  if (OS_TOOLS.has(toolName)) {
    if (!ok) {
      if (summary.includes('approval') || summary.includes('requires approval')) {
        return { actionId, toolName, type: 'approval_required', detail: summary };
      }
      if (summary.includes('blocked') || summary.includes('safety policy')) {
        return { actionId, toolName, type: 'blocked', detail: summary };
      }
      return { actionId, toolName, type: 'os_action_failed', detail: error || summary || 'Unknown error' };
    }
    if (ok) {
      return { actionId, toolName, type: 'os_action_success', detail: summary };
    }
    return { actionId, toolName, type: 'os_action_failed', detail: error || summary || 'Unknown error' };
  }

  if (!ok && error) {
    if (toolName === 'run_command') {
      return { actionId, toolName, type: 'command_failed', detail: error };
    }
    if (toolName === 'read_file') {
      return { actionId, toolName, type: 'file_read_empty', detail: error };
    }
    return { actionId, toolName, type: 'tool_error', detail: error };
  }

  if (ok) {
    const lower = summary.toLowerCase();
    if (toolName === 'read_file') {
      if (lower.includes('not found') || lower.includes('empty') || /\b0\s+lines?\b/.test(lower) || lower.includes('no content')) {
        return { actionId, toolName, type: 'file_empty', detail: summary };
      }
      return { actionId, toolName, type: 'file_read_success', detail: summary };
    }
    if (toolName === 'run_command') {
      if (lower.includes('(empty output)') || lower.includes('no output')) {
        return { actionId, toolName, type: 'command_empty_output', detail: summary };
      }
      return { actionId, toolName, type: 'command_success', detail: summary };
    }
    if (toolName === 'write_file') {
      return { actionId, toolName, type: 'write_file_success', detail: summary };
    }
    if (toolName === 'list_files') {
      return { actionId, toolName, type: 'list_files_success', detail: summary };
    }
    return { actionId, toolName, type: 'tool_error', detail: summary };
  }

  if (summary.includes('approval') || summary.includes('requires approval')) {
    return { actionId, toolName, type: 'approval_required', detail: summary };
  }
  if (summary.includes('blocked') || summary.includes('safety policy')) {
    return { actionId, toolName, type: 'blocked', detail: summary };
  }

  return { actionId, toolName, type: 'tool_error', detail: error || summary || 'Unknown error' };
}

/**
 * Determine whether the agent should continue, complete, or stop based on observations.
 */
export function decide(
  observations: AgentObservation[],
  executedActions: ExecutedActionSummary[],
  iteration: number,
  maxIterations: number,
  totalActions: number,
  maxTotalActions: number,
): AgentDecision {
  if (iteration >= maxIterations) return 'STOP';
  if (totalActions >= maxTotalActions) return 'STOP';

  for (const obs of observations) {
    if (obs.type === 'blocked') return 'BLOCKED';
    if (obs.type === 'approval_required') return 'STOP';
  }

  if (executedActions.length === 0) return 'COMPLETE';

  const hasOsFailure = observations.some(o => o.type === 'os_action_failed');
  if (hasOsFailure) return 'REPLAN';

  const allFailed = executedActions.length > 0 && executedActions.every(a => !a.ok);
  if (allFailed) return 'COMPLETE';

  const hasReadSuccess = observations.some(o => o.type === 'file_read_success');
  const hasCommandFail = observations.some(o => o.type === 'command_failed');
  const hasCommandSuccess = observations.some(o => o.type === 'command_success');
  const hasOsSuccess = observations.some(o => o.type === 'os_action_success');

  if (hasReadSuccess) return 'CONTINUE';
  if (hasOsSuccess) return 'CONTINUE';
  if (hasCommandSuccess) return 'COMPLETE';
  if (hasCommandFail) return 'COMPLETE';

  return 'COMPLETE';
}

/**
 * Build a fingerprint string for an action to detect duplicates across iterations.
 */
function actionFingerprint(action: ProposedToolAction): string {
  return `${action.toolName}:${JSON.stringify(sortKeys(action.input))}`;
}

function sortKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = obj[key];
  }
  return sorted;
}

/**
 * Check if a new plan contains actions that are identical to already-executed actions.
 * Uses precise parameter matching for OS control tools.
 */
export function hasDuplicateActions(
  newPlan: AgentToolPlan,
  alreadyExecuted: ExecutedActionSummary[],
): boolean {
  const executedFingerprints = new Set(
    alreadyExecuted.map(a => `${a.toolName}:${a.summary.split('(')[0].trim()}`)
  );
  for (const action of newPlan.actions) {
    if (OS_TOOLS.has(action.toolName)) {
      if (hasDuplicateOsAction(action, alreadyExecuted)) return true;
      continue;
    }
    const fp = actionFingerprint(action);
    for (const efp of executedFingerprints) {
      if (fp.includes(efp) || efp.includes(fp)) return true;
    }
  }
  return false;
}

/**
 * Precise duplicate detection for OS control actions using parameter matching.
 */
function hasDuplicateOsAction(
  action: ProposedToolAction,
  alreadyExecuted: ExecutedActionSummary[],
): boolean {
  const input = action.input as Record<string, unknown>;
  for (const executed of alreadyExecuted) {
    if (executed.toolName !== action.toolName) continue;
    if (doOsInputsMatch(action.toolName, input, executed.summary)) return true;
  }
  return false;
}

function doOsInputsMatch(
  toolName: string,
  proposedInput: Record<string, unknown>,
  executedSummary: string,
): boolean {
  switch (toolName) {
    case 'move_mouse': {
      const match = executedSummary.match(/\((\d+),\s*(\d+)\)/);
      if (!match) return false;
      return Number(proposedInput.x) === parseInt(match[1], 10) &&
             Number(proposedInput.y) === parseInt(match[2], 10);
    }
    case 'click_mouse': {
      const button = (proposedInput.button as string) || 'left';
      const count = Number(proposedInput.count) || 1;
      const lower = executedSummary.toLowerCase();
      return lower.includes(button) && lower.includes(`${count} time`);
    }
    case 'type_keyboard': {
      const text = proposedInput.text as string;
      const charLen = text?.length || 0;
      return executedSummary.includes(`${charLen} character`);
    }
    case 'press_key': {
      const key = (proposedInput.key as string) || '';
      return executedSummary.toLowerCase().includes(`: ${key.toLowerCase()}`) ||
             executedSummary.toLowerCase().endsWith(key.toLowerCase());
    }
    default:
      return false;
  }
}

/**
 * Build a text summary of the current execution state for the replanner.
 */
function buildReplanningText(
  originalGoal: string,
  executedActions: ExecutedActionSummary[],
  observations: AgentObservation[],
): string {
  const lines: string[] = [originalGoal];
  lines.push('');
  lines.push('[Previous actions]');
  for (let i = 0; i < executedActions.length; i++) {
    const a = executedActions[i];
    const status = a.ok ? 'done' : 'failed';
    lines.push(`  ${i + 1}. ${a.toolName}: ${status} — ${a.summary}`);
  }
  lines.push('');
  lines.push('[Observations]');
  for (const obs of observations) {
    lines.push(`  ${obs.type}: ${obs.detail.slice(0, 200)}`);
  }
  return lines.join('\n');
}

/**
 * Determine task kind for replanning based on observations.
 */
function deriveTaskKind(originalTaskKind: string, observations: AgentObservation[]): string {
  const hasFailure = observations.some(o =>
    o.type === 'command_failed' || o.type === 'tool_error'
  );
  if (hasFailure) return 'debug_error';
  return originalTaskKind;
}

/**
 * Extract file patterns from a user text (simple heuristic: quoted paths and path-like tokens).
 */
function extractFilePatterns(text: string): string[] {
  const patterns: string[] = [];
  const quotedRe = /['"`]([^'"`]+)['"`]/g;
  let m: RegExpExecArray | null;
  while ((m = quotedRe.exec(text)) !== null) {
    if (m[1].includes('.') || m[1].includes('/') || m[1].includes('\\')) {
      patterns.push(m[1]);
    }
  }
  const pathRe = /(\S+\.\w{1,4})/g;
  while ((m = pathRe.exec(text)) !== null) {
    patterns.push(m[1]);
  }
  return [...new Set(patterns)];
}

/**
 * Create the next plan based on prior execution results.
 * Deterministic — no AI calls.
 */
export function createNextPlan(
  originalGoal: string,
  originalTaskKind: string,
  originalFilesMentioned: string[],
  priorActions: ExecutedActionSummary[],
  observations: AgentObservation[],
  memoryContext?: MemoryContextResult,
): AgentToolPlan | null {
  const accessedFiles = new Set(
    priorActions
      .filter(a => a.toolName === 'read_file' && a.ok)
      .map(a => a.summary.split(':')[0].trim())
      .filter(Boolean)
  );

  const hasFailedCommand = priorActions.some(a => !a.ok && a.toolName === 'run_command');
  const hasCommandFailure = observations.some(o => o.type === 'command_failed');
  const hasOsFailure = observations.some(o => o.type === 'os_action_failed');
  const hasBlocked = observations.some(o => o.type === 'blocked');
  const hasApprovalStop = observations.some(o => o.type === 'approval_required');

  if (hasBlocked || hasApprovalStop) return null;
  if (priorActions.length === 0) return null;

  // OS failure: replan with different approach
  if (hasOsFailure) {
    const failedAction = priorActions.find(a =>
      !a.ok && OS_TOOLS.has(a.toolName)
    );
    const hint = failedAction
      ? `OS action "${failedAction.toolName}" failed: ${failedAction.error || failedAction.summary}. Try a different approach. ${originalGoal}`
      : `OS action failed. Try a different approach. ${originalGoal}`;
    const taskKind = 'os_control';
    return planToolActionsForTask({
      userText: hint,
      taskKind,
      filesMentioned: originalFilesMentioned.length > 0 ? originalFilesMentioned : undefined,
      memoryContext,
    });
  }

  const filesFromGoal = originalFilesMentioned.length > 0
    ? originalFilesMentioned
    : extractFilePatterns(originalGoal);

  // If a command failed and we haven't read config files yet, plan to read them
  if (hasFailedCommand || hasCommandFailure) {
    const configFiles = filesFromGoal.filter(f =>
      !accessedFiles.has(f) &&
      (f.endsWith('.json') || f.endsWith('.ts') || f.endsWith('.js') || f.endsWith('.toml') || f.endsWith('.yaml') || f.endsWith('.yml'))
    );
    if (configFiles.length > 0 || filesFromGoal.length === 0) {
      const replanText = hasCommandFailure
        ? `Debug build failure. Read configuration files to find the issue. ${originalGoal}`
        : originalGoal;
      const taskKind = deriveTaskKind(originalTaskKind, observations);
      return planToolActionsForTask({ userText: replanText, taskKind, filesMentioned: configFiles.length > 0 ? configFiles : undefined, memoryContext });
    }
  }

  // If we read files successfully, check for unread patterns from the original goal
  if (observations.some(o => o.type === 'file_read_success')) {
    const unreadFiles = filesFromGoal.filter(f => !accessedFiles.has(f));
    if (unreadFiles.length > 0) {
      return planToolActionsForTask({
        userText: `Read ${unreadFiles.join(' ')} as part of: ${originalGoal}`,
        taskKind: originalTaskKind,
        filesMentioned: unreadFiles,
        memoryContext,
      });
    }
  }

  // If no new files to read but there are remaining patterns, try again
  const replanText = buildReplanningText(originalGoal, priorActions, observations);
  const taskKind = deriveTaskKind(originalTaskKind, observations);
  const plan = planToolActionsForTask({ userText: replanText, taskKind, filesMentioned: filesFromGoal.length > 0 ? filesFromGoal : undefined, memoryContext });
  return plan;
}

/**
 * Run the full multi-step agent loop.
 */
export async function executeMultiStepPlan(input: AgentExecutionInput): Promise<AgentExecutionResult> {
  const maxIterations = input.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const maxTotalActions = input.maxTotalActions ?? DEFAULT_MAX_TOTAL_ACTIONS;
  const cwd = input.cwd ?? process.cwd();

  const steps: AgentStep[] = [];
  const allExecutedActions: ExecutedActionSummary[] = [];
  const allObservations: AgentObservation[] = [];
  let stoppedReason: AgentCompletionReason = 'completed';
  let lastPlan: AgentToolPlan | null = null;

  // ── Gather memory context for planning ──
  const memoryContext = await getMemoryContextForTask({
    task: input.userText,
  }).catch(() => undefined);

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    // ── Plan ──
    const plan: AgentToolPlan | null = iteration === 0
      ? planToolActionsForTask({ userText: input.userText, filesMentioned: input.filesMentioned, memoryContext })
      : createNextPlan(input.userText, (lastPlan as AgentToolPlan).taskKind || '', input.filesMentioned || [], allExecutedActions, allObservations, memoryContext);

    if (!plan) {
      stoppedReason = 'no_new_actions';
      break;
    }

    if (allExecutedActions.length > 0 && hasDuplicateActions(plan, allExecutedActions)) {
      stoppedReason = 'repeated_action';
      break;
    }

    if (totalActionCount(allExecutedActions, plan.actions) > maxTotalActions) {
      stoppedReason = 'max_actions';
      break;
    }

    lastPlan = plan;

    // ── Execute ──
    const executeContext = { cwd, approved: false, source: input.source as 'cli' | 'web' | 'test' };
    const executedActions = await executeApprovedToolPlan(plan, executeContext);

    for (const a of executedActions) {
      try {
        appendActionLog({
          timestamp: new Date().toISOString(),
          toolName: a.toolName,
          riskLevel: 'safe',
          approved: true,
          dryRun: false,
          source: input.source,
          cwd,
          inputSummary: `Multi-step iteration ${iteration + 1}: ${a.toolName} (${a.actionId})`,
          resultSummary: a.summary,
          error: a.error,
        });
      } catch { /* non-fatal */ }
    }

    allExecutedActions.push(...executedActions);

    // ── Observe ──
    const observations: AgentObservation[] = executedActions.map(observe);
    allObservations.push(...observations);

    // ── Decide ──
    const totalSoFar = allExecutedActions.length;
    const decision = decide(observations, executedActions, iteration + 1, maxIterations, totalSoFar, maxTotalActions);

    steps.push({ iteration, plan, executedActions, observations, decision });

    if (decision === 'COMPLETE') {
      stoppedReason = 'completed';
      break;
    }
    if (decision === 'REPLAN') {
      // Replan: don't break, continue to next iteration for a new plan
      // The loop's for-increment handles iteration counting naturally
      continue;
    }
    if (decision === 'STOP') {
      stoppedReason = 'max_iterations';
      break;
    }
    if (decision === 'BLOCKED') {
      stoppedReason = 'blocked';
      break;
    }

    // CONTINUE: loop to next iteration
  }

  if (steps.length === 0) {
    stoppedReason = 'no_new_actions';
  }

  // Build tool context for AI synthesis
  const toolContextForAi = buildMultiStepContext(allExecutedActions, allObservations, stoppedReason);

  return {
    steps,
    allExecutedActions,
    allObservations,
    iterationsUsed: steps.length,
    totalActions: allExecutedActions.length,
    stoppedReason,
    toolContextForAi,
    memoryUsed: memoryContext?.memoryUsed,
    memoryHits: memoryContext?.memoryHits,
  };
}

function totalActionCount(existing: ExecutedActionSummary[], newActions: ProposedToolAction[]): number {
  return existing.length + newActions.length;
}

/**
 * Build a unified tool context string from all steps.
 */
function buildMultiStepContext(
  actions: ExecutedActionSummary[],
  observations: AgentObservation[],
  reason: AgentCompletionReason,
): string {
  const lines: string[] = [];
  lines.push(`[Multi-Step Agent: ${actions.length} action(s) across ${observations.length} observation(s)]`);

  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    const obs = observations[i] || null;
    const status = a.ok ? 'OK' : 'ERROR';
    const obsDetail = obs ? ` → ${obs.type}` : '';
    lines.push(`  ${status} ${a.toolName}: ${a.summary}${obsDetail}`);
    if (a.error) {
      lines.push(`    Error: ${a.error}`);
    }
  }

  lines.push('');
  lines.push(`[Stop reason: ${reason}]`);
  if (reason === 'blocked') lines.push('Some actions were blocked by safety policy.');
  if (reason === 'max_iterations' || reason === 'max_actions') lines.push('Iteration/action limit reached.');
  if (reason === 'repeated_action') lines.push('No new actions to perform.');
  if (reason === 'replanned') lines.push('Replanned due to OS action failure — reached max iteration budget.');
  if (reason === 'approval_required') lines.push('Some actions require approval and were skipped.');

  return lines.join('\n');
}
