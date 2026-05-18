import React from 'react';

interface WelcomeScreenProps {
  onHint: (msg: string) => void;
  fileCount?: number;
  status?: { provider: string; model: string; tier?: string } | null;
  yolo?: boolean;
}

const CARDS = [
  { icon: '</>', title: 'Explain this project', action: 'Read the project files and explain the architecture, structure, and purpose of this codebase.' },
  { icon: '🐛', title: 'Find bugs', action: 'Analyze the codebase for potential bugs, edge cases, and logic errors.' },
  { icon: '✨', title: 'Create a feature', action: 'Design and implement a new feature for this project. Start by reading the relevant files.' },
  { icon: '🎨', title: 'Improve UI', action: 'Review the UI components and suggest improvements for layout, styling, and user experience.' },
  { icon: '🧪', title: 'Generate tests', action: 'Generate comprehensive unit or integration tests for the project files.' },
  { icon: '🔧', title: 'Refactor safely', action: 'Refactor the codebase to improve maintainability without breaking existing functionality.' },
];

export default function WelcomeScreen({ onHint, fileCount, status, yolo }: WelcomeScreenProps) {
  return (
    <div className="welcome">
      <div className="welcome-glow" />
      <div className="welcome-mascot">
        <div className="welcome-mascot-body"><span>&gt;_</span></div>
      </div>
      <h1 className="welcome-title">What are we building today?</h1>
      <p className="welcome-sub">Ask HYSA to inspect files, edit code, run commands, explain bugs, or improve your project safely.</p>

      {status && (
        <div className="welcome-summary">
          <div className="welcome-summary-item"><span className="welcome-summary-icon">📁</span> {fileCount ?? 0} files</div>
          <div className="welcome-summary-item"><span className="welcome-summary-icon">⚡</span> {status.provider} · {status.model}</div>
          <div className="welcome-summary-item">
            <span className={`welcome-summary-dot ${yolo ? 'yolo' : 'safe'}`} />
            {yolo ? 'YOLO mode' : 'Safe mode'}
          </div>
        </div>
      )}

      <div className="welcome-cards">
        {CARDS.map(c => (
          <div key={c.title} className="welcome-card" onClick={() => onHint(c.action)}>
            <span className="welcome-card-icon">{c.icon}</span>
            <div className="welcome-card-body">
              <span className="welcome-card-title">{c.title}</span>
              <span className="welcome-card-desc">{c.action}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
