import React, { useState, useRef, useCallback } from 'react';

type FileCategory = 'text' | 'image' | 'pdf' | 'docx';

interface FileItem {
  id: string;
  name: string;
  size: number;
  ext: string;
  category: FileCategory;
  status: 'ready' | 'too_large' | 'coming_soon';
  error?: string;
  textContent: string | null;
  previewUrl: string | null;
}

const TEXT_EXTS = new Set(['.txt', '.md', '.json', '.js', '.ts', '.tsx', '.jsx', '.css', '.html']);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const PDF_EXTS = new Set(['.pdf']);
const DOCX_EXTS = new Set(['.docx']);

const ACCEPT = '.txt,.md,.json,.js,.ts,.tsx,.jsx,.css,.html,.png,.jpg,.jpeg,.webp,.pdf,.docx';

const SIZE_LIMITS: Record<FileCategory, number> = {
  text: 512 * 1024,
  image: 5 * 1024 * 1024,
  pdf: 10 * 1024 * 1024,
  docx: 10 * 1024 * 1024,
};

const EXT_LABELS: Record<string, string> = {
  '.txt': 'TXT', '.md': 'MD', '.json': 'JSON', '.js': 'JS', '.ts': 'TS',
  '.tsx': 'TSX', '.jsx': 'JSX', '.css': 'CSS', '.html': 'HTML',
  '.png': 'PNG', '.jpg': 'JPG', '.jpeg': 'JPEG', '.webp': 'WebP',
  '.pdf': 'PDF', '.docx': 'DOCX',
};

const EXT_COLORS: Record<string, string> = {
  '.txt': '#8888a0', '.md': '#a855f7', '.json': '#f59e0b', '.js': '#f7df1e',
  '.ts': '#3178c6', '.tsx': '#3178c6', '.jsx': '#61dafb', '.css': '#3b82f6',
  '.html': '#ef4444', '.png': '#22c55e', '.jpg': '#22c55e', '.jpeg': '#22c55e',
  '.webp': '#22c55e', '.pdf': '#ef4444', '.docx': '#3b82f6',
};

const CATEGORY_ICONS: Record<FileCategory, string> = {
  text: '</>',
  image: '▣',
  pdf: '▤',
  docx: '▥',
};

const LANG_MAP: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript React', '.js': 'JavaScript',
  '.jsx': 'JavaScript React', '.json': 'JSON', '.md': 'Markdown',
  '.css': 'CSS', '.html': 'HTML', '.txt': 'Text',
};

let idCounter = 0;
function nextId(): string { return `file_${++idCounter}`; }

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.substring(dot).toLowerCase();
}

function getCategory(ext: string): FileCategory | null {
  if (TEXT_EXTS.has(ext)) return 'text';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (PDF_EXTS.has(ext)) return 'pdf';
  if (DOCX_EXTS.has(ext)) return 'docx';
  return null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readFileAsText(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(f);
  });
}

function readFileAsDataURL(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(f);
  });
}

