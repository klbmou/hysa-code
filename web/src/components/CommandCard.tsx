import React, { useState, useEffect, useRef } from 'react';

interface CommandResult {
  ok: boolean;
  output?: string;
  error?: string;
}

interface CommandCardProps {
  command: string;
  onRun: (command: string) => Promise<{ stdout: string; stderr: string; error?: string } | null>;
  yolo?: boolean;
  autoRun?: boolean;
  onComplete?: (result: CommandResult) => void;
}

type Status = 'pending' | 'running' | 'done' | 'failed';

const COLLAPSE_LIMIT = 500;
const COLLAPSE_LINES = 10;

function isDangerous(cmd: string): { dangerous: boolean; reason?: string } {
  const lower = cmd.toLowerCase();
  if (lower.startsWith('rm ') || lower.includes('rm -rf') || lower.includes('rm /')) return { dangerous: true, reason: 'Permanently deletes files' };
  if (lower.startsWith('del ') || lower.startsWith('rd ') || lower.startsWith('rmdir ')) return { dangerous: true, reason: 'Deletes files or directories' };
  if (lower.includes('git reset --hard')) return { dangerous: true, reason: 'Discards uncommitted changes permanently' };
  if (lower.includes('git clean')) return { dangerous: true, reason: 'Removes untracked files permanently' };
  if (lower.includes('format ')) return { dangerous: true, reason: 'Formats disk volume' };
  if (lower.includes('dd ')) return { dangerous: true, reason: 'Low-level disk write operation' };
  if (lower.includes('> /dev/sda') || lower.includes('> /dev/mmcblk')) return { dangerous: true, reason: 'Raw block device write' };
  if (lower.startsWith('chmod ') && lower.includes('777')) return { dangerous: true, reason: 'Sets world-writable permissions' };
  if (lower.startsWith('sudo rm') || lower.startsWith('sudo del')) return { dangerous: true, reason: 'Elevated file deletion' };
  return { dangerous: false };
}

export default function CommandCard({ command, onRun, yolo, autoRun, onComplete }: CommandCardProps) {
  const [result, setResult] = useState<{ ok: boolean; msg: string; output?: string } | null>(null);
  const [running, setRunning] = useState(false);
  const [collapsed, setCollapsed] = useState(true);
  const autoRanRef = useRef(false);

  const status: Status = running ? 'running' : result ? (result.ok ? 'done' : 'failed') : 'pending';
  const hasLongOutput = result?.output && (result.output.length > COLLAPSE_LIMIT || result.output.split('\n').length > COLLAPSE_LINES);
  const displayOutput = hasLongOutput && collapsed ? result.output!.slice(0, COLLAPSE_LIMIT) + '\n...' : result?.output;
  const danger = isDangerous(command);

  useEffect(() => {
    if (autoRun && !autoRanRef.current) {
      autoRanRef.current = true;
      handleRun();
    }
  }, [autoRun]);

  const handleRun = async () => {
    setRunning(true);
    const res = await onRun(command);
    setRunning(false);
    if (!res) {
      setResult({ ok: false, msg: 'Failed to execute command' });
      onComplete?.({ ok: false, error: 'Failed to execute command' });
      return;
    }
    if (res.error) {
      setResult({ ok: false, msg: res.error, output: res.stderr || res.stdout });
      onComplete?.({ ok: false, error: res.error, output: res.stderr || res.stdout });
    } else {
      setResult({ ok: true, msg: 'Command completed', output: res.stdout });
      onComplete?.({ ok: true, output: res.stdout });
    }
  };

  const handleCopy = () => {
    if (result?.output) navigator.clipboard.writeText(result.output).catch(() => {});
  };

  return (
    <div className={`command-card${autoRun ? ' auto-run' : ''}${yolo ? ' yolo' : ''}`}>
      <div className="command-card-inner">
        <div className="command-card-header">
          <span className="cc-icon-run">&gt;_</span>
          <span className="cc-title">Command</span>
          <span className={`cc-status cc-status-${status}`}>
            {status === 'running' && '◌'}
            {status === 'done' && '✓'}
            {status === 'failed' && '✕'}
            {status === 'pending' && '○'}
          </span>
          {autoRun && <span className="cc-yolo-badge">YOLO auto</span>}
          {yolo && !autoRun && status === 'pending' && <span className="cc-yolo-badge cc-yolo-wait">YOLO: needs approval</span>}
        </div>
        {danger.dangerous && status === 'pending' && !autoRun && (
          <div className="cc-danger-reason">
            ⚠ {danger.reason} — manual approval required
          </div>
        )}
        <pre className="command-card-command">{command}</pre>
        {status === 'running' && (
          <div className="command-card-actions">
            <span className="cc-auto-label">
              {autoRun ? 'YOLO: auto-running safe command...' : 'Running...'}
            </span>
          </div>
        )}
        {status === 'pending' && !autoRun && (
          <div className="command-card-actions">
            {yolo && <span className="cc-approval-label">Waiting for approval</span>}
            <button className="btn-run" onClick={handleRun} disabled={running}>
              {danger.dangerous ? 'Approve & Run' : 'Run'}
            </button>
            <button className="btn-cancel" onClick={() => setResult({ ok: false, msg: 'Command cancelled' })}>
              Discard
            </button>
          </div>
        )}
        {result && displayOutput && (
          <div className={`command-card-output ${result.ok ? '' : 'term-error'}`}>
            {displayOutput}
            {hasLongOutput && (
              <button className="cc-expand-btn" onClick={() => setCollapsed(!collapsed)}>
                {collapsed ? 'Show all output' : 'Collapse'}
              </button>
            )}
          </div>
        )}
        {result && (
          <div className="command-card-actions cc-footer">
            {status === 'done' && <span className="cc-status-ok">✓ Completed</span>}
            {status === 'failed' && <span className="cc-status-fail">✕ Failed</span>}
            {result.output && (
              <button className="cc-copy-btn" onClick={handleCopy}>
                Copy output
              </button>
            )}
            {autoRun && <span className="cc-auto-label">Auto-executed via YOLO</span>}
          </div>
        )}
      </div>
    </div>
  );
}
