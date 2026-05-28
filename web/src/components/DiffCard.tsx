import React, { useState, useCallback } from 'react';

interface DiffCardProps {
  filePath: string;
  diff: string;
  content: string;
  onApply: (filePath: string, content: string) => Promise<string | null>;
  onOpenFile: (filePath: string) => void;
  yolo?: boolean;
  onComplete?: (ok: boolean) => void;
}

function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
  );
}

export default function DiffCard({ filePath, diff, content, onApply, onOpenFile, yolo, onComplete }: DiffCardProps) {
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [applying, setApplying] = useState(false);
  const [diffCopied, setDiffCopied] = useState(false);

  const handleCopyDiff = useCallback(() => {
    navigator.clipboard.writeText(diff).catch(() => {});
    setDiffCopied(true);
    setTimeout(() => setDiffCopied(false), 2000);
  }, [diff]);

  const handleApply = async () => {
    setApplying(true);
    const err = await onApply(filePath, content);
    setApplying(false);
    if (err) {
      setResult({ ok: false, msg: err });
      onComplete?.(false);
    } else {
      setResult({ ok: true, msg: 'Edit applied' });
      onComplete?.(true);
    }
  };

  const diffLines = diff.split('\n').map((line, i) => {
    let cls = '';
    if (line.startsWith('+')) cls = 'diff-add';
    else if (line.startsWith('-')) cls = 'diff-remove';
    else if (line.startsWith('@@')) cls = 'diff-header';
    return { line, cls, key: i };
  });

  return (
      <div className={`diff-card${yolo ? ' yolo' : ''}`}>
      <div className="diff-card-inner">
        <div className="diff-card-header">
          <span>{filePath}</span>
          <button className={`diff-copy-btn${diffCopied ? ' copied' : ''}`} onClick={handleCopyDiff} title="Copy diff">
            {diffCopied ? <CheckIcon /> : <CopyIcon />}
          </button>
          {yolo && !result && <span className="diff-yolo-badge">YOLO: needs approval</span>}
        </div>
        <div className="diff-card-body">
          {diffLines.map(({ line, cls, key }) => (
            <div key={key} className={cls}>{line}</div>
          ))}
        </div>
        {!result && (
          <div className="diff-card-actions">
            <button className="btn-apply" onClick={handleApply} disabled={applying}>
              {applying ? 'Applying...' : 'Apply Edit'}
            </button>
            <button className="btn-reject" onClick={() => setResult({ ok: false, msg: 'Edit discarded' })}>
              Discard
            </button>
          </div>
        )}
        {result && (
          <div className={`diff-card-result ${result.ok ? 'success' : 'error'}`}>
            {result.msg}
            {result.ok && (
              <span style={{ cursor: 'pointer', marginLeft: 12, textDecoration: 'underline' }} onClick={() => onOpenFile(filePath)}>
                View file
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
