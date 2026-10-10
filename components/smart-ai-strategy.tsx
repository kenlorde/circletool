'use client';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useDerivWSContext } from '@/components/custom/deriv-ws-provider';
import { useBaseTrading } from '@/hooks/use-base-trading';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { runSmartAI, SMART_AI_CONTRACTS, type SmartAIProgress } from '@/lib/smart-ai-runner';
import { readBotTransactions, type BotTransaction, type SmartAIContractType } from '@/lib/bot-transactions';

export function SmartAIStrategy({ sessionLock, onRunStateChange, onTransaction }: { sessionLock: RefObject<boolean>; onRunStateChange: (running: boolean) => void; onTransaction: (transaction: BotTransaction) => void }) {
  const { ws, isConnected, auth, balanceSync } = useDerivWSContext();
  const [group, setGroup] = useState<'rise-fall' | 'over-under' | 'even-odd'>('rise-fall');
  const [contractType, setContractType] = useState<SmartAIContractType>('CALL');
  const [prediction, setPrediction] = useState('7');
  const contractTypes = useMemo(() => SMART_AI_CONTRACTS.filter(c => c.group === group).map(c => c.type), [group]);
  const market = useBaseTrading({ ws, isConnected, isAuthenticated: !!auth.wsUrl, contractTypes });
  const directionLabel = SMART_AI_CONTRACTS.find(c => c.type === contractType)?.label ?? 'Rise';
  const selectedContractAvailable = !market.isLoading && market.contracts.some(c => c.contract_type === contractType);
  function changeGroup(next: typeof group) {
    setGroup(next);
    if (next === 'over-under') setPrediction('7');
    setContractType(next === 'over-under' ? 'DIGITUNDER' : next === 'even-odd' ? 'DIGITEVEN' : 'CALL');
  }
  function changeDirection(next: SmartAIContractType) {
    setContractType(next);
    if (next === 'DIGITOVER' && prediction === '9') setPrediction('8');
    if (next === 'DIGITUNDER' && prediction === '0') setPrediction('1');
  }
  const currency = auth.activeAccount?.currency ?? 'USD';
  const [stake, setStake] = useState('10');
  const [ticks, setTicks] = useState('1');
  useEffect(() => {
    if (market.isLoading) return;
    const options = market.contracts.filter(c => c.contract_type === contractType && c.min_contract_duration.endsWith('t'));
    if (!options.length) return;
    const value = Number(ticks);
    if (options.some(c => value >= parseInt(c.min_contract_duration, 10) && (!c.max_contract_duration.endsWith('t') || value <= parseInt(c.max_contract_duration, 10)))) return;
    setTicks(String(Math.min(...options.map(c => parseInt(c.min_contract_duration, 10)))));
  }, [market.isLoading, market.contracts, contractType, ticks]);
  const [target, setTarget] = useState('100');
  const [limit, setLimit] = useState('120');
  const [martingale, setMartingale] = useState('2');
  const [useList, setUseList] = useState(false);
  const [stakeList, setStakeList] = useState('0.35, 0.43, 0.85, 1.74, 3.55, 7.3, 15, 31, 65, 130, 260');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<SmartAIProgress>({ message: 'Stopped. Press Start to begin.', trades: 0, profit: 0, wins: 0, losses: 0, nextStake: 10 });
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
      const supported = market.contracts.some(c => c.contract_type === contractType && c.min_contract_duration.endsWith('t') && duration >= parseInt(c.min_contract_duration, 10) && (!c.max_contract_duration.endsWith('t') || duration <= parseInt(c.max_contract_duration, 10)));
      if (!supported) throw Error('This tick duration is unavailable for the selected direction and market. Choose a supported duration.');
      await runSmartAI({
        settings: { stake: Number(stake), ticks: Number(ticks), target: Number(target), lossLimit: Number(limit), martingale: Number(martingale), useList, stakeList: stakeList.split(',').map(value => Number(value.trim())), contractType, prediction: Number(prediction) },
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
  return <section className="space-y-5 rounded-2xl border p-4 sm:p-6" aria-label="Smart AI">
    <h2 className="text-2xl font-bold">Smart AI · {group === 'rise-fall' ? 'Rise/Fall' : group === 'over-under' ? 'Over/Under' : 'Even/Odd'} bot</h2>
    <p className="text-muted-foreground">The bot buys your selected direction every cycle. A win resets the stake; a loss advances the stake list or applies the martingale multiplier. One contract runs at a time. There is no price-analysis entry filter.</p>
    <div className="rounded-xl border p-4"><p className="text-sm">Live price: <b>{market.currentTick?.quote ?? '—'}</b> · {directionLabel}{group === 'over-under' ? ` ${prediction}` : ''}</p></div>
    <div className="rounded-xl border p-5 space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <label>Trade type<select className="mt-2 block w-full rounded-md border bg-background p-3" value={group} disabled={busy} onChange={e => changeGroup(e.target.value as typeof group)}><option value="rise-fall">Rise/Fall</option><option value="over-under">Over/Under</option><option value="even-odd">Even/Odd</option></select></label>
        <label>Direction<select className="mt-2 block w-full rounded-md border bg-background p-3" value={contractType} disabled={busy} onChange={e => changeDirection(e.target.value as SmartAIContractType)}>{SMART_AI_CONTRACTS.filter(c => c.group === group).map(c => <option key={c.type} value={c.type}>{c.label}</option>)}</select></label>
      </div>
      {group === 'over-under' && <label className="block">Digit prediction<select className="mt-2 block w-full rounded-md border bg-background p-3" value={prediction} disabled={busy} onChange={e => setPrediction(e.target.value)}>{Array.from({ length: 10 }, (_, n) => n).filter(n => contractType === 'DIGITOVER' ? n < 9 : n > 0).map(n => <option key={n} value={String(n)}>{n}</option>)}</select><span className="mt-2 block text-sm">{directionLabel} {prediction} wins on digits {contractType === 'DIGITOVER' ? `${Number(prediction) + 1}–9` : `0–${Number(prediction) - 1}`}. The prediction digit loses.</span></label>}
      <label className="block">Volatility index<select className="mt-2 block w-full rounded-md border bg-background p-3" value={market.activeSymbol?.underlying_symbol ?? ''} disabled={busy} onChange={e => market.selectSymbol(e.target.value)}><option value="" disabled>Select a market</option>{market.symbols.filter(s => /volatility/i.test(s.underlying_symbol_name)).map(s => <option key={s.underlying_symbol} value={s.underlying_symbol}>{s.underlying_symbol_name}</option>)}</select></label>
      <div className="grid grid-cols-2 gap-4">{[{label:`Stake (${currency})`,value:stake,set:setStake},{label:'Duration (ticks)',value:ticks,set:setTicks},{label:`Profit target (${currency})`,value:target,set:setTarget},{label:`Loss limit (${currency})`,value:limit,set:setLimit},{label:'Martingale multiplier',value:martingale,set:setMartingale}].map(f => <label key={f.label}>{f.label}<Input className="mt-2" type="number" min="0" step={f.label.includes('ticks') ? '1' : '0.01'} value={f.value} disabled={busy} onChange={e => f.set(e.target.value)} /></label>)}</div>
      <label className="flex items-center gap-2"><input type="checkbox" checked={useList} disabled={busy} onChange={e => setUseList(e.target.checked)} />Use stake list</label>
      {useList && <label className="block">Stake sequence<Input className="mt-2" value={stakeList} disabled={busy} onChange={e => setStakeList(e.target.value)} /></label>}
      {!market.isLoading && market.activeSymbol && !selectedContractAvailable && <p role="status" className="text-sm text-amber-500">{directionLabel} is unavailable on this market. Choose another volatility index.</p>}
      {auth.activeAccount?.account_type !== 'real' && <p role="status" className="text-sm text-amber-500">Bots require a real account. Switch to a real account to start.</p>}
      <p className="text-sm">Account: {auth.activeAccount ? `${auth.activeAccount.account_type} · ${auth.activeAccount.account_id}` : 'Not logged in'}.</p>
      <div className="flex gap-3">{auth.authState !== 'authenticated' ? <Button onClick={() => auth.login()}>Log in</Button> : <Button onClick={start} disabled={busy || auth.activeAccount?.account_type !== 'real' || !isConnected || !market.activeSymbol || !selectedContractAvailable}>Start bot</Button>}<Button variant="destructive" disabled={!busy} onClick={stop}>Stop</Button></div>
    </div>
    <div className="rounded-xl border p-5" aria-live="polite"><p id="smart-ai-status">{progress.message}</p><div className="mt-4 flex gap-8"><span>Trades: <b>{progress.trades}</b></span><span>Net profit: <b>{progress.profit.toFixed(2)} {currency}</b></span></div><p className="mt-3 text-sm">Wins: {progress.wins} · Losses: {progress.losses} · Next stake: {progress.nextStake.toFixed(2)} {currency}</p><p className="mt-3 text-sm">Options account balance: {auth.activeAccount?.balance ?? '—'} {currency}</p><Button className="mt-3" variant="outline" onClick={() => void balanceSync.refresh()} disabled={!isConnected || !auth.wsUrl}>Refresh balance</Button>{balanceSync.error && <p role="status" className="mt-2 text-sm text-amber-500">{balanceSync.error}</p>}</div>
    <p className="text-sm text-muted-foreground">Keep this page open. Leaving or backgrounding the app stops new purchases. Martingale increases stakes after losses. The runner stops if the next stake exceeds the remaining loss allowance or the stake list is exhausted. Trading can lose money.</p>
  </section>;
}
