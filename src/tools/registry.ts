import type { ToolDefinition, ToolResult, ToolRunContext } from './types.js';
import { listFilesTool } from './list-files.js';
import { readFileTool } from './read-file.js';
import { writeFileTool } from './write-file.js';
import { runCommandTool } from './run-command.js';
import { moveMouseTool, clickMouseTool, typeKeyboardTool, pressKeyTool } from './os-control.js';
import { requiresApproval } from './approval.js';
import { appendActionLog } from './action-log.js';

const registry = new Map<string, ToolDefinition>();

export function registerTool(tool: ToolDefinition): void {
  registry.set(tool.name, tool);
}

export function getTool(name: string): ToolDefinition | undefined {
  return registry.get(name);
}

export function listTools(): ToolDefinition[] {
  return Array.from(registry.values());
}

export function getToolNames(): string[] {
  return Array.from(registry.keys());
}

registerTool(listFilesTool);
registerTool(readFileTool);
registerTool(writeFileTool);
registerTool(runCommandTool);
registerTool(moveMouseTool);
registerTool(clickMouseTool);
registerTool(typeKeyboardTool);
registerTool(pressKeyTool);

export async function runTool(
  name: string,
  input: Record<string, unknown>,
  context: ToolRunContext,
): Promise<ToolResult> {
  const tool = registry.get(name);
  if (!tool) {
    return { ok: false, error: `Unknown tool: "${name}"`, summary: `Unknown tool: "${name}"` };
  }

  const needsApproval = requiresApproval(tool, input);
  const startTime = Date.now();

  try {
    const result = await tool.run(input as any, context);

    const elapsed = Date.now() - startTime;
    appendActionLog({
      timestamp: new Date().toISOString(),
      toolName: name,
      riskLevel: tool.riskLevel,
      approved: !!context.approved,
      dryRun: !!context.dryRun,
      source: context.source,
      cwd: context.cwd,
      inputSummary: JSON.stringify(input).slice(0, 300),
      resultSummary: result.summary.slice(0, 300),
      error: result.error,
      sessionId: context.sessionId,
    });

    return result;
  } catch (err: unknown) {
    const e = err as Error;
    const elapsed = Date.now() - startTime;
    appendActionLog({
      timestamp: new Date().toISOString(),
      toolName: name,
      riskLevel: tool.riskLevel,
      approved: !!context.approved,
      dryRun: !!context.dryRun,
      source: context.source,
      cwd: context.cwd,
      inputSummary: JSON.stringify(input).slice(0, 300),
      resultSummary: `Error: ${e.message}`,
      error: e.message,
      sessionId: context.sessionId,
    });
    return { ok: false, error: e.message, summary: `Tool "${name}" failed: ${e.message}` };
  }
}
