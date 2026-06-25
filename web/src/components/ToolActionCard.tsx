import React from 'react';

export interface PlanAction {
  id: string;
  toolName: string;
  status: 'ready' | 'requires_approval' | 'blocked' | 'proposed';
  summary: string;
  reason: string;
  approvalRequired: boolean;
  blockedReason?: string;
  inputPreview: string;
}

export interface ActionResult {
  actionId: string;
  status: 'executed' | 'skipped' | 'blocked' | 'failed';
  summary: string;
  outputPreview?: string;
  error?: string;
}

const STATUS_LABEL: Record<string, string> = {
  ready: 'Ready',
  requires_approval: 'Needs Approval',
  blocked: 'Blocked',
  proposed: 'Proposed',
};

const STATUS_COLOR: Record<string, string> = {
  ready: '#22c55e',
  requires_approval: '#eab308',
  blocked: '#ef4444',
  proposed: '#60a5fa',
};

interface ToolActionCardProps {
  action: PlanAction;
  approved: boolean;
  rejected: boolean;
  result?: ActionResult;
  onApprove: (actionId: string) => void;
  onReject: (actionId: string) => void;
}

export default function ToolActionCard({ action, approved, rejected, result, onApprove, onReject }: ToolActionCardProps) {
  const isBlocked = action.status === 'blocked';
  const isDecided = approved || rejected;

  return (
    <div className={`tool-action-card${isBlocked ? ' blocked' : ''}${result ? ' has-result' : ''}`}>
      <div className="tool-action-header">
        <span className="tool-action-toolname">{action.toolName}</span>
        <span
          className="tool-action-status"
          style={{ color: STATUS_COLOR[action.status] || '#999' }}
        >
          {STATUS_LABEL[action.status] || action.status}
        </span>
      </div>

      <div className="tool-action-reason">{action.reason}</div>

      {action.inputPreview && (
        <div className="tool-action-input">{action.inputPreview}</div>
      )}

      {isBlocked && action.blockedReason && (
        <div className="tool-action-blocked">Blocked: {action.blockedReason}</div>
      )}

      {!isDecided && !result && (
        <div className="tool-action-buttons">
          {!isBlocked && (
            <button
              className="btn-approve"
              onClick={() => onApprove(action.id)}
              disabled={isDecided}
            >
              Approve
            </button>
          )}
          <button
            className="btn-reject"
            onClick={() => onReject(action.id)}
            disabled={isDecided}
          >
            {isBlocked ? 'Dismiss' : 'Reject'}
          </button>
        </div>
      )}

      {approved && !result && (
        <div className="tool-action-decided approved">Approved — will execute</div>
      )}
      {rejected && (
        <div className="tool-action-decided rejected">Rejected — skipped</div>
      )}

      {result && (
        <div className={`tool-action-result result-${result.status}`}>
          <div className="tool-action-result-status">
            {result.status === 'executed' && '✓ Executed'}
            {result.status === 'skipped' && '— Skipped'}
            {result.status === 'blocked' && 'Blocked'}
            {result.status === 'failed' && '✗ Failed'}
          </div>
          {result.outputPreview && (
            <div className="tool-action-result-output">{result.outputPreview}</div>
          )}
          {result.error && (
            <div className="tool-action-result-error">{result.error}</div>
          )}
        </div>
      )}
    </div>
  );
}
