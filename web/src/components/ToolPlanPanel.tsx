import React, { useState, useCallback } from 'react';
import ToolActionCard from './ToolActionCard.js';
import type { PlanAction, ActionResult } from './ToolActionCard.js';

interface ToolPlanPanelProps {
  planId: string;
  actions: PlanAction[];
  hasBlockedActions: boolean;
  hasExecutableActions: boolean;
  onExecute: (planId: string, approvedActionIds: string[], rejectedActionIds: string[]) => Promise<void>;
  sessionId?: string;
}

export default function ToolPlanPanel({ planId, actions, hasBlockedActions, hasExecutableActions, onExecute, sessionId }: ToolPlanPanelProps) {
  const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set());
  const [rejectedIds, setRejectedIds] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Map<string, ActionResult>>(new Map());
  const [executing, setExecuting] = useState(false);
  const [executed, setExecuted] = useState(false);

  const handleApprove = useCallback((actionId: string) => {
    setApprovedIds(prev => {
      const next = new Set(prev);
      next.add(actionId);
      return next;
    });
    setRejectedIds(prev => {
      const next = new Set(prev);
      next.delete(actionId);
      return next;
    });
  }, []);

  const handleReject = useCallback((actionId: string) => {
    setRejectedIds(prev => {
      const next = new Set(prev);
      next.add(actionId);
      return next;
    });
    setApprovedIds(prev => {
      const next = new Set(prev);
      next.delete(actionId);
      return next;
    });
  }, []);

  const handleExecute = useCallback(async () => {
    setExecuting(true);
    try {
      await onExecute(planId, Array.from(approvedIds), Array.from(rejectedIds));
    } finally {
      setExecuting(false);
    }
  }, [planId, approvedIds, rejectedIds, onExecute]);

  const setResultsFromExecute = useCallback((newResults: ActionResult[]) => {
    const map = new Map<string, ActionResult>();
    for (const r of newResults) {
      map.set(r.actionId, r);
    }
    setResults(map);
    setExecuted(true);
  }, []);

  if (actions.length === 0) return null;

  const hasDecisions = approvedIds.size > 0 || rejectedIds.size > 0;
  const pendingCount = actions.filter(a => a.status !== 'blocked' && !approvedIds.has(a.id) && !rejectedIds.has(a.id)).length;

  return (
    <div className="tool-plan-panel">
      <div className="tool-plan-header">
        <span className="tool-plan-title">Agent Actions</span>
        {hasBlockedActions && (
          <span className="tool-plan-warning">Includes blocked actions</span>
        )}
      </div>

      <div className="tool-plan-actions">
        {actions.map(a => (
          <ToolActionCard
            key={a.id}
            action={a}
            approved={approvedIds.has(a.id)}
            rejected={rejectedIds.has(a.id)}
            result={results.get(a.id)}
            onApprove={handleApprove}
            onReject={handleReject}
          />
        ))}
      </div>

      {!executed && (hasExecutableActions) && (
        <div className="tool-plan-footer">
          {hasDecisions && (
            <span className="tool-plan-count">
              {approvedIds.size} approved, {rejectedIds.size} rejected
              {pendingCount > 0 ? `, ${pendingCount} pending` : ''}
            </span>
          )}
          {!hasDecisions && !hasBlockedActions && (
            <span className="tool-plan-hint">Select actions to approve or reject</span>
          )}
          {hasDecisions && !executing && (
            <button
              className="btn-execute"
              onClick={handleExecute}
              disabled={approvedIds.size === 0}
            >
              Execute approved ({approvedIds.size})
            </button>
          )}
          {executing && (
            <span className="tool-plan-executing">Executing...</span>
          )}
        </div>
      )}
    </div>
  );
}

export type { PlanAction, ActionResult };
