import React, { useRef, useEffect, useState } from 'react';

interface ComposerProps {
  onSend: (msg: string) => void;
  loading: boolean;
  status: { provider: string; model: string } | null;
}

export default function Composer({ onSend, loading, status }: ComposerProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!loading && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [loading]);

  const handleSend = () => {
    const text = value.trim();
    if (!text || loading) return;
    onSend(text);
    setValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="composer-wrapper">
      <div className="composer-model-pill">
        <span className="model-tag">
          {status ? `${status.provider} · ${status.model}` : 'Loading...'}
        </span>
      </div>
      <div className="composer-box">
        <textarea
          ref={textareaRef}
          className="composer-textarea"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask HYSA to edit, explain, debug, or run code..."
          dir="auto"
          disabled={loading}
        />
        <div className="composer-bottom">
          {loading ? (
            <div className="composer-loading">
              <div className="dot-pulse">
                <span></span><span></span><span></span>
              </div>
              Thinking...
            </div>
          ) : (
            <div className="composer-info">Enter to send · Shift+Enter for new line</div>
          )}
          <button className="composer-send" onClick={handleSend} disabled={loading || !value.trim()}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
