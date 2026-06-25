import React from 'react';

const POLL_INTERVAL = 2000;
const MAX_VISIBLE_LINES = 500;

export default function LogViewer() {
  const [logs, setLogs] = React.useState<string[]>([]);
  const [connected, setConnected] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const autoScrollRef = React.useRef(true);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
  };

  React.useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const res = await fetch('/api/logs?lines=200');
        const data = await res.json();
        if (!active) return;
        if (data.ok && Array.isArray(data.lines)) {
          setLogs(prev => {
            const merged = [...prev, ...data.lines];
            return merged.slice(-MAX_VISIBLE_LINES);
          });
          setConnected(true);
          setError(null);
        }
      } catch (err: unknown) {
        if (!active) return;
        setConnected(false);
        setError((err as Error).message);
      }
      if (active) timer = setTimeout(poll, POLL_INTERVAL);
    };

    poll();

    return () => { active = false; clearTimeout(timer); };
  }, []);

  React.useEffect(() => {
    if (autoScrollRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  return (
    <div className="log-viewer">
      <div className="log-viewer-header">
        <span className="log-viewer-title">Server Logs</span>
        <span className={`log-viewer-status ${connected ? 'connected' : 'disconnected'}`}>
          {connected ? '● Live' : '○ Disconnected'}
        </span>
      </div>
      <div className="log-viewer-body" onScroll={handleScroll}>
        {error && (
          <div className="log-viewer-error">Error: {error}</div>
        )}
        {logs.length === 0 && !error && (
          <div className="log-viewer-empty">Waiting for logs...</div>
        )}
        {logs.map((line, i) => {
          let level = 'info';
          if (line.includes('[HYSA WARN]') || line.includes('[WARN]')) level = 'warn';
          if (line.includes('[HYSA ERROR]') || line.includes('[ERROR]') || line.includes('[FAIL]')) level = 'error';
          if (line.includes('[HYSA Monitor]')) level = 'monitor';
          if (line.includes('[OK]')) level = 'ok';
          return (
            <div key={i} className={`log-line log-${level}`}>
              <span className="log-line-num">{i + 1}</span>
              <span className="log-line-text">{line}</span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
