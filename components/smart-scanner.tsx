'use client';
import { CircleNav } from '@/components/custom/circle-nav';
import { useEffect, useRef, useState } from 'react';
import { useDerivWSContext } from '@/components/custom/deriv-ws-provider';
import { useBaseTrading } from '@/hooks/use-base-trading';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Link from 'next/link';
import { Header } from '@/components/custom/header';
import { useLogoSrc } from '@/components/custom/logo-src-provider';
import './smart-scanner.css';
import { runSmartAI, type SmartAIProgress } from '@/lib/smart-ai-runner';
import { readBotTransactions, saveBotTransaction, type BotTransaction } from '@/lib/bot-transactions';

const SCANNER_CONTRACTS = ['DIGITUNDER', 'DIGITOVER'];
export function SmartScanner() {
  const sessionLock = useRef(false);
  const onRunStateChange = (_running: boolean) => {};
  const onTransaction = (transaction: BotTransaction) => { saveBotTransaction(transaction); };
  const { ws, isConnected, auth, balanceSync } = useDerivWSContext();
  const logoSrc = useLogoSrc();
  const market = useBaseTrading({ ws, isConnected, isAuthenticated: !!auth.wsUrl, contractTypes: SCANNER_CONTRACTS });
  const selectedContractAvailable = !market.isLoading && SCANNER_CONTRACTS.every(type => market.contracts.some(c => c.contract_type === type));
  const currency = auth.activeAccount?.currency ?? 'USD';
  const [stake, setStake] = useState('0.35');
  const [ticks, setTicks] = useState('1');
  const [target, setTarget] = useState('2');
  const [limit, setLimit] = useState('2');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<SmartAIProgress>({ message: 'Stopped. Press Start to begin.', trades: 0, profit: 0, wins: 0, losses: 0, nextStake: 0.35, activeContract: 'Under 7', consecutiveLosses: 0 });
  const session = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const accountRef = useRef({ ws, accountId: auth.activeAccount?.account_id, authenticated: auth.authState === 'authenticated' && auth.activeAccount?.account_type === 'real', isConnected });
  accountRef.current = { ws, accountId: auth.activeAccount?.account_id, authenticated: auth.authState === 'authenticated' && auth.activeAccount?.account_type === 'real', isConnected };
  const initializedMarket = useRef(false);
  useEffect(() => {
    if (!initializedMarket.current && market.symbols.length) {
      initializedMarket.current = true;
      if (market.symbols.some(s => s.underlying_symbol === 'R_10')) market.selectSymbol('R_10');
    }
  }, [market.symbols, market.selectSymbol]);
  useEffect(() => {
    mounted.current = true;
    const hide = () => { if (document.hidden) session.current?.abort(); };
    document.addEventListener('visibilitychange', hide);
    return () => { mounted.current = false; session.current?.abort(); document.removeEventListener('visibilitychange', hide); };
  }, []);
  useEffect(() => { session.current?.abort(); }, [ws, isConnected, auth.activeAccount?.account_id, auth.authState, auth.activeAccount?.account_type]);
  async function start() {
    if (auth.activeAccount?.account_type !== 'real') { setProgress(previous => ({ ...previous, message: 'Bots require a real account. Demo accounts are not supported.' })); return; }
    if (session.current || sessionLock.current || !ws || !isConnected || auth.authState !== 'authenticated' || !auth.activeAccount?.account_id || !market.activeSymbol || !selectedContractAvailable) return;
    const accountId = auth.activeAccount.account_id;
    const controller = new AbortController();
    const key = 'circletool-under7-pending:' + accountId;
    session.current = controller; sessionLock.current = true; setBusy(true); onRunStateChange(true);
    try {
      const duration = Number(ticks);
      const supported = SCANNER_CONTRACTS.every(type => market.contracts.some(c => c.contract_type === type && c.min_contract_duration.endsWith('t') && duration >= parseInt(c.min_contract_duration, 10) && (!c.max_contract_duration.endsWith('t') || duration <= parseInt(c.max_contract_duration, 10))));
      if (!supported) throw Error('This tick duration is unavailable for the selected direction and market. Choose a supported duration.');
      await runSmartAI({
        settings: { stake: Number(stake), ticks: Number(ticks), target: Number(target), lossLimit: Number(limit), martingale: 1, useList: false, stakeList: [], switchAfterTwoLosses: true },
        ws, symbol: market.activeSymbol.underlying_symbol, currency, accountId, accountType: auth.activeAccount.account_type, signal: controller.signal,
        isCurrent: () => mounted.current && accountRef.current.ws === ws && accountRef.current.accountId === accountId && accountRef.current.authenticated && accountRef.current.isConnected && ws.isConnected,
        pending: { get: () => localStorage.getItem(key), set: value => localStorage.setItem(key, value), clear: () => localStorage.removeItem(key) },
        findTransaction: id => readBotTransactions(accountId).find(t => t.contractId === id),
        onTransaction,
        onProgress: next => { if (mounted.current) setProgress(next); },
        refreshBalance: () => balanceSync.refresh(),
      });
    } catch (error) {
      if (mounted.current) setProgress(previous => ({ ...previous, message: error instanceof Error ? error.message : 'Bot stopped after an error.' }));
    } finally {
      session.current = null; sessionLock.current = false;
      if (mounted.current) { setBusy(false); onRunStateChange(false); }
    }
  }
  function stop() {
    session.current?.abort();
    setProgress(previous => ({ ...previous, message: 'Stopping. A sent purchase or open contract will finish; no next trade.' }));
  }
  return <main className="smart-scanner-page">
    <Header authState={auth.authState} accounts={auth.accounts} activeAccount={auth.activeAccount} onLogin={auth.login} onSignUp={auth.signUp} onLogout={auth.logout} onSwitchAccount={auth.switchAccount} logoSrc={logoSrc} appName="Circletool" />
    <CircleNav />
    <div className="smart-scanner-grid">
      <section className="smart-scanner-card"><h1>Scanner Settings</h1><p className="scanner-muted">Configure your trade</p>
        <label>Volatility index<select value={market.activeSymbol?.underlying_symbol ?? ''} disabled={busy} onChange={e => market.selectSymbol(e.target.value)}><option value="" disabled>Select a market</option>{market.symbols.filter(s => /volatility/i.test(s.underlying_symbol_name)).map(s => <option key={s.underlying_symbol} value={s.underlying_symbol}>{s.underlying_symbol_name}</option>)}</select></label>
        {[{label:`Stake (${currency})`,value:stake,set:setStake},{label:'Duration (ticks)',value:ticks,set:setTicks},{label:`TP (${currency})`,value:target,set:setTarget},{label:`SL (${currency})`,value:limit,set:setLimit}].map(f => <label key={f.label}>{f.label}<Input type="number" min={f.label.includes('ticks') ? 1 : 0.01} step={f.label.includes('ticks') ? 1 : 0.01} value={f.value} disabled={busy} onChange={e => f.set(e.target.value)} /></label>)}
        <p className="scanner-muted">Fixed stake · one contract at a time</p>
        {auth.authState !== 'authenticated' ? <Button onClick={() => auth.login()}>Log in to real account</Button> : <Button className={busy ? 'scanner-stop' : 'scanner-start'} onClick={busy ? stop : start} disabled={!busy && (auth.activeAccount?.account_type !== 'real' || !isConnected || !market.activeSymbol || !selectedContractAvailable)}>{busy ? '■ Stop scanning' : '▷ Start scanning'}</Button>}
        {auth.activeAccount?.account_type !== 'real' && <p className="scanner-muted">Please log in to your real account.</p>}
        {!market.isLoading && market.activeSymbol && !selectedContractAvailable && <p role="status">Under/Over is unavailable on this market.</p>}
        <div className="scanner-totals"><span>Trades <b>{progress.trades}</b></span><span>P/L <b>{progress.profit.toFixed(2)} {currency}</b></span></div>
      </section>
      <section className="smart-scanner-card scanner-display"><h2>LIVE MARKET SCAN</h2><div className={`scanner-radar ${busy ? 'is-running' : ''}`}><div className="scanner-sweep" /><div className="scanner-core"><span>◎</span><strong>{busy ? 'TRADING' : 'READY'}</strong></div>{Array.from({length:8},(_,i)=><i key={i} style={{left:`${50+49*Math.sin(i*Math.PI/4)}%`,top:`${50-49*Math.cos(i*Math.PI/4)}%`}} />)}</div><h3>{progress.activeContract ?? 'Under 7'}</h3><p className="scanner-muted">Consecutive losses: {progress.consecutiveLosses ?? 0} / 2</p><p>Live price: <b>{market.currentTick?.quote ?? '—'}</b></p><p className="scanner-muted">{isConnected ? 'Connected' : 'Disconnected'} · {auth.activeAccount?.account_id ?? 'Not logged in'}</p></section>
      <section className="smart-scanner-card scanner-session" aria-live="polite"><h2>Session activity</h2><p>{progress.message}</p><p>Wins: {progress.wins} · Losses: {progress.losses}</p><p>Under 7 → two consecutive losses → Over 2 → two consecutive losses → Under 7. Wins reset the loss count and keep the current direction. Each new session starts on Under 7.</p><p className="scanner-muted">Start scanning places real trades using these settings. Stop prevents the next purchase and finishes tracking an open contract. Leaving or backgrounding this page stops new purchases. Trading can lose money; the radar does not predict outcomes.</p>{balanceSync.error && <p role="status">{balanceSync.error}</p>}</section>
    </div>
  </main>;
}
