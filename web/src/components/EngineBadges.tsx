import React from 'react';

const ENGINES = [
  { label: 'Project Map', status: 'Cached' },
  { label: 'Failure Memory', status: 'Active' },
  { label: 'Verification', status: 'Ready' },
];

export default function EngineBadges() {
  return (
    <div className="engine-badges">
      <div className="engine-badges-label">ENGINES</div>
      {ENGINES.map(e => (
        <div key={e.label} className="engine-badge">
          <span className="engine-badge-dot" />
          <span className="engine-badge-label">{e.label}</span>
          <span className="engine-badge-status">{e.status}</span>
        </div>
      ))}
    </div>
  );
}
