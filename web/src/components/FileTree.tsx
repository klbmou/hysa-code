import React, { useState } from 'react';

interface FileTreeProps {
  files: string[];
  fileCount: number;
  selectedFile: string | null;
  onSelect: (path: string) => void;
  collapsed: boolean;
  onClose: () => void;
}

function getExtBadge(name: string): { label: string; cls: string } {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, { label: string; cls: string }> = {
    ts: { label: 'TS', cls: 'ext-ts' },
    tsx: { label: 'TSX', cls: 'ext-tsx' },
    js: { label: 'JS', cls: 'ext-js' },
    jsx: { label: 'JSX', cls: 'ext-jsx' },
    json: { label: 'JSON', cls: 'ext-json' },
    md: { label: 'MD', cls: 'ext-md' },
    css: { label: 'CSS', cls: 'ext-css' },
    html: { label: 'HTML', cls: 'ext-html' },
    py: { label: 'PY', cls: 'ext-py' },
    rs: { label: 'RS', cls: 'ext-rs' },
    go: { label: 'GO', cls: 'ext-go' },
    java: { label: 'JAVA', cls: 'ext-java' },
    c: { label: 'C', cls: 'ext-c' },
    cpp: { label: 'CPP', cls: 'ext-cpp' },
    yaml: { label: 'YAML', cls: 'ext-yaml' },
    yml: { label: 'YML', cls: 'ext-yaml' },
    toml: { label: 'TOML', cls: 'ext-toml' },
    sh: { label: 'SH', cls: 'ext-sh' },
    bash: { label: 'BASH', cls: 'ext-sh' },
    sql: { label: 'SQL', cls: 'ext-sql' },
    lock: { label: 'LOCK', cls: 'ext-lock' },
  };
  return map[ext] || { label: 'FILE', cls: 'ext-file' };
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
        <button className="sidebar-close" onClick={onClose}>x</button>
      </div>
      <div className="sidebar-search">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search files..."
        />
      </div>
      <div className="sidebar-files">
        {filtered.map((f) => {
          const badge = getExtBadge(f);
          return (
            <div
              key={f}
              className={`file-item ${selectedFile === f ? 'active' : ''}`}
              onClick={() => onSelect(f)}
            >
              <span className={`file-ext-badge ${badge.cls}`}>{badge.label}</span>
              <span className="file-item-name">{f}</span>
            </div>
          );
        })}
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
