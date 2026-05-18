import React from 'react';

interface WelcomeScreenProps {
  onHint: (msg: string) => void;
}

const HINTS = [
  'Explain this project',
  'Create a feature',
  'Fix a bug',
  'Improve code quality',
];

export default function WelcomeScreen({ onHint }: WelcomeScreenProps) {
  return (
    <div className="welcome">
      <div className="welcome-logo">HYSA</div>
      <div className="welcome-sub">How can HYSA help with this project?</div>
      <div className="welcome-hints">
        {HINTS.map((hint) => (
          <div key={hint} className="welcome-hint" onClick={() => onHint(hint)}>
            {hint}
          </div>
        ))}
      </div>
    </div>
  );
}
