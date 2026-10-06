'use client';

import { useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { Activity, BarChart3, BriefcaseBusiness, House, ChevronLeft, ChevronRight, Monitor, TrendingDown, TrendingUp } from 'lucide-react';
import { AdvancedManualTrader } from './advanced-manual-trader';
import { ManualTradeTypePicker } from './manual-trade-type-picker';
import { isAdvancedTrade, type AdvancedTradeType } from '@/lib/manual-trades';
import { SymbolSelector } from '@/components/custom/symbol-selector';
import type { ActiveSymbol, Tick, ProposalInfo, DurationLimits } from '@deriv/core';
import type { ContractDigitResult } from '@/lib/contract-digit-result';
import type { ContractMode, DigitStats, TradeType } from '@/lib/types';

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
  contractDigitResult?: ContractDigitResult | null;
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
  modeProposals?: Partial<Record<ContractMode, ProposalInfo | null>>;
  onBuy: (mode?: ContractMode) => void;
  isAuthenticated: boolean;
}

export function MobileTradingTerminal(props: MobileTradingTerminalProps) {
  const marketRef = useRef<HTMLElement>(null);
  const tradeRef = useRef<HTMLElement>(null);
  const [advancedType, setAdvancedType] = useState<AdvancedTradeType | null>(null);
  const [advancedBusy, setAdvancedBusy] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [selector, setSelector] = useState<'duration' | 'amount' | null>(null);
  const [draftTicks, setDraftTicks] = useState(1);
  const [draftStake, setDraftStake] = useState('');
  const [selectorError, setSelectorError] = useState('');
  const openSelector = (tab: 'duration' | 'amount') => {
    setDraftTicks(props.duration); setDraftStake(props.stake);
    setSelectorError(''); setSelector(tab);
  };
  const confirmSelector = () => {
    if (!Number.isInteger(draftTicks) || draftTicks < props.durationLimits.min || draftTicks > props.durationLimits.max) {
      setSelectorError(`Choose between ${props.durationLimits.min} and ${props.durationLimits.max} ticks.`); return;
    }
    if (!Number.isFinite(Number(draftStake)) || Number(draftStake) <= 0) {
      setSelectorError('Stake must be greater than 0.'); return;
    }
    props.setDuration(draftTicks); props.setStake(Number(draftStake).toFixed(2)); setSelector(null);
  };
  const keypad = (key: string) => {
    setSelectorError('');
    setDraftStake(previous => {
      if (key === 'delete') return previous.slice(0, -1);
      if (key === '.' && previous.includes('.')) return previous;
      if (previous.includes('.') && previous.split('.')[1].length >= 2) return previous;
      return (previous === '0' && key !== '.' ? key : previous + key).slice(0, 12);
    });
  };
  const {
    symbols, activeSymbol, selectSymbol, currentTick, lastDigit, digitStats, pipSize,
    tradeType, setTradeType, contractMode, setContractMode, selectedDigit, setSelectedDigit,
    stake, setStake, duration, setDuration, durationLimits, proposal, isConnected,
    isBuying, onBuy, isAuthenticated, modeProposals, contractDigitResult,
  } = props;
  const maxPct = Math.max(...digitStats.percentages);
  const minPct = Math.min(...digitStats.percentages);
  const modes = MODES[tradeType];
  const result = contractDigitResult?.symbol === activeSymbol?.underlying_symbol ? contractDigitResult : null;
  const resultClass = result ? result.profit > 0 ? 'contract-won' : result.profit < 0 ? 'contract-lost' : '' : '';
  const cursorDigit = result?.digit ?? lastDigit;
  const cursorStyle = cursorDigit === null ? undefined : {
    left: `${((cursorDigit! % 5) + 0.5) * 20}%`,
    top: cursorDigit! < 5 ? 'calc(var(--digit-size) + 4px)' : 'calc(var(--digit-size) * 2 + 22px)',
  } as CSSProperties;

  return (
    <div className="mobile-terminal">
      <nav className="mobile-terminal-nav" aria-label="Trading sections">
        <Link href="/dashboard"><House size={20} /> Dashboard</Link>
        <button type="button" className="active" onClick={() => tradeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}>
          <Monitor size={20} /> Manual Trader
        </button>
        <Link href="/smart-ai"><Activity size={20} /> Smart AI</Link>
        <Link href="/copy-trading"><BriefcaseBusiness size={20} /> Copy Trading</Link>
        <Link href="/tick-analysis"><Activity size={20} /> Tick Analysis</Link>
        <Link href="/charts">
          <BarChart3 size={20} /> Charts
        </Link>
        <Link href="/academy"><BriefcaseBusiness size={20} /> Academy</Link>
      </nav>

      {selector && <dialog ref={node => { if (node && !node.open) node.showModal(); }} aria-label="Select duration and stake" onCancel={() => setSelector(null)} style={{ position: 'fixed', inset: 0, width: '100%', height: '100dvh', maxWidth: 'none', maxHeight: 'none', margin: 0, padding: '72px 12px 30px', border: 0, background: 'rgba(0,0,0,.72)', color: '#fff', zIndex: 100 }} onKeyDown={event => { if (event.key === 'Escape') setSelector(null); }} onClick={event => { if (event.target === event.currentTarget) setSelector(null); }}>
        <div style={{ position: 'relative', maxWidth: 420, minHeight: 470, margin: 'auto', padding: '32px 0', background: '#111314', boxShadow: '0 16px 60px #000' }}>
          <button type="button" autoFocus aria-label="Close selector without saving" onClick={() => setSelector(null)} style={{ position: 'absolute', right: 14, top: 8, padding: 8, fontSize: 24 }}>×</button>
          <div role="tablist" aria-label="Trade settings" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', marginTop: 10 }}>
            {(['duration', 'amount'] as const).map(tab => <button type="button" role="tab" aria-selected={selector === tab} key={tab} onClick={() => { setSelector(tab); setSelectorError(''); }} style={{ padding: '10px 4px', borderBottom: selector === tab ? '2px solid #e53250' : '2px solid transparent', color: selector === tab ? '#fff' : '#999' }}>
              <span style={{ display: 'block' }}>{tab === 'duration' ? 'Duration' : 'Amount'}</span>
              <small>{tab === 'duration' ? `${draftTicks} ${draftTicks === 1 ? 'Tick' : 'Ticks'}` : `${draftStake || '0'} USD`}</small>
            </button>)}
          </div>
          {selector === 'duration' ? <div style={{ padding: '54px 24px 24px', textAlign: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around' }}>
              <button type="button" aria-label="Decrease ticks" disabled={draftTicks <= durationLimits.min} onClick={() => setDraftTicks(value => Math.max(durationLimits.min, value - 1))} style={{ fontSize: 32, padding: 16 }}>−</button>
              <strong style={{ fontSize: 80, lineHeight: 1.2, fontWeight: 400, color: '#e53250' }}>{String(draftTicks).padStart(2, '0')}</strong>
              <button type="button" aria-label="Increase ticks" disabled={draftTicks >= durationLimits.max} onClick={() => setDraftTicks(value => Math.min(durationLimits.max, value + 1))} style={{ fontSize: 32, padding: 16 }}>+</button>
            </div>
            <p style={{ color: '#e53250', marginTop: 8 }}>{draftTicks === 1 ? 'Tick' : 'Ticks'}</p>
            <button type="button" onClick={confirmSelector} style={{ marginTop: 34, padding: '14px 38px', background: '#0c0e0f', fontWeight: 700 }}>OK</button>
          </div> : <div>
            <div style={{ padding: 12, borderBottom: '2px solid #e53250', textAlign: 'center', fontWeight: 700 }}>Stake</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '24px 48px 12px', background: '#0c0e0f' }}>
              <button type="button" aria-label="Decrease stake" onClick={() => setDraftStake(Math.max(0.01, Number(draftStake || 0) - 1).toFixed(2))} style={{ padding: 12, fontSize: 24 }}>−</button>
              <input aria-label="Stake amount" type="text" inputMode="decimal" value={draftStake} onChange={event => { if (/^\d*(\.\d{0,2})?$/.test(event.target.value)) { setDraftStake(event.target.value); setSelectorError(''); } }} style={{ width: '60%', background: 'transparent', color: '#fff', border: 0, textAlign: 'center', fontSize: 18, fontWeight: 700 }} />
              <button type="button" aria-label="Increase stake" onClick={() => setDraftStake((Number(draftStake || 0) + 1).toFixed(2))} style={{ padding: 12, fontSize: 24 }}>+</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr) 1.15fr', gap: 8, padding: '0 48px' }}>
              {['7','8','9','delete','4','5','6','OK','1','2','3','0','.'].map((key, index) => key ? <button type="button" key={index} aria-label={key === 'delete' ? 'Delete last digit' : key} onClick={() => key === 'OK' ? confirmSelector() : keypad(key)} style={{ minHeight: 52, background: '#0c0e0f', gridColumn: key === 'delete' || key === 'OK' ? 4 : key === '0' ? 2 : key === '.' ? 3 : key === '7' || key === '4' || key === '1' ? 1 : key === '8' || key === '5' || key === '2' ? 2 : 3, gridRow: key === 'delete' ? '1 / span 2' : key === 'OK' ? '3 / span 2' : key === '7' || key === '8' || key === '9' ? 1 : key === '4' || key === '5' || key === '6' ? 2 : key === '1' || key === '2' || key === '3' ? 3 : 4, fontWeight: key === 'OK' ? 700 : 400 }}>{key === 'delete' ? '⌫' : key}</button> : <span key={index} />)}
            </div>
          </div>}
          {selectorError && <p role="alert" style={{ color: '#ff5269', textAlign: 'center', padding: 16 }}>{selectorError}</p>}
        </div>
      </dialog>}

      <section ref={marketRef} className="mobile-market" aria-label="Live market">
        <div className="mobile-market-selector">
          <div className="mobile-market-icon"><Activity size={24} aria-hidden /><small>100 ¹ˢ</small></div>
          <div className="mobile-market-name">
            <SymbolSelector symbols={symbols} activeSymbol={activeSymbol} onSymbolChange={selectSymbol} />
            <span className="mobile-market-subquote">{currentTick ? Number(currentTick.quote).toFixed(pipSize) : 'Waiting for ticks…'} <span>▲</span></span>
          </div>
        </div>
        <p className="mobile-stats-caption">Last digit stats for latest {digitStats.totalTicks} ticks{activeSymbol ? ` for ${activeSymbol.underlying_symbol_name}` : ''}</p>
        {result && <div className={`mobile-contract-tick ${resultClass}`} role="status">
          Tick {result.ticks} - <strong>{result.price.slice(0, -1)}<span>{result.digit}</span></strong>
        </div>}
        <div className="mobile-digit-grid" aria-label="Last digit frequency">
          {cursorDigit !== null && <span className={`mobile-digit-cursor ${resultClass}`} style={cursorStyle} aria-label={`Cursor on digit ${cursorDigit}`} />}
          {digitStats.percentages.map((pct, digit) => {
            const selected = selectedDigit === digit;
            const isLatest = lastDigit === digit;
            const isResult = result?.digit === digit;
            const highest = digitStats.totalTicks > 0 && pct === maxPct;
            const lowest = digitStats.totalTicks > 0 && pct === minPct;
            const accent = highest ? '#25aaa4' : lowest ? '#d84b55' : '#686d71';
            return (
              <button
                type="button"
                key={digit}
                onClick={() => setSelectedDigit(digit)}
                aria-label={`Digit ${digit}, ${pct.toFixed(1)} percent${isResult && resultClass === 'contract-won' ? ', winning contract digit' : ''}`}
                aria-pressed={selected}
                className={`mobile-digit ${selected ? 'selected' : ''} ${isLatest && !result ? 'latest' : ''} ${isResult ? resultClass : ''}`}
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
        <ManualTradeTypePicker value={advancedType ?? tradeType} disabled={isBuying || advancedBusy} onChange={value => {
          if (isAdvancedTrade(value)) setAdvancedType(value);
          else { setAdvancedType(null); setTradeType(value); }
        }} />
        {advancedType ? <AdvancedManualTrader key={advancedType} type={advancedType} onBusy={setAdvancedBusy} onSymbolChange={selectSymbol} initialSymbol={activeSymbol?.underlying_symbol} /> : <>
        <button type="button" className="mobile-learn" onClick={() => setShowHelp(show => !show)} aria-expanded={showHelp}>Learn about this trade type</button>
        {showHelp && <p className="mobile-help">{tradeType === 'over-under' ? 'Over wins when the final digit is higher than your prediction; Under wins when it is lower. An equal digit loses.' : tradeType === 'even-odd' ? 'Even wins on 0, 2, 4, 6 or 8. Odd wins on 1, 3, 5, 7 or 9.' : 'Matches wins when the final digit equals your prediction. Differs wins when it does not.'}</p>}
        {tradeType !== 'even-odd' && (
          <div className="mobile-prediction" role="group" aria-label="Prediction digit">
            {Array.from({ length: 10 }, (_, digit) => (
              <button type="button" key={digit} aria-pressed={selectedDigit === digit} onClick={() => setSelectedDigit(digit)}>{digit}</button>
            ))}
          </div>
        )}
        <div className="mobile-trade-inputs">
          <button type="button" aria-label="Select duration in ticks" disabled={isBuying} onClick={() => openSelector('duration')} style={{ padding: '12px 6px', textAlign: 'left' }}>{duration} {duration === 1 ? 'tick' : 'ticks'}</button>
          <button type="button" aria-label="Select stake in USD" disabled={isBuying} onClick={() => openSelector('amount')} style={{ padding: '12px 6px', fontWeight: 700 }}>{Number(stake || 0).toFixed(2)} USD</button>
          <span className="mobile-stake-caption">Stake</span>
        </div>
        <div className="mobile-direction" role="group" aria-label="Contract direction">
          {modes.map((mode) => (
            <button type="button" key={mode.value} className={`${mode.direction} ${contractMode === mode.value ? 'chosen' : ''}`} aria-label={`Buy ${mode.label}`} disabled={!isConnected || !modeProposals?.[mode.value] || isBuying} onClick={() => { setContractMode(mode.value); onBuy(mode.value); }}>
              <span>{mode.direction === 'up' ? <TrendingUp size={22} /> : <TrendingDown size={22} />}{mode.label}</span>
              <small><span>Payout</span><strong>{modeProposals?.[mode.value] ? `${modeProposals[mode.value]!.payout.toFixed(2)} USD` : '—'}</strong></small>
            </button>
          ))}
        </div>
        <p className="mobile-trade-note">{isBuying ? 'Purchasing…' : 'Tap a direction to purchase at the displayed payout.'}</p>
        </>}
      </section>
    </div>
  );
}

