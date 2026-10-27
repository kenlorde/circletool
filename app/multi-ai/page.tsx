'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useActiveSymbols, useTicks } from '@deriv/core';
import Link from 'next/link';
import { Activity, BarChart3, Bot, BriefcaseBusiness, House, Monitor } from 'lucide-react';
import { Header } from '@/components/custom/header';
import { useDerivWSContext } from '@/components/custom/deriv-ws-provider';
import { useLogoSrc } from '@/components/custom/logo-src-provider';
import { ThemeToggle } from '@/components/custom/theme-toggle';
import './style.css';

const CONTRACTS = ['DIGITOVER', 'DIGITUNDER'];
const SECTIONS = [
  { href: '/dashboard', title: 'Dashboard', icon: House },
  { href: '/', title: 'Manual Trader', icon: Monitor },
  { href: '/smart-scanner', title: 'Smart Scanner', icon: Bot },
  { href: '/smart-ai', title: 'Smart AI', icon: Bot },
  { href: '/multi-ai', title: 'Multi AI', icon: Bot },
  { href: '/copy-trading', title: 'Copy Trading', icon: BriefcaseBusiness },
  { href: '/tick-analysis', title: 'Tick Analysis', icon: Activity },
  { href: '/charts', title: 'Charts', icon: BarChart3 },
  { href: '/academy', title: 'Academy', icon: Monitor },
];
type Quote = { id: string; ask_price: number; payout: number; longcode: string };
async function timeout<T>(promise: Promise<T>, ms = 15000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error('Request timed out. Check Positions before placing more trades.')), ms); })]); }
  finally { clearTimeout(timer!); }
}
export default function MultiAI() {
  const { ws, isConnected, auth } = useDerivWSContext();
  const logoSrc = useLogoSrc();
  const { symbols, activeSymbol, selectSymbol } = useActiveSymbols(ws, isConnected, CONTRACTS);
  const [windowSize, setWindowSize] = useState('1000');
  const countTicks = Math.max(1, Math.min(5000, Number(windowSize) || 1));
  const { prices, currentTick, pipSize } = useTicks(ws, isConnected, activeSymbol, countTicks);
  const [barrier, setBarrier] = useState('7');
  const [duration, setDuration] = useState('1');
  const [stake, setStake] = useState('0.35');
  const [count, setCount] = useState('10');
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [message, setMessage] = useState('');
  const [running, setRunning] = useState(false);
  const [sent, setSent] = useState(0);
  const stop = useRef(false);
  const locked = useRef(false);
  const account = useRef({ ws, id: auth.activeAccountId, ready: false });
  const ready = !!ws && isConnected && auth.authState === 'authenticated' && !!auth.wsUrl && auth.activeAccount?.account_type === 'real';
  account.current = { ws, id: auth.activeAccountId, ready };
  const currency = auth.activeAccount?.currency || 'USD';
  const key = JSON.stringify([activeSymbol?.underlying_symbol, barrier, duration, stake, currency, auth.activeAccountId]);
  const currentKey = useRef(key); currentKey.current = key;
  const digits = useMemo(() => prices.map(p => Number(Number(p).toFixed(pipSize).slice(-1))).filter(Number.isFinite), [prices, pipSize]);
  const valid = Number.isInteger(Number(count)) && Number(count) >= 1 && Number(count) <= 1000 && Number(stake) > 0 && Number.isInteger(Number(barrier)) && Number(barrier) >= 0 && Number(barrier) <= 9 && Number.isInteger(Number(duration)) && Number(duration) >= 1 && Number(duration) <= 10;
  const payload = (side: string) => ({ proposal: 1, amount: Number(stake), basis: 'stake', contract_type: side, currency, duration: Number(duration), duration_unit: 't', underlying_symbol: activeSymbol?.underlying_symbol, barrier: String(barrier) });
  useEffect(() => { stop.current = true; return () => { stop.current = true; }; }, [ws, auth.activeAccountId]);
  useEffect(() => { setQuotes({}); if (!ws || !isConnected || !activeSymbol || !valid) return; let cancelled = false; Promise.all(CONTRACTS.map(async side => { try { const response = await timeout(ws.send<{ proposal?: Quote }>(payload(side))); return [side, response.proposal] as const; } catch { return [side, undefined] as const; } })).then(values => { if (!cancelled) setQuotes(Object.fromEntries(values.filter((entry): entry is readonly [string, Quote] => !!entry[1]))); }); return () => { cancelled = true; }; }, [key, isConnected, ws, valid]);
  async function buy(side: string) {
    if (locked.current || !ws || !ready || !valid || !activeSymbol) { setMessage('Log in to a real account and check your settings.'); return; }
    const displayed = quotes[side];
    if (!displayed || !Number.isFinite(Number(displayed.ask_price))) { setMessage('Live quote unavailable. Change a setting to request a fresh quote.'); return; }
    const total = Number(displayed.ask_price) * Number(count);
    if (!window.confirm(`Buy up to ${count} ${side === 'DIGITOVER' ? 'Over' : 'Under'} ${barrier} contracts? Maximum total cost: ${total.toFixed(2)} ${currency}. Purchases will be sent one at a time and can lose money.`)) return;
    locked.current = true; stop.current = false; setRunning(true); setSent(0); setMessage('Starting purchases…');
    const initialId = auth.activeAccountId;
    let completed = 0;
    try {
      for (let i = 0; i < Number(count); i++) {
        if (stop.current || !account.current.ready || account.current.ws !== ws || account.current.id !== initialId || currentKey.current !== key) { setMessage(`Stopped. ${completed} contracts confirmed.`); break; }
        const response = await timeout(ws.send<{ proposal?: Quote }>(payload(side)));
        const quote = response.proposal;
        if (!quote?.id || !Number.isFinite(Number(quote.ask_price)) || Number(quote.ask_price) <= 0 || Number(quote.ask_price) > Number(displayed.ask_price)) throw new Error('Quote unavailable or price increased. Review a new quote.');
        if (stop.current || !account.current.ready || account.current.ws !== ws || account.current.id !== initialId || currentKey.current !== key) { setMessage(`Stopped. ${completed} contracts confirmed.`); break; }
        const bought = await timeout(ws.send<{ buy?: { contract_id: number } }>({ buy: quote.id, price: Number(displayed.ask_price) }));
        if (!bought.buy?.contract_id) throw new Error('Purchase confirmation missing. Check Positions before placing more trades.');
        completed++; setSent(completed); setMessage(`${completed} of ${count} contracts confirmed.`);
      }
    } catch (err) { setMessage(`Stopped after ${completed} confirmed. ${err instanceof Error ? err.message : 'Purchase failed.'}`); }
    finally { locked.current = false; setRunning(false); }
  }
  const field = (label: string, value: string, setter: (v: string) => void, min: number, max: number, step = '1') => <label>{label}<input type="number" value={value} min={min} max={max} step={step} disabled={running} onChange={e => setter(e.target.value)} /></label>;
  return <main className="multi-page"><Header authState={auth.authState} accounts={auth.accounts} activeAccount={auth.activeAccount} onLogin={auth.login} onSignUp={auth.signUp} onLogout={auth.logout} onSwitchAccount={auth.switchAccount} logoSrc={logoSrc} actions={<ThemeToggle />} /><div className="multi-header-spacer" /><nav className="multi-nav" aria-label="Trading sections">{SECTIONS.map(section => <Link key={section.href} href={section.href} className={section.href === "/multi-ai" ? "selected" : ""} aria-current={section.href === "/multi-ai" ? "page" : undefined}><section.icon size={23} aria-hidden />{section.title}</Link>)}</nav><div className="multi-ai"><h1>Multi AI</h1><div className="multi-grid"><label>MARKET<select value={activeSymbol?.underlying_symbol || ''} disabled={running} onChange={e => selectSymbol(e.target.value)}>{symbols.map(s => <option key={s.underlying_symbol} value={s.underlying_symbol}>{s.underlying_symbol_name}</option>)}</select></label><label>TRADE TYPE<select disabled><option>Over/Under</option></select></label>{field('NUMBER OF TICKS', windowSize, setWindowSize, 1, 5000)}{field('PREDICTION', barrier, setBarrier, 0, 9)}</div><div className="multi-price">CURRENT TICK<strong>{currentTick ? Number(currentTick.quote).toFixed(pipSize) : 'Waiting for live data…'}</strong></div><div className="multi-digits">{Array.from({ length: 10 }, (_, n) => <div key={n} className={digits[digits.length - 1] === n ? 'current' : ''}>{n}<small>{digits.length ? ((digits.filter(d => d === n).length / digits.length) * 100).toFixed(2) + '%' : '—'}</small></div>)}</div><p className="multi-history">{digits.slice(-7).map((d,i) => <span key={i} className={d > Number(barrier) ? 'over' : ''}>{d > Number(barrier) ? 'O' : d < Number(barrier) ? 'U' : '='}</span>)}</p><div className="multi-settings">{field('TICKS', duration, setDuration, 1, 10)}{field('STAKE', stake, setStake, 0.01, 100000, '0.01')}{field('NO OF TRADES', count, setCount, 1, 1000)}</div><p className="multi-total">Estimated total stake: {valid ? (Number(stake) * Number(count)).toFixed(2) : '—'} {currency}</p><div className="multi-buttons">{CONTRACTS.map((side,i) => <button key={side} className={i ? 'under' : 'over'} disabled={running || !ready || !valid || !quotes[side]} onClick={() => buy(side)}>{i ? 'Under' : 'Over'}<small>{quotes[side] ? `Price ${Number(quotes[side].ask_price).toFixed(2)} · Payout ${Number(quotes[side].payout).toFixed(2)} ${currency}` : 'Waiting for live quote'}</small></button>)}</div>{running && <button className="multi-stop" onClick={() => { stop.current = true; setMessage(`Stopping after the current request. ${sent} confirmed.`); }}>Stop</button>}<p role="status" className="multi-status">{message || (!ready ? 'Please log in to your real account to trade.' : !valid ? 'Check your settings. Enter 1–1,000 trades.' : 'Live digit history does not predict future results.')}</p><p className="multi-status">{digits.length} recent ticks analyzed. Contracts may lose money; availability and limits depend on Deriv.</p></div></main>;
}
