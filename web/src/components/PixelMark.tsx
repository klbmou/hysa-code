import React from 'react';

interface PixelMarkProps {
  size: number;
  className?: string;
  showLabel?: boolean;
}

const DOTS: [number, number, number][] = [
  [24, 24, 0.10], [42, 22, 0.14], [60, 24, 0.10], [78, 23, 0.08],
  [18, 38, 0.08], [36, 40, 0.12], [54, 38, 0.10], [72, 40, 0.08],
  [24, 56, 0.10], [42, 54, 0.08], [60, 56, 0.12], [78, 56, 0.08],
];

export default function PixelMark({ size, className, showLabel = false }: PixelMarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true" className={className}>
      <defs>
        <filter id="pixelGlow">
          <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="rgba(160,112,240,0.25)" />
        </filter>
      </defs>
      <rect x="5" y="5" width="90" height="90" rx="10" ry="10" stroke="rgba(255,255,255,0.32)" strokeWidth="1.5" />
      <rect x="14" y="12" width="72" height="62" rx="4" ry="4" stroke="rgba(255,255,255,0.10)" strokeWidth="0.8" fill="rgba(0,0,0,0.12)" />
      <line x1="14" y1="76" x2="86" y2="76" stroke="rgba(255,255,255,0.06)" strokeWidth="0.5" />
      {DOTS.map(([x, y, o], i) => (
        <circle key={i} cx={x} cy={y} r="2" fill={`rgba(255,255,255,${o})`} />
      ))}
      <text x="46" y="68" fill="rgba(160,112,240,0.65)" fontFamily="'VT323','Courier New',monospace" fontSize="20" fontWeight="600" filter="url(#pixelGlow)">{'>'}_</text>
      {showLabel && (
        <text x="50" y="89" fill="rgba(255,255,255,0.35)" fontFamily="'VT323','Courier New',monospace" fontSize="16" fontWeight="500" textAnchor="middle" letterSpacing="3">HYSA</text>
      )}
    </svg>
  );
}
