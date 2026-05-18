import React from 'react';

interface StatusBarProps {
  fileCount: number;
  loading: boolean;
  messageCount: number;
}

export default function StatusBar({ fileCount, loading, messageCount }: StatusBarProps) {
  return (
    <div className="statusbar">
      <div className="statusbar-left">
        <span className="statusbar-item">HYSA Web</span>
      </div>
      <div className="statusbar-right">
        <span className="statusbar-item">{fileCount} files</span>
        <span className="statusbar-item">{messageCount} messages</span>
        {loading && <span className="statusbar-item" style={{ color: '#a855f7' }}>● Thinking</span>}
      </div>
    </div>
  );
}
