'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { Activity, BarChart3, BriefcaseBusiness, ChevronLeft, ChevronRight, Monitor, TrendingDown, TrendingUp } from 'lucide-react';
import { SymbolSelector } from '@/components/custom/symbol-selector';
import type { ActiveSymbol, Tick, ProposalInfo, DurationLimits } from '@deriv/core';
import type { ContractMode, DigitStats, TradeType } from '@/lib/types';

const TRADE_TYPES: { value: TradeType; label: string }[] = [
  { value: 'matches-differs', label: 'Matches / Differs' },
  { value: 'over-under', label: 'Over / Under' },
  { value: 'even-odd', label: 'Even / Odd' },
];

const MODES: Record<TradeType, { value: ContractMode; label: string; direction: 'up' | 'down' }[]> = {
  'matches-differs': [
    { value: 'DIGITMATCH', label: 'Matches', direction: 'up' },
    { value: 'DIGITDIFF', label: 'Differs', direction: 'down' },
  ],
  'over-under': [
    { value: 'DIGITOVER', label: 'Over', direction: 'up' },
    { value: 'DIGITUNDER', label: 'Under', direction: 'down' },
  ],
  'even-odd': [
    { value: 'DIGITEVEN', label: 'Even', direction: 'up' },
    { value: 'DIGITODD', label: 'Odd', direction: 'down' },
  ],
};

interface MobileTradingTerminalProps {
  symbols: ActiveSymbol[];
  activeSymbol: ActiveSymbol | null;
  selectSymbol: (symbol: string) => void;
  currentTick: Tick | null;
  lastDigit: number | null;
  digitStats: DigitStats;
  pipSize: number;
  tradeType: TradeType;
  setTradeType: (type: TradeType) => void;
  contractMode: ContractMode;
  setContractMode: (mode: ContractMode) => void;
  selectedDigit: number;
  setSelectedDigit: (digit: number) => void;
  stake: string;
  setStake: (value: string) => void;
  duration: number;
  setDuration: (value: number) => void;
  durationLimits: DurationLimits;
  proposal: ProposalInfo | null;
  isConnected: boolean;
  isBuying: boolean;
  onBuy: () => void;
  isAuthenticated: boolean;
}

