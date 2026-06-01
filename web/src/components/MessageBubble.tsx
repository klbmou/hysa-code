import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { Attachment } from './Composer.js';

interface SourceLink {
  domain: string;
  title: string;
  url?: string;
}

export interface Source {
  title: string;
  url: string;
  snippet?: string;
  rank: number;
}

function extractSourceLinks(text: string): SourceLink[] {
  const links: SourceLink[] = [];
  const urlPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;
  while ((match = urlPattern.exec(text)) !== null) {
    try {
      const domain = new URL(match[2]).hostname.replace(/^www\./, '');
      if (!links.some(l => l.domain === domain && l.title === match[1])) {
        links.push({ domain, title: match[1], url: match[2] });
      }
    } catch { /* skip invalid URLs */ }
  }
  return links.slice(0, 5);
}

interface MessageBubbleProps {
  kind: 'user' | 'assistant';
  content: string;
  attachments?: Attachment[];
  onCopy?: (text: string) => void;
  sourceFiles?: string;
  streaming?: boolean;
  className?: string;
  sources?: Source[];
}

function hasRtlChars(text: string): boolean {
  const rtlRange = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
  return rtlRange.test(text);
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
  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code blocks (multi-line)
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      parts.push(
        <CodeBlock key={`cb-${parts.length}`} language={lang || 'text'} code={codeLines.join('\n')} />
      );
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const Tag = `h${level}` as keyof JSX.IntrinsicElements;
      parts.push(<Tag key={`h-${parts.length}`} dir="auto">{renderInline(text)}</Tag>);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^---+\s*$/.test(line) || /^\*\*\*+\s*$/.test(line)) {
      parts.push(<hr key={`hr-${parts.length}`} className="msg-hr" />);
      i++;
      continue;
    }

    // Unordered list
    if (/^\s*[\-\*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[\-\*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[\-\*]\s+/, ''));
        i++;
      }
      parts.push(
        <ul key={`ul-${parts.length}`} className="msg-list">
          {items.map((item, idx) => (
            <li key={idx} dir="auto">{renderInline(item)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ''));
        i++;
      }
      parts.push(
        <ol key={`ol-${parts.length}`} className="msg-list">
          {items.map((item, idx) => (
            <li key={idx} dir="auto">{renderInline(item)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // Regular paragraph (collect consecutive non-empty lines)
    if (line.trim()) {
      const paragraphLines: string[] = [];
      while (i < lines.length && lines[i].trim() && !lines[i].startsWith('```') && !/^(#{1,4})\s/.test(lines[i]) && !/^\s*[\-\*]\s+/.test(lines[i]) && !/^\s*\d+[.)]\s+/.test(lines[i])) {
        paragraphLines.push(lines[i]);
        i++;
      }
      parts.push(
        <p key={`p-${parts.length}`} className="msg-paragraph" dir="auto">
          {renderInline(paragraphLines.join('\n'))}
        </p>
      );
      continue;
    }

    // Empty line
    if (!line.trim()) {
      i++;
      continue;
    }

    i++;
  }

  return parts;
}

function renderInline(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Inline code
    const inlineMatch = remaining.match(/`([^`]+)`/);
    if (inlineMatch && inlineMatch.index !== undefined) {
      if (inlineMatch.index > 0) {
        parts.push(<span key={`t-${parts.length}`}>{remaining.slice(0, inlineMatch.index)}</span>);
      }
      parts.push(<code key={`ic-${parts.length}`} className="msg-inline-code">{inlineMatch[1]}</code>);
      remaining = remaining.slice(inlineMatch.index + inlineMatch[0].length);
      continue;
    }

    // Bold
    const boldMatch = remaining.match(/\*\*([^*]+)\*\*/);
    if (boldMatch && boldMatch.index !== undefined) {
      if (boldMatch.index > 0) {
        parts.push(<span key={`t-${parts.length}`}>{remaining.slice(0, boldMatch.index)}</span>);
      }
      parts.push(<strong key={`b-${parts.length}`}>{boldMatch[1]}</strong>);
      remaining = remaining.slice(boldMatch.index + boldMatch[0].length);
      continue;
    }

    // Italic
    const italicMatch = remaining.match(/(?<!\*)\*([^*]+)\*(?!\*)/);
    if (italicMatch && italicMatch.index !== undefined) {
      if (italicMatch.index > 0) {
        parts.push(<span key={`t-${parts.length}`}>{remaining.slice(0, italicMatch.index)}</span>);
      }
      parts.push(<em key={`em-${parts.length}`}>{italicMatch[1]}</em>);
      remaining = remaining.slice(italicMatch.index + italicMatch[0].length);
      continue;
    }

    // Link [text](url) — render as compact citation
    const linkMatch = remaining.match(/\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch && linkMatch.index !== undefined) {
      if (linkMatch.index > 0) {
        parts.push(<span key={`t-${parts.length}`}>{remaining.slice(0, linkMatch.index)}</span>);
      }
      try {
        const domain = new URL(linkMatch[2]).hostname.replace(/^www\./, '');
        parts.push(
          <a key={`a-${parts.length}`} href={linkMatch[2]} target="_blank" rel="noopener noreferrer" className="msg-link">
            {linkMatch[1]}
            <span className="msg-link-domain">{domain}</span>
          </a>
        );
      } catch {
        parts.push(<span key={`t-${parts.length}`}>{linkMatch[0]}</span>);
      }
      remaining = remaining.slice(linkMatch.index + linkMatch[0].length);
      continue;
    }

    if (remaining.length > 0) {
      parts.push(<span key={`t-${parts.length}`}>{remaining}</span>);
      break;
    }
  }

  return parts;
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
  );
}

function SourcesPopover({ sources, onClose }: { sources: Source[]; onClose: () => void }) {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', handleKey);
    document.addEventListener('mousedown', handleClick);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [onClose]);

  return (
    <>
      <div className="sources-overlay" onClick={onClose} />
      <div className="sources-popover" ref={popoverRef}>
        <div className="sources-popover-header">Sources</div>
        {sources.map(s => (
          <div key={s.rank} className="source-row">
            <div className="source-row-num">{s.rank}</div>
            <div className="source-row-body">
              <div className="source-row-title">{s.title}</div>
              <div className="source-row-domain">{getDomain(s.url)}</div>
              {s.snippet && <div className="source-row-snippet">{s.snippet}</div>}
              <a className="source-row-link" href={s.url} target="_blank" rel="noopener noreferrer">Open link ↗</a>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function getDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function SourceChips({ sources, onOpen }: { sources: Source[]; onOpen: () => void }) {
  return (
    <div className="source-chips">
      {sources.map(s => (
        <span key={s.rank} className="source-chip" onClick={onOpen} title={`${s.title} — ${getDomain(s.url)}`}>
          [{s.rank}]
        </span>
      ))}
    </div>
  );
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  return (
    <div className="msg-code-block" dir="ltr">
      <div className="msg-code-header">
        <span className="msg-code-lang">{language || 'code'}</span>
        <span className="msg-code-size">{code.split('\n').length} lines</span>
        <button className={`msg-code-copy${copied ? ' copied' : ''}`} onClick={handleCopy} title="Copy code">
          {copied ? <CheckIcon /> : <CopyIcon />}
          <span className="msg-code-copy-label">{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <div className="msg-code-scroll">
        <pre className="msg-code-pre"><code className="hljs">{code}</code></pre>
      </div>
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

export default function MessageBubble({ kind, content, attachments, onCopy, sourceFiles, streaming, className, sources }: MessageBubbleProps) {
  const rtl = hasRtlChars(content);
  const sourceLinks = content ? extractSourceLinks(content) : [];
  const [showSources, setShowSources] = useState(false);
  const hasStructuredSources = sources && sources.length > 0;

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
            <div className={`assistant-bubble ${rtl ? 'arabic' : ''} ${streaming ? 'streaming' : ''}`}>
              <div className="assistant-content" dir={rtl ? 'rtl' : 'auto'}>
                {renderMarkdown(content || '')}
              </div>
            </div>
            {hasStructuredSources && !streaming && (
              <>
                <SourceChips sources={sources!} onOpen={() => setShowSources(true)} />
                {showSources && <SourcesPopover sources={sources!} onClose={() => setShowSources(false)} />}
              </>
            )}
            {!hasStructuredSources && sourceLinks.length > 0 && !streaming && (
              <div className="msg-sources">
                {sourceLinks.map((link, i) => (
                  <span key={i} className="msg-source-chip">
                    {link.url ? (
                      <a href={link.url} target="_blank" rel="noopener noreferrer">{link.domain}</a>
                    ) : (
                      link.domain
                    )}
                  </span>
                ))}
              </div>
            )}
            {onCopy && content && (
              <div className="msg-actions">
                <button className="msg-action-btn" onClick={() => onCopy(content)} title="Copy entire response">
                  Copy all
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="msg-row user">
      <div className="user-inner">
        <div className={`user-bubble${rtl ? ' rtl' : ''}`} dir={rtl ? 'rtl' : 'auto'}>
          {content}
        </div>
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
