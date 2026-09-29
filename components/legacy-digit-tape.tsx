'use client';

import { useEffect, useRef, useState } from 'react';
import type { Tick } from '@deriv/core';

/**
 * Old Deriv-style moving digit rail. Every new tick pushes the rail to the
 * left; the latest digit settles under the fixed circular cursor.
 */
export function LegacyDigitTape({ tick, lastDigit }: { tick: Tick | null; lastDigit: number | null }) {
  const [digits, setDigits] = useState<number[]>([]);
  const lastEpoch = useRef<number | string | null>(null);
  const lastSymbol = useRef<string | null>(null);

  useEffect(() => {
    if (lastDigit == null || !tick) return;
    const key = `${tick.epoch}-${tick.quote}`;
    if (lastEpoch.current === key) return;
    lastEpoch.current = key;
    const changedSymbol = lastSymbol.current !== tick.symbol;
    lastSymbol.current = tick.symbol;
    setDigits((previous) => [...(changedSymbol ? [] : previous), lastDigit].slice(-11));
  }, [tick, lastDigit]);

  return (
    <div className="legacy-digit-panel" aria-label="Live last digit movement">
      <div className="legacy-digit-title">Last digit</div>
      <div className="legacy-digit-window">
        <div className="legacy-cursor-line" />
        <div className="legacy-cursor-arrow" />
        <div className="legacy-digit-rail" key={String(lastEpoch.current)}>
          {digits.map((digit, index) => {
            const isLatest = index === digits.length - 1;
            return (
              <div className={`legacy-digit-circle ${isLatest ? 'is-current' : ''}`} key={`${index}-${digit}`}>
                {digit}
              </div>
            );
          })}
        </div>
        {digits.length === 0 && <span className="legacy-digit-empty">Waiting for live ticks…</span>}
      </div>
      <div className="legacy-digit-caption">The latest digit appears beneath the cursor</div>
    </div>
  );
}
