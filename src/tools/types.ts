export type ToolRiskLevel = 'safe' | 'review' | 'dangerous';

export type ToolApprovalPolicy =
  | 'auto'
  | 'requires_approval'
  | 'blocked';

export interface ToolRunContext {
  cwd: string;
  dryRun?: boolean;
  approved?: boolean;
  sessionId?: string;
  source: 'cli' | 'web' | 'test';
}

export interface ToolResult<T = unknown> {
  ok: boolean;
  output?: T;
  error?: string;
  summary: string;
  requiresApproval?: boolean;
  approvalReason?: string;
  proposedAction?: unknown;
}

export interface ToolDefinition<Input = unknown, Output = unknown> {
  name: string;
  description: string;
  riskLevel: ToolRiskLevel;
  approvalPolicy: ToolApprovalPolicy;
  inputSchema?: unknown;
  run(input: Input, context: ToolRunContext): Promise<ToolResult<Output>>;
}
