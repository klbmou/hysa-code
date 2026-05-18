import React from 'react';

interface TopBarProps {
  status: { provider: string; model: string; tier: string; git: { branch: string | null; hasChanges: boolean } | null } | null;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

export default function TopBar({ status, sidebarOpen, onToggleSidebar }: TopBarProps) {
  return (
    <div className="topbar">
      <span className="topbar-logo">HYSA</span>
      <div className="topbar-items">
        {status && (
          <>
            <span className="topbar-pill">{status.provider}</span>
            <span className="topbar-pill">{status.model}</span>
            {status.tier && (
              <span className="topbar-pill">{status.tier}</span>
            )}
            {status.git && (
              <span className={`topbar-git ${status.git.hasChanges ? 'dirty' : ''}`}>
                {status.git.branch || '(none)'}
                {status.git.hasChanges && <span> ●</span>}
              </span>
            )}
          </>
        )}
      </div>
      <button className="topbar-toggle" onClick={onToggleSidebar}>
        {sidebarOpen ? 'Hide Files' : 'Files'}
      </button>
    </div>
  );
}