export default function FilesPage() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customQuestion, setCustomQuestion] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = files.find(f => f.id === selectedId) || null;

  const addFiles = useCallback(async (fileList: FileList) => {
    setError(null);
    setResult(null);

    const promises: Promise<FileItem>[] = [];

    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      const ext = getExtension(f.name);
      const category = getCategory(ext);
      const id = nextId();

      if (!category) {
        promises.push(Promise.resolve({
          id, name: f.name, size: f.size, ext, category: 'text' as FileCategory,
          status: 'too_large' as const, error: 'Unsupported file type',
          textContent: null, previewUrl: null,
        }));
        continue;
      }

      const limit = SIZE_LIMITS[category];
      if (f.size > limit) {
        promises.push(Promise.resolve({
          id, name: f.name, size: f.size, ext, category,
          status: 'too_large', error: `Max ${formatSize(limit)} for ${category} files`,
          textContent: null, previewUrl: null,
        }));
        continue;
      }

      if (category === 'text') {
        promises.push(
          readFileAsText(f).then(text => ({
            id, name: f.name, size: f.size, ext, category,
            status: 'ready' as const,
            textContent: text, previewUrl: null,
          }))
        );
      } else if (category === 'image') {
        promises.push(
          readFileAsDataURL(f).then(url => ({
            id, name: f.name, size: f.size, ext, category,
            status: 'coming_soon' as const,
            textContent: null, previewUrl: url,
          })).catch(() => ({
            id, name: f.name, size: f.size, ext, category,
            status: 'coming_soon' as const, error: 'Failed to load preview',
            textContent: null, previewUrl: null,
          }))
        );
      } else {
        promises.push(Promise.resolve({
          id, name: f.name, size: f.size, ext, category,
          status: 'coming_soon' as const,
          textContent: null, previewUrl: null,
        }));
      }
    }

    const items = await Promise.all(promises);
    setFiles(prev => {
      const next = [...prev, ...items];
      if (!selectedId && items.length > 0) {
        setSelectedId(items[0].id);
      }
      return next;
    });
  }, [selectedId]);

  const handleInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await addFiles(e.target.files);
      e.target.value = '';
    }
  }, [addFiles]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await addFiles(e.dataTransfer.files);
    }
  }, [addFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    const target = e.currentTarget;
    const related = e.relatedTarget as Node | null;
    if (!related || !target.contains(related)) {
      setDragOver(false);
    }
  }, []);

  const removeFile = useCallback((id: string) => {
    setFiles(prev => {
      const next = prev.filter(f => f.id !== id);
      if (selectedId === id) {
        setSelectedId(next.length > 0 ? next[next.length - 1].id : null);
        setResult(null);
        setCustomQuestion('');
      }
      return next;
    });
  }, [selectedId]);

  const sendToAI = useCallback(async (action: string) => {
    if (!selected || !selected.textContent) return;
    setLoading(true);
    setError(null);
    setResult(null);

    const language = LANG_MAP[selected.ext] || 'Text';
    const prompt = `I have a ${language} file "${selected.name}" with the following content:\n\n\`\`\`\n${selected.textContent}\n\`\`\`\n\nPlease ${action}. Be concise and specific.`;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setResult(data.message || data.response || data.content || data.text || '(No response)');
      }
    } catch (err: unknown) {
      setError((err as Error).message || 'Request failed');
    } finally {
      setLoading(false);
    }
  }, [selected]);

  const handleCustomQuestion = useCallback(() => {
    if (!customQuestion.trim()) return;
    sendToAI(customQuestion.trim());
  }, [customQuestion, sendToAI]);

  const handleNavigate = (hash: string) => {
    window.location.hash = hash;
  };

  const statusLabel = (item: FileItem): string => {
    if (item.status === 'ready') return 'Ready';
    if (item.status === 'too_large') return item.error || 'Too large';
    if (item.category === 'image') return 'Preview only';
    if (item.category === 'pdf') return 'PDF coming soon';
    if (item.category === 'docx') return 'DOCX coming soon';
    return 'Coming soon';
  };

  const statusDotClass = (item: FileItem): string => {
    if (item.status === 'ready') return 'fp-status-dot-ready';
    if (item.status === 'too_large') return 'fp-status-dot-error';
    return 'fp-status-dot-pending';
  };

  return (
    <div
      className={`fp-root${dragOver ? ' fp-drag-over' : ''}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        onChange={handleInputChange}
        style={{ display: 'none' }}
      />

      <nav className="fp-nav">
        <div className="fp-nav-inner">
          <div className="fp-nav-left">
            <span className="fp-logo">HYSA Code</span>
            <span className="fp-nav-subtitle">Files</span>
          </div>
          <div className="fp-nav-links">
            <button className="fp-nav-btn" onClick={() => handleNavigate('#/chat')}>Chat</button>
            <button className="fp-nav-btn" onClick={() => handleNavigate('#/')}>Landing</button>
            <a href="https://github.com/klbmou/hysa-code" target="_blank" rel="noopener noreferrer" className="fp-nav-link">GitHub</a>
          </div>
        </div>
      </nav>

      <div className="fp-body">
        {/* ── Sidebar ── */}
        <aside className="fp-sidebar">
          <div className="fp-sidebar-header">
            <div className="fp-sidebar-title">Files</div>
            <button className="fp-add-btn" onClick={() => inputRef.current?.click()} title="Add file">
              + Add file
            </button>
          </div>
          {files.length > 0 ? (
            <div className="fp-file-list">
              {files.map(item => (
                <div
                  key={item.id}
                  className={`fp-file-item${item.id === selectedId ? ' active' : ''}`}
                  onClick={() => { setSelectedId(item.id); setResult(null); setCustomQuestion(''); }}
                >
                  <div className="fp-file-item-left">
                    <span className="fp-file-ext" style={{ color: EXT_COLORS[item.ext] || 'var(--text-dim)' }}>
                      {EXT_LABELS[item.ext] || '?'}
                    </span>
                  </div>
                  <div className="fp-file-item-body">
                    <div className="fp-file-item-name">{item.name}</div>
                    <div className="fp-file-item-meta">
                      <span className={`fp-status-dot ${statusDotClass(item)}`} />
                      {formatSize(item.size)} · {statusLabel(item)}
                    </div>
                  </div>
                  <button
                    className="fp-file-remove"
                    onClick={(e) => { e.stopPropagation(); removeFile(item.id); }}
                    title="Remove file"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="fp-sidebar-empty">
              <div className="fp-sidebar-empty-icon">+</div>
              <div className="fp-sidebar-empty-text">No files yet</div>
              <button className="fp-add-btn fp-add-btn-inline" onClick={() => inputRef.current?.click()}>
                + Add file
              </button>
              <div className="fp-sidebar-empty-hint">
                Drop files anywhere<br />or click Add file
              </div>
            </div>
          )}
        </aside>

        {/* ── Main ── */}
        <main className="fp-main">
          {error && (
            <div className="fp-error-bar">
              <span>{error}</span>
              <button className="fp-error-close" onClick={() => setError(null)}>×</button>
            </div>
          )}

          {!selected ? (
            <div className="fp-welcome">
              {files.length === 0 ? (
                <>
                  <div className="fp-welcome-icon">📄</div>
                  <div className="fp-welcome-title">Add a file to summarize, explain, or ask questions.</div>
                  <div className="fp-welcome-hint">Supports text files now · Images, PDF &amp; DOCX coming soon</div>
                  <button className="fp-welcome-btn" onClick={() => inputRef.current?.click()}>
                    + Add file
                  </button>
                </>
              ) : (
                <div className="fp-welcome">
                  <div className="fp-welcome-title-sm">Select a file to preview or analyze</div>
                </div>
              )}
            </div>
          ) : selected.status === 'too_large' ? (
            <div className="fp-preview-card">
              <div className="fp-preview-card-icon">⚠</div>
              <div className="fp-preview-card-title">{selected.name}</div>
              <div className="fp-preview-card-desc">{selected.error || 'File is too large'}</div>
              <div className="fp-info-rows">
                <div className="fp-info-row"><span className="fp-info-label">Size</span><span className="fp-info-value">{formatSize(selected.size)}</span></div>
                <div className="fp-info-row"><span className="fp-info-label">Type</span><span className="fp-info-value">{EXT_LABELS[selected.ext] || selected.ext}</span></div>
              </div>
            </div>
          ) : selected.category === 'text' ? (
            <div className="fp-text-preview">
              <div className="fp-preview-header">
                <span className="fp-preview-filename">{selected.name}</span>
                <span className="fp-preview-meta">{formatSize(selected.size)} · {selected.textContent ? selected.textContent.length.toLocaleString() + ' chars' : ''}</span>
              </div>
              <div className="fp-preview-box">
                <pre className="fp-preview-code">
                  {selected.textContent
                    ? (selected.textContent.length > 5000
                      ? selected.textContent.slice(0, 5000) + '\n\n... (truncated)'
                      : selected.textContent)
                    : 'Loading...'}
                </pre>
              </div>
              <div className="fp-actions-section">
                <div className="fp-actions-label">Actions</div>
                <div className="fp-action-buttons">
                  <button className="fp-action-btn" onClick={() => sendToAI('summarize this file')} disabled={loading || !selected.textContent}>
                    {loading ? 'Working...' : 'Summarize'}
                  </button>
                  <button className="fp-action-btn" onClick={() => sendToAI('explain what this file does')} disabled={loading || !selected.textContent}>
                    {loading ? 'Working...' : 'Explain'}
                  </button>
                  <button className="fp-action-btn" onClick={() => sendToAI('extract the key points from this file')} disabled={loading || !selected.textContent}>
                    {loading ? 'Working...' : 'Extract Key Points'}
                  </button>
                </div>
                <div className="fp-custom-question">
                  <input
                    type="text"
                    className="fp-question-input"
                    placeholder="Ask about this file..."
                    value={customQuestion}
                    onChange={(e) => setCustomQuestion(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleCustomQuestion(); }}
                    disabled={loading || !selected.textContent}
                  />
                  <button className="fp-question-btn" onClick={handleCustomQuestion} disabled={loading || !customQuestion.trim() || !selected.textContent}>
                    {loading ? '...' : 'Ask'}
                  </button>
                </div>
              </div>
              {loading && (
                <div className="fp-result-card">
                  <div className="fp-result-loading">
                    <span className="fp-loading-dot" /><span className="fp-loading-dot" /><span className="fp-loading-dot" />
                    <span className="fp-result-loading-text">HYSA is analyzing...</span>
                  </div>
                </div>
              )}
              {result && !loading && (
                <div className="fp-result-card">
                  <div className="fp-result-header">Result</div>
                  <div className="fp-result-body">{result}</div>
                </div>
              )}
            </div>
          ) : selected.category === 'image' ? (
            <div className="fp-preview-card">
              <div className="fp-preview-header">
                <span className="fp-preview-filename">{selected.name}</span>
                <span className="fp-preview-meta">{formatSize(selected.size)} · {selected.ext.toUpperCase()}</span>
              </div>
              {selected.previewUrl ? (
                <div className="fp-image-container">
                  <img src={selected.previewUrl} alt={selected.name} className="fp-image-preview" />
                </div>
              ) : (
                <div className="fp-image-placeholder">Preview not available</div>
              )}
              <div className="fp-coming-soon-card">
                <div className="fp-coming-soon-icon">▣</div>
                <div className="fp-coming-soon-title">Image understanding coming soon</div>
                <div className="fp-coming-soon-desc">Vision support will allow HYSA to analyze images, screenshots, and diagrams.</div>
              </div>
            </div>
          ) : selected.category === 'pdf' ? (
            <div className="fp-preview-card">
              <div className="fp-preview-header">
                <span className="fp-preview-filename">{selected.name}</span>
                <span className="fp-preview-meta">{formatSize(selected.size)} · PDF</span>
              </div>
              <div className="fp-coming-soon-card">
                <div className="fp-coming-soon-icon">▤</div>
                <div className="fp-coming-soon-title">PDF reading coming soon</div>
                <div className="fp-coming-soon-desc">HYSA will be able to extract text from PDF documents for summarization and analysis.</div>
              </div>
            </div>
          ) : selected.category === 'docx' ? (
            <div className="fp-preview-card">
              <div className="fp-preview-header">
                <span className="fp-preview-filename">{selected.name}</span>
                <span className="fp-preview-meta">{formatSize(selected.size)} · DOCX</span>
              </div>
              <div className="fp-coming-soon-card">
                <div className="fp-coming-soon-icon">▥</div>
                <div className="fp-coming-soon-title">DOCX reading coming soon</div>
                <div className="fp-coming-soon-desc">HYSA will be able to read Word documents for text extraction and analysis.</div>
              </div>
            </div>
          ) : (
            <div className="fp-preview-card">
              <div className="fp-preview-card-icon">⚠</div>
              <div className="fp-preview-card-title">{selected.name}</div>
              <div className="fp-preview-card-desc">Unknown file type</div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
