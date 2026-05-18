import React, { useState } from 'react';

interface CommandCardProps {
  command: string;
  onRun: (command: string) => Promise<{ stdout: string; stderr: string; error?: string } | null>;
}

export default function CommandCard({ command, onRun }: CommandCardProps) {
  const [result, setResult] = useState<{ ok: boolean; msg: string; output?: string } | null>(null);
  const [running, setRunning] = useState(false);

  const handleRun = async () => {
    setRunning(true);
    const res = await onRun(command);
    setRunning(false);
    if (!res) {
      setResult({ ok: false, msg: 'Failed to execute command' });
      return;
    }
    if (res.error) {
      setResult({ ok: false, msg: res.error, output: res.stderr || res.stdout });
    } else {
      setResult({ ok: true, msg: 'Command completed', output: res.stdout });
    }
  };

  return (
    <div className="command-card">
      <div className="command-card-inner">
        <div className="command-card-header">
          ⚡ Command
        </div>
        <pre className="command-card-command">{command}</pre>
        {!result && (
          <div className="command-card-actions">
            <button className="btn-run" onClick={handleRun} disabled={running}>
              {running ? 'Running...' : 'Run'}
            </button>
            <button className="btn-cancel" onClick={() => setResult({ ok: false, msg: 'Command cancelled' })}>
              Cancel
            </button>
          </div>
        )}
        {result && result.output && (
          <div className={`command-card-output ${result.ok ? '' : 'term-error'}`}>
            {result.output}
          </div>
        )}
        {result && (
          <div className={`command-card-result ${result.ok ? 'success' : 'error'}`}>
            {result.msg}
          </div>
        )}
      </div>
    </div>
  );
}
