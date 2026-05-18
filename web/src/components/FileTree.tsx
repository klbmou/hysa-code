import React, { useState } from 'react';

interface FileTreeProps {
  files: string[];
  fileCount: number;
  selectedFile: string | null;
  onSelect: (path: string) => void;
  collapsed: boolean;
  onClose: () => void;
}

const FILE_ICONS: Record<string, string> = {
  ts: '🟦', tsx: '⚛️', js: '🟨', jsx: '⚛️', json: '📋',
  md: '📝', css: '🎨', html: '🌐', py: '🐍', rs: '🦀',
  go: '🔷', java: '☕', c: '⚙️', cpp: '⚙️', h: '⚙️',
  yaml: '📋', yml: '📋', toml: '📋', sh: '💻', bash: '💻',
  sql: '🗃️', lock: '🔒', gitignore: '🙈',
};

function getIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return FILE_ICONS[ext] || '📄';
}

export default function FileTree({ files, fileCount, selectedFile, onSelect, collapsed, onClose }: FileTreeProps) {
  const [search, setSearch] = useState('');

  const filtered = search
    ? files.filter(f => f.toLowerCase().includes(search.toLowerCase()))
    : files;

  return (
    <div className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        <span className="sidebar-title">Files ({fileCount})</span>
        <button className="sidebar-close" onClick={onClose}>✕</button>
      </div>
      <div className="sidebar-search">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search files..."
        />
      </div>
      <div className="sidebar-files">
        {filtered.map((f) => (
          <div
            key={f}
            className={`file-item ${selectedFile === f ? 'active' : ''}`}
            onClick={() => onSelect(f)}
          >
            <span className="file-item-icon">{getIcon(f)}</span>
            <span className="file-item-name">{f}</span>
          </div>
        ))}
        {filtered.length === 0 && !search && (
          <div className="file-item" style={{ color: '#5c5c74', cursor: 'default', fontSize: '12px' }}>
            No project files found
          </div>
        )}
        {filtered.length === 0 && search && (
          <div className="file-item" style={{ color: '#5c5c74', cursor: 'default', fontSize: '12px' }}>
            No files match &quot;{search}&quot;
          </div>
        )}
      </div>
      <div className="sidebar-footer">{fileCount} total files</div>
    </div>
  );
}
