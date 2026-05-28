import React from 'react';

interface PlanStep {
  description: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  files?: string[];
}

interface ExecutionPlan {
  goal: string;
  steps: PlanStep[];
  riskLevel: 'low' | 'medium' | 'high';
  files: string[];
}

const STATUS_ICON: Record<string, string> = {
  pending: '○',
  running: '◌',
  done: '✓',
  failed: '✕',
};

const RISK_COLOR: Record<string, string> = {
  low: '#22c55e',
  medium: '#eab308',
  high: '#ef4444',
};

function isArabic(text: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(text);
}

interface PlanCardProps {
  plan: ExecutionPlan;
  currentStep?: number;
}

export default function PlanCard({ plan, currentStep }: PlanCardProps) {
  const rtl = isArabic(plan.goal);

  return (
    <div
      style={{
        border: '1px solid var(--vscode-editorWidget-border, #444)',
        borderRadius: '8px',
        padding: '12px 16px',
        margin: '8px 0',
        background: 'var(--vscode-editorWidget-background, #1e1e1e)',
        fontSize: '13px',
        fontFamily: 'var(--vscode-font-family, system-ui)',
        direction: rtl ? 'rtl' : 'ltr',
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: '10px', color: 'var(--vscode-editor-foreground, #ccc)' }}>
        📋 Plan: {plan.goal}
      </div>

      <div style={{ marginBottom: '8px', fontSize: '12px', color: 'var(--vscode-descriptionForeground, #999)' }}>
        Risk:{' '}
        <span style={{ color: RISK_COLOR[plan.riskLevel] || '#999', fontWeight: 500 }}>
          {plan.riskLevel.toUpperCase()}
        </span>
        {plan.files.length > 0 && (
          <span style={{ marginLeft: '12px' }}>
            Files: {plan.files.join(', ')}
          </span>
        )}
      </div>

      {plan.steps.map((step, i) => {
        const isActive = currentStep === i;
        const isPast = currentStep !== undefined && i < currentStep;
        const effectiveStatus = isActive
          ? 'running'
          : isPast
            ? step.status === 'failed' ? 'failed' : 'done'
            : step.status;

        return (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
              padding: '4px 0',
              opacity: effectiveStatus === 'pending' && currentStep !== undefined ? 0.5 : 1,
            }}
          >
            <span
              style={{
                color: effectiveStatus === 'running'
                  ? '#60a5fa'
                  : effectiveStatus === 'done'
                    ? '#22c55e'
                    : effectiveStatus === 'failed'
                      ? '#ef4444'
                      : 'var(--vscode-descriptionForeground, #777)',
                flexShrink: 0,
                fontWeight: effectiveStatus === 'running' ? 700 : 400,
              }}
            >
              {effectiveStatus === 'running' ? '◌' : STATUS_ICON[effectiveStatus] || '○'}
            </span>
            <span
              style={{
                color: effectiveStatus === 'running'
                  ? '#93c5fd'
                  : 'var(--vscode-editor-foreground, #ccc)',
                fontWeight: effectiveStatus === 'running' ? 500 : 400,
              }}
            >
              {step.description}
              {step.files && step.files.length > 0 && (
                <span style={{ color: 'var(--vscode-descriptionForeground, #888)', fontSize: '11px', marginLeft: '6px' }}>
                  ({step.files.join(', ')})
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
