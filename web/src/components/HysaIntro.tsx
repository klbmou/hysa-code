import React, { useEffect, useState } from 'react';
import PixelMark from './PixelMark.js';

export default function HysaIntro({ onDone }: { onDone: () => void }) {
  const [showText, setShowText] = useState(false);
  const [showSub, setShowSub] = useState(false);
  const [fade, setFade] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setShowText(true), 120);
    const t2 = setTimeout(() => setShowSub(true), 380);
    const t3 = setTimeout(() => setFade(true), 1300);
    const t4 = setTimeout(() => onDone(), 1700);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); clearTimeout(t4); };
  }, [onDone]);

  return (
    <div className={`hysa-intro ${fade ? 'hysa-intro-fade' : ''}`}>
      <div className="hysa-intro-scanlines" />
      <div className="hysa-intro-content">
        <div className="hysa-intro-mark">
          <PixelMark size={128} showLabel />
        </div>
        <div className="hysa-intro-brand">
          {showText && (
            <>
              <span className="hysa-label-text">HYSA</span>
              <span className="hysa-label-cursor">_</span>
            </>
          )}
        </div>
        {showSub && (
          <div className="hysa-intro-sub">
            <span className="hysa-sub-text">loading console...</span>
            <span className="hysa-sub-cursor">_</span>
          </div>
        )}
      </div>
    </div>
  );
}
