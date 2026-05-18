import React from 'react';

interface StatusBarProps {
  fileCount: number;
  loading: boolean;
  messageCount: number;
  yolo: boolean;
}

export default function StatusBar({ fileCount, loading, messageCount, yolo }: StatusBarProps) {
  return (
    <div className="statusbar">
      <div className="statusbar-left">
        <span className="statusbar-item">HYSA Web</span>
        {yolo && <span className="statusbar-item yolo-indicator">[YOLO]</span>}
      </div>
      <div className="statusbar-right">
        <span className="statusbar-item">{fileCount} files</span>
        <span className="statusbar-item">{messageCount} messages</span>
        {loading && <span className="statusbar-item thinking-dot">Thinking</span>}
      </div>
    </div>
  );
}
