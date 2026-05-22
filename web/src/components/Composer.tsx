import React, { useRef, useEffect, useState, useCallback } from 'react';
import { extractPdfText, MAX_PDF_TEXT_LENGTH } from '../utils/pdf-extract.js';

export interface Attachment {
  id: string;
  name: string;
  ext: string;
  size: number;
  kind: 'text' | 'image' | 'pdf' | 'docx';
  textContent?: string;
  previewUrl?: string;
  pdfStatus?: 'extracting' | 'ready' | 'too_large' | 'failed' | 'scanned_pdf';
  pdfCharCount?: number;
  pdfTruncated?: boolean;
}

interface ComposerProps {
  onSend: (msg: string, attachments?: Attachment[]) => void;
  loading: boolean;
  status: { provider: string; model: string; visionCapable?: boolean } | null;
  onCancel?: () => void;
}

const ACCEPT = '.txt,.md,.json,.js,.ts,.tsx,.jsx,.css,.html,.png,.jpg,.jpeg,.webp,.pdf,.docx';
const TEXT_EXTS = new Set(['.txt', '.md', '.json', '.js', '.ts', '.tsx', '.jsx', '.css', '.html']);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const PDF_EXTS = new Set(['.pdf']);
const DOCX_EXTS = new Set(['.docx']);

const SIZE_LIMITS: Record<string, number> = {
  text: 512 * 1024,
  image: 5 * 1024 * 1024,
  pdf: 10 * 1024 * 1024,
  docx: 10 * 1024 * 1024,
};

const QUICK_ACTIONS = [
  { label: 'Read files', action: 'Read the project files and explain the structure' },
  { label: 'Fix bug', action: 'Find and fix bugs in the codebase' },
  { label: 'Generate tests', action: 'Generate unit tests for the codebase' },
  { label: 'Improve UI', action: 'Review and improve the UI components' },
  { label: 'Refactor', action: 'Refactor the codebase for better maintainability' },
  { label: 'Run check', action: 'Run the project check command and report results' },
];

const DOC_ACTIONS = [
  { label: 'Summarize', action: 'Summarize this document' },
  { label: 'Explain', action: 'Explain this document in simple terms' },
  { label: 'Extract key points', action: 'Extract key points from this document' },
  { label: 'Translate', action: 'Translate this document to English' },
  { label: 'Describe image', action: 'Describe what you see in this image' },
];

let idCounter = 0;
function nextId(): string { return `att_${++idCounter}`; }

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.substring(dot).toLowerCase();
}

function getCategory(ext: string): 'text' | 'image' | 'pdf' | 'docx' | null {
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

function readTextFile(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(f);
  });
}

function readImageFile(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(f);
  });
}

