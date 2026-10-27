'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useActiveSymbols, useTicks } from '@deriv/core';
import Link from 'next/link';
import { Activity, BarChart3, Bot, BriefcaseBusiness, House, Monitor } from 'lucide-react';
import { Header } from '@/components/custom/header';
import { useDerivWSContext } from '@/components/custom/deriv-ws-provider';
import { useLogoSrc } from '@/components/custom/logo-src-provider';
import { ThemeToggle } from '@/components/custom/theme-toggle';
import { runMultiBatch, type MultiBuy } from '@/lib/multi-ai-batch';
import './style.css';

const CONTRACTS = ['DIGITOVER', 'DIGITUNDER', 'DIGITEVEN', 'DIGITODD', 'DIGITMATCH', 'DIGITDIFF'];
const TYPES = { over: { label: 'Over/Under', sides: ['DIGITOVER', 'DIGITUNDER'], names: ['Over', 'Under'] }, even: { label: 'Even/Odd', sides: ['DIGITEVEN', 'DIGITODD'], names: ['Even', 'Odd'] }, match: { label: 'Matches/Differs', sides: ['DIGITMATCH', 'DIGITDIFF'], names: ['Matches', 'Differs'] } } as const;
type TradeGroup = keyof typeof TYPES;
type Row = { id: number; side: string; buyPrice?: number; payout?: number; profit?: number; entry?: number; exit?: number; status: string };
type ContractInfo = { contract_id: number; is_sold?: number; status?: string; profit?: number | string; payout?: number | string; entry_spot?: number; exit_spot?: number };
function isHit(d: number, side: string, barrier: number) { switch(side){ case 'DIGITOVER': return d > barrier; case 'DIGITUNDER': return d < barrier; case 'DIGITEVEN': return d % 2 === 0; case 'DIGITODD': return d % 2 === 1; case 'DIGITMATCH': return d === barrier; default: return d !== barrier; } }
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
  const [group, setGroup] = useState<TradeGroup>('over');
  const [barrier, setBarrier] = useState('7');
  const [rows, setRows] = useState<Row[]>([]);
  const [tab, setTab] = useState<'summary' | 'transactions' | 'journal'>('transactions');
  const [uncertain, setUncertain] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const definition = TYPES[group];
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
  const key = JSON.stringify([activeSymbol?.underlying_symbol, group, barrier, duration, stake, currency, auth.activeAccountId]);
  const currentKey = useRef(key); currentKey.current = key;
  const digits = useMemo(() => prices.map(p => Number(Number(p).toFixed(pipSize).slice(-1))).filter(Number.isFinite), [prices, pipSize]);
  const valid = Number.isInteger(Number(count)) && Number(count) >= 10 && Number(count) <= 1000 && Number(stake) > 0 && Number.isInteger(Number(barrier)) && Number(barrier) >= 0 && Number(barrier) <= 9 && Number.isInteger(Number(duration)) && Number(duration) >= 1 && Number(duration) <= 10;
  const payload = (side: string) => ({ proposal: 1, amount: Number(stake), basis: 'stake', contract_type: side, currency, duration: Number(duration), duration_unit: 't', underlying_symbol: activeSymbol?.underlying_symbol, ...(group === 'even' ? {} : { barrier: String(barrier) }) });
  useEffect(() => { stop.current = true; return () => { stop.current = true; }; }, [ws, auth.activeAccountId]);
  useEffect(() => { setRows([]); setUncertain(false); }, [auth.activeAccountId]);
  useEffect(() => { setQuotes({}); if (!ws || !isConnected || !activeSymbol || !valid) return; let cancelled = false; Promise.all(definition.sides.map(async side => { try { const response = await timeout(ws.send<{ proposal?: Quote }>(payload(side))); return [side, response.proposal] as const; } catch { return [side, undefined] as const; } })).then(values => { if (!cancelled) setQuotes(Object.fromEntries(values.filter(([, quote]) => !!quote)) as Record<string, Quote>); }); return () => { cancelled = true; }; }, [key, isConnected, ws, valid]);
  async function updateContracts(ids: number[], socket: NonNullable<typeof ws>, sessionId: string | null) {
    for (let i = 0; i < ids.length; i += 10) {
      if (!account.current.ready || account.current.ws !== socket || account.current.id !== sessionId) break;
      const settled = await Promise.allSettled(ids.slice(i, i + 10).map(id => timeout(socket.send<{ proposal_open_contract?: ContractInfo }>({proposal_open_contract: 1, contract_id: id}))));
      if (!account.current.ready || account.current.ws !== socket || account.current.id !== sessionId) break;
      const found = settled.flatMap(x => x.status === 'fulfilled' && x.value.proposal_open_contract ? [x.value.proposal_open_contract] : []);
      setRows(prev => prev.map(row => { const c = found.find(item => item.contract_id === row.id); return c ? {...row, status: c.is_sold ? 'Settled' : 'Open', profit: c.is_sold && c.profit != null ? Number(c.profit) : undefined, payout: c.is_sold && c.profit != null && row.buyPrice != null ? row.buyPrice + Number(c.profit) : undefined, entry: c.entry_spot, exit: c.exit_spot} : row; }));
      if (i + 10 < ids.length) await new Promise(resolve => setTimeout(resolve, 2500));
    }
  }
  async function refreshResults() {
    if (!ws || !ready || refreshing || running) return;
    setRefreshing(true); try { await updateContracts(rows.filter(r => r.status !== 'Settled').map(r => r.id), ws, auth.activeAccountId); } finally { setRefreshing(false); }
  }
  useEffect(() => {
    if (!ws || !ready || running || refreshing || !rows.some(row => row.status !== 'Settled')) return;
    const timer = setTimeout(() => { void refreshResults(); }, 15000);
    return () => clearTimeout(timer);
  }, [ws, ready, running, refreshing, rows]);
  async function buy(side: string) {
    if (locked.current || uncertain || !ws || !ready || !valid || !activeSymbol) { setMessage(uncertain ? 'Check Deriv positions before starting another batch.' : 'Log in to a real account and check your settings.'); return; }
    const displayed = quotes[side];
    if (!displayed || !Number.isFinite(Number(displayed.ask_price))) { setMessage('Live quote unavailable. Change a setting to request a fresh quote.'); return; }
    const total = Number(displayed.ask_price) * Number(count);
    const name = definition.names[definition.sides.indexOf(side as never)];
    if (!window.confirm(`Buy up to ${count} ${name} contracts? Maximum total cost: ${total.toFixed(2)} ${currency}. Contracts are sent in concurrent groups and can lose money. Entry prices can differ.`)) return;
    locked.current = true; stop.current = false; setRunning(true); setSent(0); setMessage('Starting purchases…');
    const sessionId = auth.activeAccountId;
    const canContinue = () => !stop.current && account.current.ready && account.current.ws === ws && account.current.id === sessionId && currentKey.current === key;
    try {
      const result = await runMultiBatch({ count: Number(count), maximumPrice: Number(displayed.ask_price), canContinue,
        quote: async () => (await timeout(ws.send<{proposal?: Quote}>(payload(side)))).proposal,
        buy: async q => (await timeout(ws.send<{buy?: MultiBuy}>({buy: q.id, price: Number(displayed.ask_price)}))).buy,
        onConfirmed: b => { if (account.current.id !== sessionId) return; setRows(prev => [{ id: b.contract_id, side: name, buyPrice: b.buy_price == null ? undefined : Number(b.buy_price), payout: b.payout == null ? undefined : Number(b.payout), status: 'Open' }, ...prev]); setSent(v => v + 1); },
        onBatch: async batch => { await new Promise(resolve => setTimeout(resolve, 2000)); await updateContracts(batch.map(b => b.contract_id), ws, sessionId); },
      });
      if (result.uncertain) setUncertain(true);
      setMessage(`${result.confirmed} confirmed. ${result.reason}`);
    } catch (err) { setUncertain(true); setMessage(`Stopped. Check Deriv positions before trying again. ${err instanceof Error ? err.message : ''}`); }
    finally { locked.current = false; setRunning(false); }
  }
  const field = (label: string, value: string, setter: (v: string) => void, min: number, max: number, step = '1') => <label>{label}<input type="number" value={value} min={min} max={max} step={step} disabled={running} onChange={e => setter(e.target.value)} /></label>;
  return <main className="multi-page"><Header authState={auth.authState} accounts={auth.accounts} activeAccount={auth.activeAccount} onLogin={auth.login} onSignUp={auth.signUp} onLogout={auth.logout} onSwitchAccount={auth.switchAccount} logoSrc={logoSrc} actions={<ThemeToggle />} /><div className="multi-header-spacer" /><nav className="multi-nav" aria-label="Trading sections">{SECTIONS.map(section => <Link key={section.href} href={section.href} className={section.href === "/multi-ai" ? "selected" : ""} aria-current={section.href === "/multi-ai" ? "page" : undefined}><section.icon size={23} aria-hidden />{section.title}</Link>)}</nav><div className="multi-ai"><h1>Multi AI</h1><div className="multi-grid"><label>MARKET<select value={activeSymbol?.underlying_symbol || ''} disabled={running} onChange={e => selectSymbol(e.target.value)}>{symbols.map(s => <option key={s.underlying_symbol} value={s.underlying_symbol}>{s.underlying_symbol_name}</option>)}</select></label><label>TRADE TYPE<select value={group} disabled={running} onChange={e => setGroup(e.target.value as TradeGroup)}>{Object.entries(TYPES).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select></label>{field('NUMBER OF TICKS', windowSize, setWindowSize, 1, 5000)}{group !== 'even' && field('PREDICTION', barrier, setBarrier, 0, 9)}</div><div className="multi-price">CURRENT TICK<strong>{currentTick ? Number(currentTick.quote).toFixed(pipSize) : 'Waiting for live data…'}</strong></div><div className="multi-digits">{Array.from({ length: 10 }, (_, n) => <div key={n} className={digits[digits.length - 1] === n ? 'current' : ''}>{n}<small>{digits.length ? ((digits.filter(d => d === n).length / digits.length) * 100).toFixed(2) + '%' : '—'}</small></div>)}</div><p className="multi-history">{digits.slice(-7).map((d,i) => <span key={i} className={isHit(d, definition.sides[0], Number(barrier)) ? 'over' : ''}>{isHit(d, definition.sides[0], Number(barrier)) ? definition.names[0][0] : isHit(d, definition.sides[1], Number(barrier)) ? definition.names[1][0] : '='}</span>)}</p><div className="multi-settings">{field('TICKS', duration, setDuration, 1, 10)}{field('STAKE', stake, setStake, 0.01, 100000, '0.01')}{field('NO OF TRADES', count, setCount, 10, 1000)}</div><div className="multi-buttons">{definition.sides.map((side,i) => <button key={side} className={i ? 'under' : 'over'} disabled={running || uncertain || !ready || !valid || !quotes[side]} onClick={() => buy(side)}>{definition.names[i]}<small>{digits.length ? `${(100 * digits.filter(d => isHit(d, side, Number(barrier))).length / digits.length).toFixed(2)}%` : '—'}</small><small>{quotes[side]?.payout != null && Number.isFinite(Number(quotes[side].payout)) ? `Payout per contract: ${Number(quotes[side].payout).toFixed(2)} ${currency}` : 'Payout unavailable'}</small></button>)}</div>{uncertain && !running && <button className="multi-stop" onClick={() => { if (window.confirm('Have you checked Deriv Positions and resolved any unconfirmed purchases?')) { setUncertain(false); setMessage('Ready after checking positions.'); } }}>I checked Positions</button>}{running && <button className="multi-stop" onClick={() => { stop.current = true; setMessage(`Stopping after the current group. ${sent} confirmed.`); }}>Stop</button>}<p role="status" className="multi-status">{message || (!ready ? 'Please log in to your real account to trade.' : !valid ? 'Check your settings. Enter 10–1,000 trades.' : 'Live digit history does not predict future results.')}</p><section className="multi-results"><p className="multi-status">Results in this session</p><div className="multi-tabs">{(['summary', 'transactions', 'journal'] as const).map(t => <button key={t} className={tab === t ? 'selected' : ''} onClick={() => setTab(t)}>{t[0].toUpperCase()+t.slice(1)}</button>)}</div>{tab === 'transactions' && <><div className="multi-result-actions"><button onClick={() => { const csv = ['Contract,Type,Entry,Exit,Buy price,Profit,Status', ...rows.map(r => [r.id,r.side,r.entry ?? '',r.exit ?? '',r.buyPrice ?? '',r.profit ?? '',r.status].join(','))].join('\n'); const url = URL.createObjectURL(new Blob([csv], {type:'text/csv'})); const a = document.createElement('a'); a.href = url; a.download = 'multi-ai-transactions.csv'; a.click(); URL.revokeObjectURL(url); }} disabled={!rows.length}>Download</button><button onClick={() => { if (window.confirm('Clear this session’s Multi AI results?')) setRows([]); }} disabled={running || !rows.length}>Reset</button><button onClick={refreshResults} disabled={running || refreshing || !rows.length}>{refreshing ? 'Refreshing…' : 'Refresh results'}</button><Link href="/reports">View positions</Link></div><div className="multi-table"><div className="multi-row heading"><span>Type</span><span>Entry / Exit</span><span>Buy price / P&amp;L</span></div>{rows.map(row => <div className="multi-row" key={row.id}><span>{row.side}<small>#{row.id}</small></span><span>{row.entry ?? '—'}<small>{row.exit ?? '—'}</small></span><span>{row.buyPrice == null ? '—' : row.buyPrice.toFixed(2)} {currency}<small className={row.profit != null && row.profit < 0 ? 'loss' : 'gain'}>{row.profit == null ? row.status : `${row.profit >= 0 ? '+' : ''}${row.profit.toFixed(2)} ${currency}`}</small></span></div>)}{!rows.length && <p className="multi-status">No contracts yet.</p>}</div></>}{tab === 'summary' && <div className="multi-summary"><span>Contracts<strong>{rows.length}</strong></span><span>Contracts won<strong>{rows.filter(r => (r.profit ?? 0) > 0).length}</strong></span><span>Contracts lost<strong>{rows.filter(r => (r.profit ?? 0) < 0).length}</strong></span><span>Total stake<strong>{rows.reduce((sum,r) => sum + (r.buyPrice ?? 0),0).toFixed(2)} {currency}</strong></span><span>Total payout<strong>{rows.filter(r=>r.status === 'Settled').reduce((sum,r) => sum + (r.payout ?? 0),0).toFixed(2)} {currency}</strong></span><span>Profit/loss<strong>{rows.reduce((sum,r) => sum + (r.profit ?? 0),0).toFixed(2)} {currency}</strong></span></div>}{tab === 'journal' && <p className="multi-status">{message || 'No batch activity yet.'}</p>}</section></div></main>;
}
