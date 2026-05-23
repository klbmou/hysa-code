import React from 'react';
import PixelMark from './PixelMark.js';

interface WelcomeScreenProps {
  onHint: (msg: string) => void;
  fileCount?: number;
  status?: { provider: string; model: string; tier?: string } | null;
  yolo?: boolean;
}

const CARDS = [
  { icon: '</>', label: 'Explain project', action: 'Read the project files and explain the architecture, structure, and purpose of this codebase.' },
  { icon: '!', label: 'Find bugs', action: 'Analyze the codebase for potential bugs, edge cases, and logic errors.' },
  { icon: '+', label: 'Create feature', action: 'Design and implement a new feature for this project. Start by reading the relevant files.' },
  { icon: '~', label: 'Improve UI', action: 'Review the UI components and suggest improvements for layout, styling, and user experience.' },
  { icon: 'T', label: 'Generate tests', action: 'Generate comprehensive unit or integration tests for the project files.' },
  { icon: '*', label: 'Refactor safely', action: 'Refactor the codebase to improve maintainability without breaking existing functionality.' },
];

function PixelIcon({ char }: { char: string }) {
  return (
    <span className="pixel-card-icon">{char}</span>
  );
}

export default function WelcomeScreen({ onHint, fileCount, status, yolo }: WelcomeScreenProps) {
  return (
    <div className="welcome">
      <div className="welcome-glow" />
      <div className="welcome-mascot">
        <PixelMark size={80} className="welcome-pixel-mark" />
      </div>
      <h1 className="welcome-title">What can I help you with?</h1>
      <p className="welcome-sub">Ask HYSA to inspect, edit, debug, explain, or improve your project.</p>

      {status && (
        <div className="welcome-summary">
          <div className="pixel-chip"><span className="pixel-chip-dot files" />{fileCount ?? 0} files</div>
          <div className="pixel-chip"><span className="pixel-chip-dot provider" />{status.provider}</div>
          <div className="pixel-chip">
            <span className={`pixel-chip-dot ${yolo ? 'yolo' : 'safe'}`} />
            {yolo ? 'YOLO' : 'Safe'}
          </div>
        </div>
      )}

      <div className="welcome-cards">
        {CARDS.map(c => (
          <div key={c.label} className="pixel-card" onClick={() => onHint(c.action)}>
            <PixelIcon char={c.icon} />
            <span className="pixel-card-label">{c.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