export default function Composer({ onSend, loading, status, onCancel }: ComposerProps) {
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!loading && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [loading]);

  const addFiles = useCallback(async (fileList: FileList) => {
    setAttachError(null);
    const results: Attachment[] = [];

    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      const ext = getExtension(f.name);
      const category = getCategory(ext);
      const id = nextId();

      if (!category) {
        results.push({ id, name: f.name, ext, size: f.size, kind: 'text', textContent: `[Unsupported file: ${ext}]` });
        continue;
      }

      const limit = SIZE_LIMITS[category];
      if (f.size > limit) {
        setAttachError(`"${f.name}" exceeds the ${formatSize(limit)} size limit for ${category} files.`);
        continue;
      }

      if (category === 'text') {
        try {
          const text = await readTextFile(f);
          results.push({ id, name: f.name, ext, size: f.size, kind: 'text', textContent: text });
        } catch {
          results.push({ id, name: f.name, ext, size: f.size, kind: 'text', textContent: '[Error reading file]' });
        }
      } else if (category === 'image') {
        try {
          const url = await readImageFile(f);
          results.push({ id, name: f.name, ext, size: f.size, kind: 'image', previewUrl: url });
        } catch {
          results.push({ id, name: f.name, ext, size: f.size, kind: 'image' });
        }
      } else if (category === 'pdf') {
        try {
          const result = await extractPdfText(f);
          if (!result.hasText) {
            results.push({ id, name: f.name, ext, size: f.size, kind: 'pdf', pdfStatus: 'scanned_pdf' });
          } else if (result.truncated) {
            results.push({ id, name: f.name, ext, size: f.size, kind: 'pdf', textContent: result.text, pdfStatus: 'ready', pdfCharCount: result.text.length, pdfTruncated: true });
          } else {
            results.push({ id, name: f.name, ext, size: f.size, kind: 'pdf', textContent: result.text, pdfStatus: 'ready', pdfCharCount: result.text.length });
          }
        } catch {
          results.push({ id, name: f.name, ext, size: f.size, kind: 'pdf', pdfStatus: 'failed' });
        }
      } else {
        results.push({ id, name: f.name, ext, size: f.size, kind: category });
      }
    }

    if (results.length > 0) {
      setAttachments(prev => [...prev, ...results]);
      if (textareaRef.current) textareaRef.current.focus();
    }
  }, []);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await addFiles(e.target.files);
      e.target.value = '';
    }
  }, [addFiles]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  }, []);

  const handleSend = () => {
    const text = value.trim();
    if ((!text && attachments.length === 0) || loading) return;
    const atts = attachments.length > 0 ? attachments : undefined;
    onSend(text, atts);
    setValue('');
    setAttachments([]);
    setAttachError(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleQuickAction = (action: string) => {
    setValue(action);
    if (textareaRef.current) textareaRef.current.focus();
  };

  return (
    <div className="composer-wrapper">
      <div className="composer-inner">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPT}
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />

      {!loading && (
        <div className="composer-actions">
          {(attachments.length > 0 ? DOC_ACTIONS : QUICK_ACTIONS).map(qa => (
            <button key={qa.label} className="composer-action-btn" onClick={() => handleQuickAction(qa.action)}>
              {qa.label}
            </button>
          ))}
        </div>
      )}

      <div className="composer-model-pill">
        <span className="model-tag">
          {status ? `${status.provider} / ${status.model}` : 'Loading...'}
        </span>
      </div>

      {attachError && <div className="composer-attach-error">{attachError}</div>}

      {attachments.some(a => a.kind === 'image') && status && !status.visionCapable && (
        <div className="composer-vision-warn">Current provider does not support images. Will try a vision-capable provider.</div>
      )}

      {attachments.length > 0 && (
        <div className="composer-attachments">
          {attachments.map(a => (
            <div key={a.id} className={`attach-chip attach-chip-${a.kind}`}>
              {a.kind === 'image' && a.previewUrl ? (
                <img src={a.previewUrl} alt="" className="attach-chip-img" />
              ) : (
                <span className="attach-chip-ext" style={{ color: EXT_COLOR[a.ext] || 'var(--text-dim)' }}>
                  {EXT_LABEL[a.ext] || a.ext.slice(1).toUpperCase()}
                </span>
              )}
              <div className="attach-chip-body">
                <span className="attach-chip-name">{a.name}</span>
                <span className="attach-chip-size">
                  {a.kind === 'image' && (a.previewUrl ? 'Image · ready for analysis' : 'Image')}
                  {a.pdfStatus === 'extracting' && 'extracting...'}
                  {a.pdfStatus === 'ready' && `PDF text extracted · ${a.pdfCharCount?.toLocaleString()} chars`}
                  {a.pdfStatus === 'too_large' && 'too large'}
                  {a.pdfStatus === 'failed' && 'extraction failed'}
                  {a.pdfStatus === 'scanned_pdf' && 'scanned/image-based PDF'}
                  {!a.pdfStatus && a.kind !== 'image' && formatSize(a.size)}
                </span>
              </div>
              <button className="attach-chip-remove" onClick={() => removeAttachment(a.id)} title="Remove">×</button>
            </div>
          ))}
        </div>
      )}

      <div className={`composer-box${value.trim() ? ' has-text' : ''}${loading ? ' loading' : ''}`}>
        <textarea
          ref={textareaRef}
          className="composer-textarea"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask HYSA about code, files, PDFs, images, or anything..."
          dir="auto"
          disabled={loading}
        />
        <div className="composer-bottom">
          {loading ? (
            <div className="composer-loading">
              {onCancel && (
                <button className="thinking-cancel" onClick={onCancel}>Cancel</button>
              )}
            </div>
          ) : (
            <>
              <button
                className="composer-attach-btn"
                onClick={() => fileInputRef.current?.click()}
                title="Attach file"
                disabled={loading}
              >
                +
              </button>
              <div className="composer-info">Enter to send / Shift+Enter for newline</div>
            </>
          )}
          <button
            className={`composer-send${value.trim() ? ' has-text' : ''}`}
            onClick={handleSend}
            disabled={loading || (!value.trim() && attachments.length === 0)}
          >
            Send
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}

const EXT_LABEL: Record<string, string> = {
  '.txt': 'TXT', '.md': 'MD', '.json': 'JSON', '.js': 'JS', '.ts': 'TS',
  '.tsx': 'TSX', '.jsx': 'JSX', '.css': 'CSS', '.html': 'HTML',
  '.png': 'IMG', '.jpg': 'IMG', '.jpeg': 'IMG', '.webp': 'IMG',
  '.pdf': 'PDF', '.docx': 'DOCX',
};

const EXT_COLOR: Record<string, string> = {
  '.txt': '#8888a0', '.md': '#a855f7', '.json': '#f59e0b', '.js': '#f7df1e',
  '.ts': '#3178c6', '.tsx': '#3178c6', '.jsx': '#61dafb', '.css': '#3b82f6',
  '.html': '#ef4444', '.png': '#22c55e', '.jpg': '#22c55e', '.jpeg': '#22c55e',
  '.webp': '#22c55e', '.pdf': '#ef4444', '.docx': '#3b82f6',
};
