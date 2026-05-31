import React, { useState } from 'react';

interface ToolEventProps {
  type: 'read' | 'edit' | 'done' | 'run' | 'error' | 'fallback' | 'search' | 'file' | 'image';
  message: string;
}

const LABELS: Record<string, string> = {
  read: 'Read',
  edit: 'Edit',
  done: 'Done',
  run: 'Run',
  error: 'Error',
  fallback: 'Fallback',
  search: 'Search',
  file: 'File',
  image: 'Image',
};

const ICONS: Record<string, string> = {
  read: '>',
  edit: '+/-',
  done: 'OK',
  run: '->',
  error: '!!',
  fallback: '~>',
  search: '~',
  file: '+',
  image: '*',
};

export default function ToolEvent({ type, message }: ToolEventProps) {
  const [collapsed, setCollapsed] = useState(type === 'fallback');

  if (type === 'fallback') {
    return (
      <div className="tool-status fallback" onClick={() => setCollapsed(!collapsed)}>
        <span className="tool-status-label">{collapsed ? '▸' : '▾'} Fallback</span>
        <span className="tool-status-msg">{collapsed ? 'Click for details' : message}</span>
      </div>
    );
  }

  return (
    <div className={`tool-status ${type}`}>
      <span className="tool-status-icon">{ICONS[type] || '*'}</span>
      <span className="tool-status-label">{LABELS[type] || type}</span>
      <span className="tool-status-msg">{message}</span>
    </div>
  );
}