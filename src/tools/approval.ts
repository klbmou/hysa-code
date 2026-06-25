import type { ToolDefinition, ToolRiskLevel, ToolRunContext } from './types.js';
import { classifyCommand } from '../utils/commands.js';

const DANGEROUS_COMMAND_BLOCKLIST: RegExp[] = [
  /^format\s+/i,
  /^shutdown\s+/i,
  /^poweroff\s+/i,
  /^reboot\s+/i,
  /reg\s+(add|delete|import|copy|save|restore|unload)/i,
  /regedit/i,
  /Remove-Item.*-Recurse/i,
  /Stop-Computer/i,
  /Restart-Computer/i,
  /Clear-EventLog/i,
  /wevtutil\s+cl/i,
  /vssadmin\s+delete/i,
  /bcdedit/i,
  /diskpart/i,
  /net\s+(user|localgroup)\s+\/add/i,
  /netsh\s+wlan\s+export/i,
  /sekurlsa/i,
  /mimikatz/i,
];

export function classifyToolRisk(tool: ToolDefinition): ToolRiskLevel {
  return tool.riskLevel;
}

export function requiresApproval(tool: ToolDefinition, input?: Record<string, unknown>): boolean {
  if (tool.approvalPolicy === 'blocked') return true;
  if (tool.approvalPolicy === 'requires_approval') return true;
  if (tool.name === 'run_command' && input?.command && typeof input.command === 'string') {
    if (isDangerousCommand(input.command)) return true;
  }
  return false;
}

export function isDangerousCommand(command: string): boolean {
  if (classifyCommand(command) === 'dangerous') return true;
  for (const pattern of DANGEROUS_COMMAND_BLOCKLIST) {
    if (pattern.test(command)) return true;
  }
  return false;
}

export function assertApprovedOrDryRun(tool: ToolDefinition, context: ToolRunContext, input?: Record<string, unknown>): void {
  if (context.dryRun) return;
  if (context.approved) return;
  if (tool.approvalPolicy === 'blocked') {
    throw new Error(`Tool "${tool.name}" is blocked and cannot be executed`);
  }
  if (requiresApproval(tool, input)) {
    throw new Error(`Tool "${tool.name}" requires approval. Pass approved=true or use dryRun=true to preview`);
  }
}

export function createApprovalRequest(tool: ToolDefinition, input: Record<string, unknown>): {
  toolName: string;
  description: string;
  riskLevel: ToolRiskLevel;
  inputSummary: string;
} {
  return {
    toolName: tool.name,
    description: tool.description,
    riskLevel: tool.riskLevel,
    inputSummary: sanitizeToolInputForLog(input),
  };
}

export function sanitizeToolInputForLog(input: Record<string, unknown>): string {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === 'command' && typeof value === 'string') {
      safe[key] = value.length > 120 ? value.slice(0, 120) + '...' : value;
    } else if (key === 'content' && typeof value === 'string') {
      safe[key] = value.length > 100 ? `[${value.length} chars]` : value;
    } else if (typeof value === 'string') {
      safe[key] = value.length > 200 ? value.slice(0, 200) + '...' : value;
    } else {
      safe[key] = String(value);
    }
  }
  return JSON.stringify(safe);
}
