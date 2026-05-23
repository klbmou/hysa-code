import React, { useState, useCallback } from 'react';
import type { Attachment } from './Composer.js';

interface MessageBubbleProps {
  kind: 'user' | 'assistant';
  content: string;
  attachments?: Attachment[];
  onCopy?: (text: string) => void;
  sourceFiles?: string;
  streaming?: boolean;
  className?: string;
}

function isArabic(text: string): boolean {
  const arabicRange = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  return arabicRange.test(text);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const EXT_COLOR: Record<string, string> = {
  '.txt': '#8888a0', '.md': '#a855f7', '.json': '#f59e0b', '.js': '#f7df1e',
  '.ts': '#3178c6', '.tsx': '#3178c6', '.jsx': '#61dafb', '.css': '#3b82f6',
  '.html': '#ef4444', '.png': '#22c55e', '.jpg': '#22c55e', '.jpeg': '#22c55e',
  '.webp': '#22c55e', '.pdf': '#ef4444', '.docx': '#3b82f6',
};

const EXT_LABEL: Record<string, string> = {
  '.txt': 'TXT', '.md': 'MD', '.json': 'JSON', '.js': 'JS', '.ts': 'TS',
  '.tsx': 'TSX', '.jsx': 'JSX', '.css': 'CSS', '.html': 'HTML',
  '.png': 'IMG', '.jpg': 'IMG', '.jpeg': 'IMG', '.webp': 'IMG',
  '.pdf': 'PDF', '.docx': 'DOCX',
};

function renderMarkdown(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    const codeBlockMatch = remaining.match(/```(\w*)\n([\s\S]*?)```/);
    if (codeBlockMatch && codeBlockMatch.index !== undefined) {
      if (codeBlockMatch.index > 0) {
        parts.push(<span key={`t-${parts.length}`} dir="auto">{remaining.slice(0, codeBlockMatch.index)}</span>);
      }
      const lang = codeBlockMatch[1] || 'text';
      const code = codeBlockMatch[2];
      parts.push(
        <CodeBlock key={`cb-${parts.length}`} language={lang} code={code} />
      );
      remaining = remaining.slice(codeBlockMatch.index + codeBlockMatch[0].length);
      continue;
    }

    const inlineMatch = remaining.match(/`([^`]+)`/);
    if (inlineMatch && inlineMatch.index !== undefined) {
      if (inlineMatch.index > 0) {
        parts.push(<span key={`t-${parts.length}`} dir="auto">{remaining.slice(0, inlineMatch.index)}</span>);
      }
      parts.push(<code key={`ic-${parts.length}`} className="msg-inline-code">{inlineMatch[1]}</code>);
      remaining = remaining.slice(inlineMatch.index + inlineMatch[0].length);
      continue;
    }

    const boldMatch = remaining.match(/\*\*([^*]+)\*\*/);
    if (boldMatch && boldMatch.index !== undefined) {
      if (boldMatch.index > 0) {
        parts.push(<span key={`t-${parts.length}`} dir="auto">{remaining.slice(0, boldMatch.index)}</span>);
      }
      parts.push(<strong key={`b-${parts.length}`}>{boldMatch[1]}</strong>);
      remaining = remaining.slice(boldMatch.index + boldMatch[0].length);
      continue;
    }

    if (remaining.length > 0) {
      parts.push(<span key={`t-${parts.length}`} dir="auto">{remaining}</span>);
      break;
    }
  }

  return parts;
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [code]);

  return (
    <div className="msg-code-block" dir="ltr">
      <div className="msg-code-header">
        <span className="msg-code-lang">{language || 'code'}</span>
        <button className="msg-code-copy" onClick={handleCopy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="msg-code-pre"><code>{code}</code></pre>
    </div>
  );
}

function AttachmentCard({ attachment }: { attachment: Attachment }) {
  const a = attachment;
  let note = '';
  if (a.kind === 'image') {
    note = 'Image';
  } else if (a.kind === 'pdf' && a.pdfStatus === 'ready') note = 'PDF text extracted';
  else if (a.kind === 'pdf' && (a.pdfStatus === 'scanned_pdf' || a.pdfStatus === 'failed')) note = 'Scanned PDF — OCR not available';
  else if (a.kind === 'pdf' && a.pdfStatus === 'too_large') note = 'PDF too large';
  else if (a.kind === 'pdf') note = 'PDF';

  return (
    <div className={`msg-attach msg-attach-${a.kind}`}>
      {a.kind === 'image' && a.previewUrl ? (
        <div className="msg-attach-image-wrap">
          <img src={a.previewUrl} alt={a.name} className="msg-attach-image" />
          <div className="msg-attach-image-meta">
            <span className="msg-attach-name">{a.name}</span>
            <span className="msg-attach-size">{formatBytes(a.size)}</span>
          </div>
        </div>
      ) : (
        <div className="msg-attach-row">
          <span className="msg-attach-badge" style={{ color: EXT_COLOR[a.ext] || 'var(--text-dim)' }}>
            {EXT_LABEL[a.ext] || a.ext.slice(1).toUpperCase()}
          </span>
          <div className="msg-attach-info">
            <span className="msg-attach-name">{a.name}</span>
            <span className="msg-attach-size">
              {formatBytes(a.size)}
              {a.kind === 'pdf' && a.pdfCharCount ? ` · ${a.pdfCharCount.toLocaleString()} chars` : ''}
            </span>
          </div>
          {note && <span className="msg-attach-note">{note}</span>}
          {a.kind === 'pdf' && a.pdfTruncated && (
            <span className="msg-attach-warn">Truncated</span>
          )}
        </div>
      )}
    </div>
  );
}

export default function MessageBubble({ kind, content, attachments, onCopy, sourceFiles, streaming, className }: MessageBubbleProps) {
  const hasArabic = isArabic(content);

  if (kind === 'assistant') {
    return (
      <div className={`msg-row assistant${className ? ` ${className}` : ''}`}>
        <div className="assistant-inner">
          <div className="avatar">
            <span className="avatar-h">H</span>
          </div>
          <div className="assistant-block">
            {sourceFiles && (
              <div className="msg-attach-source">Using {sourceFiles}</div>
            )}
            <div className={`assistant-bubble ${hasArabic ? 'arabic' : ''} ${streaming ? 'streaming' : ''}`}>
              <div className="assistant-content" dir={hasArabic ? 'rtl' : 'auto'}>
                {renderMarkdown(content)}
              </div>
              {onCopy && content && (
                <div className="msg-actions">
                  <button className="msg-action-btn" onClick={() => onCopy(content)} title="Copy message">Copy</button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="msg-row user">
      <div className="user-inner">
        <div className="user-bubble">{content}</div>
        {attachments && attachments.length > 0 && (
          <div className="attachment-list">
            {attachments.map(a => (
              <AttachmentCard key={a.id} attachment={a} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
