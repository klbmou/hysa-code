import React, { useState, useRef, useEffect } from 'react';
import PixelMark from './PixelMark.js';

interface TopBarProps {
  status: { provider: string; model: string; tier: string; git: { branch: string | null; hasChanges: boolean } | null } | null;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  yolo: boolean;
  onToggleYolo: () => void;
  debug: boolean;
  onToggleDebug: () => void;
  onClearChat: () => void;
  onFilesPage: () => void;
  onLanding: () => void;
  hasItems: boolean;
}

export default function TopBar({ status, sidebarOpen, onToggleSidebar, yolo, onToggleYolo, debug, onToggleDebug, onClearChat, onFilesPage, onLanding, hasItems }: TopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [menuOpen]);

  return (
    <div className="topbar">
      <div className="topbar-left">
        <button className="topbar-sidebar-btn" onClick={onToggleSidebar} title={sidebarOpen ? 'Hide files' : 'Show files'}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <PixelMark size={22} className="topbar-mark" />
        <span className="topbar-logo">HYSA</span>
        {status && (
          <div className="topbar-pills">
            <span className="topbar-pill">{status.provider}</span>
            <span className="topbar-pill pill-model">{status.model}</span>
            {status.git && (
              <span className={`topbar-pill pill-git ${status.git.hasChanges ? 'dirty' : ''}`}>
                {status.git.branch || '(none)'}{status.git.hasChanges ? ' *' : ''}
              </span>
            )}
            <button
              className={`topbar-pill pill-yolo ${yolo ? 'yolo-on' : ''}`}
              onClick={onToggleYolo}
              title={yolo ? 'YOLO mode: ON' : 'YOLO mode: OFF'}
            >
              {yolo ? 'YOLO' : 'Safe'}
            </button>
          </div>
        )}
      </div>
      <div className="topbar-right" ref={menuRef}>
        <button className="topbar-menu-btn" onClick={() => setMenuOpen(!menuOpen)} title="Menu">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="1" />
            <circle cx="19" cy="12" r="1" />
            <circle cx="5" cy="12" r="1" />
          </svg>
        </button>
        {menuOpen && (
          <div className="topbar-menu">
            <button className="topbar-menu-item" onClick={() => { setMenuOpen(false); onClearChat(); }} disabled={!hasItems}>
              Clear chat
            </button>
            <button className="topbar-menu-item" onClick={() => { setMenuOpen(false); onToggleDebug(); }}>
              {debug ? 'Debug: ON' : 'Debug: OFF'}
            </button>
            <button className="topbar-menu-item" onClick={() => { setMenuOpen(false); onLanding(); }}>
              Landing page
            </button>
            <button className="topbar-menu-item" onClick={() => { setMenuOpen(false); onFilesPage(); }}>
              Files page
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
