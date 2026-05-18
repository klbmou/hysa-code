import React from 'react';

interface ToolEventProps {
  type: 'read' | 'edit' | 'done' | 'run' | 'error' | 'fallback';
  message: string;
}

const ICONS: Record<string, string> = {
  read: '📖',
  edit: '✏️',
  done: '✅',
  run: '⚡',
  error: '❌',
  fallback: '🔄',
};

export default function ToolEvent({ type, message }: ToolEventProps) {
  return (
    <div className={`tool-event ${type}`}>
      <span className="tool-event-icon">{ICONS[type] || '•'}</span>
      <span>{message}</span>
    </div>
  );
}
