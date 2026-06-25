import React, { useState } from 'react';

interface Props {
  onAdd: (path: string) => void;
}

export default function ContextInput({ onAdd }: Props) {
  const [value, setValue] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onAdd(trimmed);
    setValue('');
  };

  return (
    <form className="context-input" onSubmit={handleSubmit}>
      <div className="context-input-label">FORCE-ADD CONTEXT</div>
      <div className="context-input-row">
        <input
          className="context-input-field"
          type="text"
          placeholder="file or folder path..."
          value={value}
          onChange={e => setValue(e.target.value)}
        />
        <button className="context-input-btn" type="submit" disabled={!value.trim()}>
          +
        </button>
      </div>
    </form>
  );
}
