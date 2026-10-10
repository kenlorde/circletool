'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useDerivWSContext } from '@/components/custom/deriv-ws-provider';
import { useBaseTrading } from '@/hooks/use-base-trading';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { runSmartAI, type SmartAIProgress } from '@/lib/smart-ai-runner';
import { readBotTransactions, type BotTransaction } from '@/lib/bot-transactions';

const TYPES = ['CALL', 'PUT'];
export function SmartAIStrategy({ sessionLock, onRunStateChange, onTransaction }: { sessionLock: RefObject<boolean>; onRunStateChange: (running: boolean) => void; onTransaction: (transaction: BotTransaction) => void }) {
  const { ws, isConnected, auth, balanceSync } = useDerivWSContext();
  const market = useBaseTrading({ ws, isConnected, isAuthenticated: !!auth.wsUrl, contractTypes: TYPES });
  const currency = auth.activeAccount?.currency ?? 'USD';
  const [stake, setStake] = useState('10');
  const [ticks, setTicks] = useState('1');
  const [target, setTarget] = useState('100');
  const [limit, setLimit] = useState('120');
  const [martingale, setMartingale] = useState('2');
  const [useList, setUseList] = useState(false);
  const [stakeList, setStakeList] = useState('0.35, 0.43, 0.85, 1.74, 3.55, 7.3, 15, 31, 65, 130, 260');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<SmartAIProgress>({ message: 'Stopped. Press Start to begin.', trades: 0, profit: 0, wins: 0, losses: 0, nextStake: 10 });
  const session = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const accountRef = useRef({ ws, accountId: auth.activeAccount?.account_id, authenticated: auth.authState === 'authenticated', isConnected });
  accountRef.current = { ws, accountId: auth.activeAccount?.account_id, authenticated: auth.authState === 'authenticated', isConnected };
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
  useEffect(() => { session.current?.abort(); }, [ws, isConnected, auth.activeAccount?.account_id, auth.authState]);
  async function start() {
    if (session.current || sessionLock.current || !ws || !isConnected || auth.authState !== 'authenticated' || !auth.activeAccount?.account_id || !market.activeSymbol) return;
    const accountId = auth.activeAccount.account_id;
    const controller = new AbortController();
    const key = 'circletool-under7-pending:' + accountId;
    session.current = controller; sessionLock.current = true; setBusy(true); onRunStateChange(true);
    try {
      await runSmartAI({
        settings: { stake: Number(stake), ticks: Number(ticks), target: Number(target), lossLimit: Number(limit), martingale: Number(martingale), useList, stakeList: stakeList.split(',').map(value => Number(value.trim())) },
        ws, symbol: market.activeSymbol.underlying_symbol, currency, accountId, signal: controller.signal,
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
    <h2 className="text-2xl font-bold">Smart AI · Rise/Fall bot</h2>
    <p className="text-muted-foreground">The uploaded strategy buys Rise every cycle. A win resets the stake; a loss advances the stake list or applies the martingale multiplier. One contract runs at a time. There is no price-analysis entry filter.</p>
    <div className="rounded-xl border p-4"><p className="text-sm">Live price: <b>{market.currentTick?.quote ?? '—'}</b> · Rise/Fall</p></div>
    <div className="rounded-xl border p-5 space-y-4">
      <label className="block">Volatility index<select className="mt-2 block w-full rounded-md border bg-background p-3" value={market.activeSymbol?.underlying_symbol ?? ''} disabled={busy} onChange={e => market.selectSymbol(e.target.value)}><option value="" disabled>Select a market</option>{market.symbols.filter(s => /volatility/i.test(s.underlying_symbol_name)).map(s => <option key={s.underlying_symbol} value={s.underlying_symbol}>{s.underlying_symbol_name}</option>)}</select></label>
      <div className="grid grid-cols-2 gap-4">{[{label:`Stake (${currency})`,value:stake,set:setStake},{label:'Duration (ticks)',value:ticks,set:setTicks},{label:`Profit target (${currency})`,value:target,set:setTarget},{label:`Loss limit (${currency})`,value:limit,set:setLimit},{label:'Martingale multiplier',value:martingale,set:setMartingale}].map(f => <label key={f.label}>{f.label}<Input className="mt-2" type="number" min="0" step={f.label.includes('ticks') ? '1' : '0.01'} value={f.value} disabled={busy} onChange={e => f.set(e.target.value)} /></label>)}</div>
      <label className="flex items-center gap-2"><input type="checkbox" checked={useList} disabled={busy} onChange={e => setUseList(e.target.checked)} />Use stake list</label>
      {useList && <label className="block">Stake sequence<Input className="mt-2" value={stakeList} disabled={busy} onChange={e => setStakeList(e.target.value)} /></label>}
      <p className="text-sm">Account: {auth.activeAccount ? `${auth.activeAccount.account_type} · ${auth.activeAccount.account_id}` : 'Not logged in'}.</p>
      <div className="flex gap-3">{auth.authState !== 'authenticated' ? <Button onClick={() => auth.login()}>Log in</Button> : <Button onClick={start} disabled={busy || !isConnected || !market.activeSymbol || !market.contractsAvailable}>Start bot</Button>}<Button variant="destructive" disabled={!busy} onClick={stop}>Stop</Button></div>
    </div>
    <div className="rounded-xl border p-5" aria-live="polite"><p id="smart-ai-status">{progress.message}</p><div className="mt-4 flex gap-8"><span>Trades: <b>{progress.trades}</b></span><span>Net profit: <b>{progress.profit.toFixed(2)} {currency}</b></span></div><p className="mt-3 text-sm">Wins: {progress.wins} · Losses: {progress.losses} · Next stake: {progress.nextStake.toFixed(2)} {currency}</p><p className="mt-3 text-sm">Options account balance: {auth.activeAccount?.balance ?? '—'} {currency}</p><Button className="mt-3" variant="outline" onClick={() => void balanceSync.refresh()} disabled={!isConnected || !auth.wsUrl}>Refresh balance</Button>{balanceSync.error && <p role="status" className="mt-2 text-sm text-amber-500">{balanceSync.error}</p>}</div>
    <p className="text-sm text-muted-foreground">Keep this page open. Leaving or backgrounding the app stops new purchases. Martingale increases stakes after losses. The runner stops if the next stake exceeds the remaining loss allowance or the stake list is exhausted. Trading can lose money.</p>
  </section>;
}
