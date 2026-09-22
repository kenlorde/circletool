'use client';

import { Localize } from '@deriv-com/translations';
import type { Tick } from '../lib/types';
import type { ActiveSymbol } from '../lib/types';

interface CurrentTickDisplayProps {
  tick: Tick | null;
  lastDigit: number | null;
  activeSymbol: ActiveSymbol | null;
  pipSize: number;
}

export function CurrentTickDisplay({
  tick,
  lastDigit,
  activeSymbol,
  pipSize,
}: CurrentTickDisplayProps) {
  if (!tick || !activeSymbol) {
    return (
      <div className="py-6 text-center">
        <div className="font-mono text-2xl text-muted-foreground">
          ---
        </div>
      </div>
    );
  }

  const priceStr = tick.quote.toFixed(pipSize);
  const priceWithoutLast = priceStr.slice(0, -1);
  const lastDigitStr = priceStr.slice(-1);

  const digit = lastDigit ?? Number(lastDigitStr);
  const cursorPosition = Math.max(0, Math.min(9, digit)) * 10;

  return (
    <div className="w-full py-4">
      {/* Live price */}
      <div className="text-center">
        <div className="font-mono text-2xl sm:text-4xl font-bold tracking-wide">
          <span className="text-foreground">
            {priceWithoutLast}
          </span>

          <span className="text-primary text-3xl sm:text-5xl">
            {lastDigitStr}
          </span>
        </div>
      </div>

      {/* Moving cursor area */}
      <div className="relative mt-6 mx-auto w-[90%] max-w-xl pt-8">

        {/* Track */}
        <div className="h-[2px] w-full bg-border" />

        {/* Moving circle */}
        <div
          className="absolute top-0 -translate-x-1/2 transition-all duration-300 ease-out"
          style={{
            left: `calc(${cursorPosition}% + 5%)`,
          }}
        >
          <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold shadow-lg">
            {digit}
          </div>

          <div className="mx-auto h-3 w-[2px] bg-primary" />
        </div>

        {/* Digits 0 - 9 */}
        <div className="mt-3 grid grid-cols-10 text-center text-xs sm:text-sm text-muted-foreground">
          {Array.from({ length: 10 }, (_, number) => (
            <span
              key={number}
              className={
                number === digit
                  ? 'font-bold text-primary'
                  : ''
              }
            >
              {number}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-4 text-center text-xs text-muted-foreground">
        <Localize i18n_default_text="Last Digit:" />{' '}
        <span className="font-bold text-foreground">
          {digit}
        </span>
      </div>
    </div>
  );
}