export function MobileTradingTerminal(props: MobileTradingTerminalProps) {
  const marketRef = useRef<HTMLElement>(null);
  const tradeRef = useRef<HTMLElement>(null);
  const {
    symbols, activeSymbol, selectSymbol, currentTick, lastDigit, digitStats, pipSize,
    tradeType, setTradeType, contractMode, setContractMode, selectedDigit, setSelectedDigit,
    stake, setStake, duration, setDuration, durationLimits, proposal, isConnected,
    isBuying, onBuy, isAuthenticated,
  } = props;
  const maxPct = Math.max(...digitStats.percentages);
  const minPct = Math.min(...digitStats.percentages);
  const modes = MODES[tradeType];
  const selectedMode = modes.find((mode) => mode.value === contractMode) ?? modes[0];

  return (
    <div className="mobile-terminal">
      <nav className="mobile-terminal-nav" aria-label="Trading sections">
        <button type="button" className="active" onClick={() => tradeRef.current?.scrollIntoView({ behavior: 'smooth' })}>
          <Monitor size={20} /> Manual Trader
        </button>
        <button type="button" onClick={() => marketRef.current?.scrollIntoView({ behavior: 'smooth' })}>
          <BarChart3 size={20} /> Markets
        </button>
        {isAuthenticated && <Link href="/reports"><BriefcaseBusiness size={20} /> Positions</Link>}
      </nav>

      <section ref={marketRef} className="mobile-market" aria-label="Live market">
        <div className="mobile-market-selector">
          <Activity size={30} aria-hidden />
          <div className="mobile-market-name">
            <span className="mobile-market-eyebrow">LIVE MARKET</span>
            <SymbolSelector symbols={symbols} activeSymbol={activeSymbol} onSymbolChange={selectSymbol} />
          </div>
        </div>
        <div className="mobile-market-quote" aria-live="off">
          {currentTick ? Number(currentTick.quote).toFixed(pipSize) : 'Waiting for ticks…'}
          {lastDigit !== null && <span className="mobile-market-last">Last digit {lastDigit}</span>}
        </div>
        <div className="mobile-digit-grid" aria-label="Last digit frequency">
          {digitStats.percentages.map((pct, digit) => {
            const selected = selectedDigit === digit;
            const highest = digitStats.totalTicks > 0 && pct === maxPct;
            const lowest = digitStats.totalTicks > 0 && pct === minPct;
            const accent = highest ? '#25aaa4' : lowest ? '#d84b55' : '#686d71';
            return (
              <button
                type="button"
                key={digit}
                onClick={() => setSelectedDigit(digit)}
                aria-label={`Digit ${digit}, ${pct.toFixed(1)} percent`}
                aria-pressed={selected}
                className={`mobile-digit ${selected ? 'selected' : ''}`}
                style={{ background: `conic-gradient(${accent} ${Math.min(pct * 3.6, 360)}deg, #282b2d 0)` }}
              >
                <span><strong>{digit}</strong><small>{pct.toFixed(1)}%</small></span>
              </button>
            );
          })}
        </div>
        <div className="mobile-market-scroll" aria-hidden><ChevronLeft size={22} /><span>Live digit statistics</span><ChevronRight size={22} /></div>
      </section>

      <section ref={tradeRef} className="mobile-trade" aria-label="Manual trading controls">
        <div className="mobile-trade-handle" aria-hidden />
        <p className="mobile-trade-kicker">MANUAL TRADER</p>
        <h2>{TRADE_TYPES.find((type) => type.value === tradeType)?.label}</h2>
        <div className="mobile-trade-types" role="group" aria-label="Trade type">
          {TRADE_TYPES.map((type) => (
            <button type="button" key={type.value} aria-pressed={tradeType === type.value} onClick={() => setTradeType(type.value)}>{type.label}</button>
          ))}
        </div>
        {tradeType !== 'even-odd' && (
          <div className="mobile-prediction" role="group" aria-label="Prediction digit">
            {Array.from({ length: 10 }, (_, digit) => (
              <button type="button" key={digit} aria-pressed={selectedDigit === digit} onClick={() => setSelectedDigit(digit)}>{digit}</button>
            ))}
          </div>
        )}
        <div className="mobile-trade-inputs">
          <label>Duration <span>Ticks</span>
            <input type="number" inputMode="numeric" min={durationLimits.min} max={durationLimits.max} value={duration} onChange={(event) => { const value = Number(event.target.value); if (Number.isInteger(value)) setDuration(value); }} />
          </label>
          <label>Stake <span>USD</span>
            <input type="number" inputMode="decimal" min="0.01" step="0.01" value={stake} onChange={(event) => setStake(event.target.value)} />
          </label>
        </div>
        <div className="mobile-direction" role="group" aria-label="Contract direction">
          {modes.map((mode) => (
            <button type="button" key={mode.value} className={`${mode.direction} ${contractMode === mode.value ? 'chosen' : ''}`} aria-pressed={contractMode === mode.value} onClick={() => setContractMode(mode.value)}>
              <span>{mode.direction === 'up' ? <TrendingUp size={22} /> : <TrendingDown size={22} />}{mode.label}</span>
              <small>{contractMode === mode.value && proposal ? `Payout ${proposal.payout.toFixed(2)} USD` : 'Select to see payout'}</small>
            </button>
          ))}
        </div>
        <button type="button" className="mobile-buy" disabled={!isConnected || !proposal || isBuying} onClick={onBuy}>
          {isBuying ? 'Purchasing…' : proposal ? `Buy ${selectedMode.label} @ ${proposal.askPrice.toFixed(2)} USD` : 'Waiting for price…'}
        </button>
        <p className="mobile-trade-note">Select a direction, review the live payout, then buy.</p>
      </section>
    </div>
  );
}
