import React, { useRef, useEffect, useState } from 'react';

interface ComposerProps {
  onSend: (msg: string) => void;
  loading: boolean;
  status: { provider: string; model: string } | null;
  onCancel?: () => void;
}

const QUICK_ACTIONS = [
  { label: 'Read files', action: 'Read the project files and explain the structure' },
  { label: 'Fix bug', action: 'Find and fix bugs in the codebase' },
  { label: 'Generate tests', action: 'Generate unit tests for the codebase' },
  { label: 'Improve UI', action: 'Review and improve the UI components' },
  { label: 'Refactor', action: 'Refactor the codebase for better maintainability' },
  { label: 'Run check', action: 'Run the project check command and report results' },
];

export default function Composer({ onSend, loading, status, onCancel }: ComposerProps) {
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

  const handleQuickAction = (action: string) => {
    setValue(action);
    if (textareaRef.current) textareaRef.current.focus();
  };

  return (
    <div className="composer-wrapper">
      {!loading && (
        <div className="composer-actions">
          {QUICK_ACTIONS.map(qa => (
            <button key={qa.label} className="composer-action-btn" onClick={() => handleQuickAction(qa.action)}>
              {qa.label}
            </button>
          ))}
        </div>
      )}
      <div className="composer-model-pill">
        <span className="model-tag">
          {status ? `${status.provider} · ${status.model}` : 'Loading...'}
        </span>
        <span className="composer-context-hint">Context: current project files</span>
      </div>
      <div className={`composer-box${value.trim() ? ' has-text' : ''}`}>
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
              <div className="dot-pulse"><span></span><span></span><span></span></div>
              <span>HYSA is thinking...</span>
              {onCancel && (
                <button className="thinking-cancel" onClick={onCancel}>Cancel</button>
              )}
            </div>
          ) : (
            <div className="composer-info">Enter to send · Shift+Enter for newline</div>
          )}
          <button
            className={`composer-send${value.trim() ? ' has-text' : ''}`}
            onClick={handleSend}
            disabled={loading || !value.trim()}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
