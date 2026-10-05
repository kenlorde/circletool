'use client';

import { useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { Activity, BarChart3, BriefcaseBusiness, ChevronDown, ChevronLeft, ChevronRight, Monitor, TrendingDown, TrendingUp } from 'lucide-react';
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
  const [showTradeTypes, setShowTradeTypes] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
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
  const cursorStyle = lastDigit === null ? undefined : {
    left: `${((lastDigit % 5) + 0.5) * 20}%`,
    top: lastDigit < 5 ? 'calc(var(--digit-size) + 4px)' : 'calc(var(--digit-size) * 2 + 22px)',
  } as CSSProperties;

  return (
    <div className="mobile-terminal">
      <nav className="mobile-terminal-nav" aria-label="Trading sections">
        <button type="button" className="active" onClick={() => tradeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}>
          <Monitor size={20} /> Manual Trader
        </button>
        <Link href="/copy-trading"><BriefcaseBusiness size={20} /> Copy Trading</Link>
        <button type="button" onClick={() => marketRef.current?.scrollIntoView({ behavior: 'smooth' })}>
          <BarChart3 size={20} /> Charts
        </button>
        {isAuthenticated && <Link href="/reports"><BriefcaseBusiness size={20} /> Positions</Link>}
      </nav>

      <section ref={marketRef} className="mobile-market" aria-label="Live market">
        <div className="mobile-market-selector">
          <div className="mobile-market-icon"><Activity size={24} aria-hidden /><small>100 ¹ˢ</small></div>
          <div className="mobile-market-name">
            <SymbolSelector symbols={symbols} activeSymbol={activeSymbol} onSymbolChange={selectSymbol} />
            <span className="mobile-market-subquote">{currentTick ? Number(currentTick.quote).toFixed(pipSize) : 'Waiting for ticks…'} <span>▲</span></span>
          </div>
        </div>
        <p className="mobile-stats-caption">Last digit stats for latest {digitStats.totalTicks} ticks{activeSymbol ? ` for ${activeSymbol.underlying_symbol_name}` : ''}</p>
        <div className="mobile-digit-grid" aria-label="Last digit frequency">
          {lastDigit !== null && <span className="mobile-digit-cursor" style={cursorStyle} aria-label={`Moving cursor on digit ${lastDigit}`} />}
          {digitStats.percentages.map((pct, digit) => {
            const selected = selectedDigit === digit;
            const isLatest = lastDigit === digit;
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
                className={`mobile-digit ${selected ? 'selected' : ''} ${isLatest ? 'latest' : ''}`}
                style={{ background: `conic-gradient(${accent} ${Math.min(pct * 18, 360)}deg, #282b2d 0)`, '--digit-ring': `conic-gradient(${accent} ${Math.min(pct * 18, 360)}deg, #282b2d 0)` } as CSSProperties}
              >
                <span><strong>{digit}</strong><small>{pct.toFixed(1)}%</small></span>
              </button>
            );
          })}
        </div>
        <div className="mobile-market-scroll" aria-hidden><ChevronLeft size={26} /><ChevronRight size={26} /></div>
      </section>

      <section ref={tradeRef} className="mobile-trade" aria-label="Manual trading controls">
        <div className="mobile-trade-handle" aria-hidden />
        <button type="button" className="mobile-learn" onClick={() => setShowHelp((show) => !show)} aria-expanded={showHelp}>Learn about this trade type</button>
        {showHelp && <p className="mobile-help">{tradeType === 'over-under' ? 'Over wins when the final digit is higher than your prediction; Under wins when it is lower. An equal digit loses.' : tradeType === 'even-odd' ? 'Even wins on 0, 2, 4, 6 or 8. Odd wins on 1, 3, 5, 7 or 9.' : 'Matches wins when the final digit equals your prediction. Differs wins when it does not.'}</p>}
        <div className="mobile-trade-title-row">
          <button type="button" className="mobile-trade-title" onClick={() => setShowTradeTypes((show) => !show)} aria-expanded={showTradeTypes}>
            <span className="mobile-trade-symbol"><TrendingUp size={20} /><TrendingDown size={20} /></span>
            <span>{TRADE_TYPES.find((type) => type.value === tradeType)?.label}</span><ChevronDown size={17} />
          </button>
          <button type="button" className="mobile-help-orb" aria-label="Trade help" onClick={() => setShowHelp((show) => !show)}>?</button>
        </div>
        {showTradeTypes && <div className="mobile-trade-types" role="dialog" aria-modal="true" aria-label="Trade types">
          <div className="mobile-types-heading"><strong>Trade types</strong><button type="button" aria-label="Close trade types" onClick={() => setShowTradeTypes(false)}>×</button></div>
          <p>Digits</p>
          {TRADE_TYPES.map((type) => <button type="button" key={type.value} aria-pressed={tradeType === type.value} onClick={() => { setTradeType(type.value); setShowTradeTypes(false); }}>{type.label}</button>)}
        </div>}
        {tradeType !== 'even-odd' && (
          <div className="mobile-prediction" role="group" aria-label="Prediction digit">
            {Array.from({ length: 10 }, (_, digit) => (
              <button type="button" key={digit} aria-pressed={selectedDigit === digit} onClick={() => setSelectedDigit(digit)}>{digit}</button>
            ))}
          </div>
        )}
        <div className="mobile-trade-inputs">
          <label><span>ticks</span>
            <input aria-label="Duration in ticks" type="number" inputMode="numeric" min={durationLimits.min} max={durationLimits.max} value={duration} onChange={(event) => { const value = Number(event.target.value); if (Number.isInteger(value)) setDuration(value); }} />
          </label>
          <label><span>USD</span>
            <input aria-label="Stake in USD" type="number" inputMode="decimal" min="0.01" step="0.01" value={stake} onChange={(event) => setStake(event.target.value)} />
          </label>
          <span className="mobile-stake-caption">Stake</span>
        </div>
        <div className="mobile-direction" role="group" aria-label="Contract direction">
          {modes.map((mode) => (
            <button type="button" key={mode.value} className={`${mode.direction} ${contractMode === mode.value ? 'chosen' : ''}`} aria-pressed={contractMode === mode.value} onClick={() => setContractMode(mode.value)}>
              <span>{mode.direction === 'up' ? <TrendingUp size={22} /> : <TrendingDown size={22} />}{mode.label}</span>
              <small><span>Payout</span><strong>{contractMode === mode.value && proposal ? `${proposal.payout.toFixed(2)} USD` : '—'}</strong></small>
            </button>
          ))}
        </div>
        <button type="button" className="mobile-buy" disabled={!isConnected || !proposal || isBuying} onClick={onBuy}>
          {isBuying ? 'Purchasing…' : proposal ? `Buy ${selectedMode.label} @ ${proposal.askPrice.toFixed(2)} USD` : 'Waiting for price…'}
        </button>
        <p className="mobile-trade-note">Check the payout before placing a trade.</p>
      </section>
    </div>
  );
}
