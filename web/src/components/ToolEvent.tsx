import React, { useState } from 'react';

interface ToolEventProps {
  type: 'read' | 'edit' | 'done' | 'run' | 'error' | 'fallback';
  message: string;
}

const ICONS: Record<string, string> = {
  read: '>',
  edit: '+/-',
  done: 'OK',
  run: '->',
  error: '!!',
  fallback: '~>',
};

export default function ToolEvent({ type, message }: ToolEventProps) {
  const [collapsed, setCollapsed] = useState(type === 'fallback');

  if (type === 'fallback') {
    return (
      <div className="tool-event fallback" onClick={() => setCollapsed(!collapsed)}>
        <div className="tool-event-track">
          <div className="tool-event-dot" />
          {!collapsed && <div className="tool-event-line" />}
        </div>
        <span className="tool-event-icon">{collapsed ? '▸' : '▾'}</span>
        <span className="tool-event-msg">{collapsed ? 'Vision fallback details...' : message}</span>
      </div>
    );
  }

  return (
    <div className={`tool-event ${type}`}>
      <div className="tool-event-track">
        <div className="tool-event-dot" />
        <div className="tool-event-line" />
      </div>
      <span className="tool-event-icon">{ICONS[type] || '*'}</span>
      <span className="tool-event-msg">{message}</span>
    </div>
  );
}