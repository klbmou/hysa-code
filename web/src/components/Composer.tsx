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

const CODING_SUGGESTIONS = [
  { label: 'Explain project', action: 'Read the project files and explain the architecture and structure.' },
  { label: 'Fix bug', action: 'Find and fix bugs in the codebase.' },
  { label: 'Generate tests', action: 'Generate unit tests for the project.' },
  { label: 'Improve UI', action: 'Review and improve UI components.' },
  { label: 'Refactor', action: 'Refactor the codebase for better maintainability.' },
  { label: 'Run check', action: 'Run the project check command and report results.' },
];

const DOC_SUGGESTIONS = [
  { label: 'Summarize', action: 'Summarize this document.' },
  { label: 'Explain', action: 'Explain this document in simple terms.' },
  { label: 'Extract key points', action: 'Extract key points from this document.' },
  { label: 'Translate', action: 'Translate this document to English.' },
];

const IMAGE_SUGGESTIONS = [
  { label: 'Describe', action: 'Describe what you see in this image.' },
  { label: 'Extract text', action: 'Extract any text visible in this image.' },
  { label: 'Explain', action: 'Explain the content of this image.' },
  { label: 'Translate', action: 'Translate any text in this image.' },
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
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [micSupported, setMicSupported] = useState<boolean | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const sentCountRef = useRef(0);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    if (!loading && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [loading]);

  // Hide suggestions after 2 sends
  useEffect(() => {
    if (sentCountRef.current >= 2) {
      setShowSuggestions(false);
    }
  }, [sentCountRef.current]);

  // Check speech recognition support
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    setMicSupported(!!SpeechRecognition);
  }, []);

  const handleVoiceInput = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    if (isRecording) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
      setIsRecording(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'ar-SA';

    recognition.onresult = (event: any) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setValue(prev => prev + transcript);
    };

    recognition.onerror = () => {
      setIsRecording(false);
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      setIsRecording(false);
      recognitionRef.current = null;
    };

    recognition.start();
    recognitionRef.current = recognition;
    setIsRecording(true);
  }, [isRecording]);

  const handleImageGen = useCallback(() => {
    onSend('/imagine', []);
  }, [onSend]);

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
    sentCountRef.current += 1;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSuggestion = (action: string) => {
    setValue(action);
    if (textareaRef.current) textareaRef.current.focus();
  };

  const hasImages = attachments.some(a => a.kind === 'image');
  const hasDocs = attachments.some(a => a.kind === 'pdf' || a.kind === 'text');
  const suggestions = hasImages ? IMAGE_SUGGESTIONS : hasDocs ? DOC_SUGGESTIONS : CODING_SUGGESTIONS;

  return (
    <div className="composer">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPT}
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />

      {!loading && showSuggestions && (
        <div className="composer-suggestions">
          {suggestions.slice(0, 4).map(s => (
            <button key={s.label} className="composer-suggestion-btn" onClick={() => handleSuggestion(s.action)}>
              {s.label}
            </button>
          ))}
        </div>
      )}

      {attachError && <div className="composer-attach-error">{attachError}</div>}

      {attachments.length > 0 && (
        <div className="composer-attachments">
          {attachments.map(a => (
            <div key={a.id} className="attach-chip">
              {a.kind === 'image' && a.previewUrl ? (
                <img src={a.previewUrl} alt="" className="attach-chip-img" />
              ) : (
                <span className="attach-chip-ext" style={{ color: EXT_COLOR[a.ext] || 'var(--text-dim)' }}>
                  {EXT_LABEL[a.ext] || a.ext.slice(1).toUpperCase()}
                </span>
              )}
              <div className="attach-chip-body">
                <span className="attach-chip-name">{a.name}</span>
                <span className="attach-chip-status">
                  {a.kind === 'image' && 'Image'}
                  {a.pdfStatus === 'ready' && `${a.pdfCharCount?.toLocaleString()} chars`}
                  {a.pdfStatus === 'extracting' && 'Extracting...'}
                  {a.pdfStatus === 'too_large' && 'Too large'}
                  {a.pdfStatus === 'failed' && 'Failed'}
                  {a.pdfStatus === 'scanned_pdf' && 'Scanned'}
                  {!a.pdfStatus && a.kind !== 'image' && formatSize(a.size)}
                </span>
              </div>
              <button className="attach-chip-remove" onClick={() => removeAttachment(a.id)}>×</button>
            </div>
          ))}
        </div>
      )}

      <div className={`composer-box${loading ? ' loading' : ''}`}>
        <div className="composer-input-row">
          <textarea
            ref={textareaRef}
            className="composer-textarea"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about code, files, PDFs, images, or anything..."
            dir="auto"
            disabled={loading}
            rows={1}
          />
          <div className="composer-action-bar">
            <button
              className="composer-attach-btn"
              onClick={() => fileInputRef.current?.click()}
              title="Attach file or image"
              disabled={loading}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
            <button
              className="composer-action-btn"
              onClick={handleImageGen}
              title="Generate image (experimental)"
              disabled={loading}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </button>
            <button
              className={`composer-action-btn${isRecording ? ' recording' : ''}`}
              onClick={handleVoiceInput}
              title={micSupported ? (isRecording ? 'Click to stop recording' : 'Voice input') : 'Voice input not supported in this browser'}
              disabled={loading || !micSupported}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </button>
          </div>
        </div>
        <div className="composer-bottom">
          <div className="composer-left">
            {loading && onCancel && (
              <button className="composer-cancel-btn" onClick={onCancel}>Cancel</button>
            )}
            {!loading && (
              <span className="composer-hint">Enter to send · Shift+Enter for newline</span>
            )}
          </div>
          <button
            className="composer-send-btn"
            onClick={handleSend}
            disabled={loading || (!value.trim() && attachments.length === 0)}
            title="Send message"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
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
