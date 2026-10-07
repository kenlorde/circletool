'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useDerivWSContext } from '@/components/custom/deriv-ws-provider';
import { useBaseTrading } from '@/hooks/use-base-trading';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { readBotTransactions, type BotTransaction } from '@/lib/bot-transactions';
import { waitForDigitEight } from '@/lib/bot-entry';
import { getLastDigit } from '@/lib/digit-stats';
const TYPES = ['DIGITUNDER'];
type Reply = { proposal?: { id: string; ask_price: number | string }; buy?: { contract_id: number }; proposal_open_contract?: { is_sold: number; profit: number | string }; portfolio?: { contracts: unknown[] } };
export function SmartAIBot({ barrier = '7', sessionLock, anotherBotRunning = false, onRunStateChange, onTransaction }: { barrier?: '7' | '8'; sessionLock: RefObject<boolean>; anotherBotRunning?: boolean; onRunStateChange: (running: boolean) => void; onTransaction: (transaction: BotTransaction) => void }) {
  const botName = barrier === '8' ? 'Expert AI' : 'Master AI';
  const { ws, isConnected, auth, balanceSync } = useDerivWSContext();
  const market = useBaseTrading({ ws, isConnected, isAuthenticated: !!auth.wsUrl, contractTypes: TYPES });
  const [stake, setStake] = useState('0.35'), [ticks, setTicks] = useState('1'), [target, setTarget] = useState('2'), [limit, setLimit] = useState('2');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('Stopped. Press Start to begin.'), [profit, setProfit] = useState(0), [trades, setTrades] = useState(0);
  const [results, setResults] = useState({ wins: 0, losses: 0, drawdown: 0 });
  const running = useRef(false), lock = useRef(false), mounted = useRef(true);
  const accountId = auth.activeAccount?.account_id;
  const currency = auth.activeAccount?.currency ?? 'USD';
  useEffect(() => { mounted.current = true; const hide = () => { if (document.hidden) running.current = false; }; document.addEventListener('visibilitychange', hide); return () => { mounted.current = false; running.current = false; document.removeEventListener('visibilitychange', hide); }; }, []);
  useEffect(() => { running.current = false; }, [ws, isConnected, accountId, barrier]);
  const stop = () => { running.current = false; setMessage('Stopping. A sent purchase or open contract will finish; no next trade.'); };
  async function start() {
    if (lock.current || sessionLock.current || anotherBotRunning || !ws || !isConnected || auth.authState !== 'authenticated' || !accountId || !market.activeSymbol) return;
    const amount = Number(stake), duration = Number(ticks), goal = Number(target), loss = Number(limit);
    if (![amount, duration, goal, loss].every(n => Number.isFinite(n) && n > 0) || !Number.isInteger(duration) || amount > loss) { setMessage('Enter positive settings. Ticks must be a whole number and stake must fit the loss limit.'); return; }
    // Shared with both bots so switching pages cannot bypass a pending purchase.
    const key = 'circletool-under7-pending:' + accountId;
    lock.current = true; sessionLock.current = true; onRunStateChange(true); setBusy(true); running.current = true;
    const say = (s: string) => { if (mounted.current) setMessage(s); };
    let total = 0, count = 0, wins = 0, losses = 0, peak = 0, drawdown = 0;
    try {
      const pending = localStorage.getItem(key);
      if (pending) {
        if (pending === 'unknown') throw Error('A previous purchase was not confirmed. Check account transactions before trading. This bot remains locked to prevent duplicate purchases.');
        const check = await ws.send<Reply>({ proposal_open_contract: 1, contract_id: Number(pending) });
        if (!check.proposal_open_contract?.is_sold) throw Error('A previous bot contract is still open. Wait for settlement before restarting.');
        const previous = readBotTransactions(accountId).find(x => x.contractId === Number(pending));
        const recoveredProfit = Number(check.proposal_open_contract.profit);
        if (previous && Number.isFinite(recoveredProfit)) onTransaction({ ...previous, profit: recoveredProfit, settledAt: Date.now(), status: recoveredProfit > 0 ? 'won' : recoveredProfit < 0 ? 'lost' : 'break-even' });
        localStorage.removeItem(key);
        await balanceSync.refresh();
      }
      const portfolio = await ws.send<Reply>({ portfolio: 1 });
      if (!portfolio.portfolio || portfolio.portfolio.contracts.length) throw Error('Wait until existing account positions close before starting the bot.');
      if (!running.current || !mounted.current) return;
      setProfit(0); setTrades(0); setResults({ wins: 0, losses: 0, drawdown: 0 });
      const symbol = market.activeSymbol.underlying_symbol;
      say('Waiting for the cursor to touch digit 8 before the first purchase…');
      const entryEpoch = await waitForDigitEight(ws, symbol, market.pipSize, market.currentTick?.epoch ?? 0, () => running.current && mounted.current);
      if (!ws.isConnected) throw Error('Disconnected while waiting for digit 8. Stopped.');
      if (entryEpoch === null || !running.current || !mounted.current) return;
      while (running.current && mounted.current) {
        if (total >= goal) { say('Profit target reached. Stopped.'); break; }
        if (total <= -loss || amount > loss + total + 0.000001) { say('Loss limit reached, or remaining allowance is below the stake. Stopped.'); break; }
        if (!ws.isConnected) throw Error('Disconnected. Stopped; no automatic restart.');
        say('Requesting Under '+barrier+' quote…');
        const quote = await ws.send<Reply>({ proposal: 1, amount, basis: 'stake', contract_type: 'DIGITUNDER', currency, duration, duration_unit: 't', underlying_symbol: symbol, barrier });
        if (!running.current || !mounted.current) break;
        const p = quote.proposal, price = Number(p?.ask_price);
        if (!p?.id || !Number.isFinite(price) || price <= 0 || price > amount + 0.000001 || price > loss + total + 0.000001) throw Error('Invalid quote or quote exceeds the stake/loss allowance.');
        localStorage.setItem(key, 'unknown');
        say('Purchasing Under '+barrier+'…');
        const purchase = await ws.send<Reply>({ buy: p.id, price: String(price) });
        const id = purchase.buy?.contract_id;
        if (!id) throw Error('Purchase confirmation missing. Stopped; check account transactions.');
        localStorage.setItem(key, String(id));
        const transaction: BotTransaction = { accountId, botId: barrier === '8' ? 'expert' : 'master', contractId: id, symbol, currency, barrier, ticks: duration, stake: price, purchasedAt: Date.now(), status: 'open' };
        onTransaction(transaction);
        say('Contract ' + id + ' open. Waiting for settlement…');
        const deadline = Date.now() + 180000;
        let settled = false;
        while (Date.now() < deadline) {
          if (!ws.isConnected) throw Error('Connection lost with a contract pending. Reconnect and press Start to reconcile it.');
          const response = await ws.send<Reply>({ proposal_open_contract: 1, contract_id: id });
          const c = response.proposal_open_contract;
          if (c?.is_sold) {
            const pnl = Number(c.profit);
            if (!Number.isFinite(pnl)) throw Error('Settlement profit unavailable. Stopped.');
            total = Math.round((total + pnl) * 100) / 100; count++;
            if (pnl > 0) wins++; else if (pnl < 0) losses++;
            peak = Math.max(peak, total); drawdown = Math.max(drawdown, peak - total);
            localStorage.removeItem(key); settled = true;
            onTransaction({ ...transaction, profit: pnl, settledAt: Date.now(), status: pnl > 0 ? 'won' : pnl < 0 ? 'lost' : 'break-even' });
            if (mounted.current) { setProfit(total); setTrades(count); setResults({ wins, losses, drawdown }); }
            const refreshed = await balanceSync.refresh();
            say('Contract settled: ' + pnl.toFixed(2) + ' ' + currency + (refreshed ? '. Account balance refreshed.' : '. Balance refresh unavailable; check Deriv account history.'));
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 1200));
        }
        if (!settled) throw Error('Settlement timed out. Stopped; reconcile the pending contract before restarting.');
        if (running.current) await new Promise(resolve => setTimeout(resolve, 1000));
      }
      if (!running.current) say('Stopped. No further purchases.');
    } catch (e) { say(e instanceof Error ? e.message : 'Bot stopped after an error.'); }
    finally { running.current = false; lock.current = false; sessionLock.current = false; onRunStateChange(false); if (mounted.current) setBusy(false); }
  }
  return <section className="space-y-5 rounded-2xl border p-4 sm:p-6" aria-label={botName}>
    <h2 className="text-2xl font-bold">{botName} · Under {barrier} bot</h2>
    <p className="text-muted-foreground">Digit Under {barrier} wins on {barrier === '8' ? '0–7' : '0–6'} and loses on {barrier === '8' ? '8–9' : '7–9'}. Your chosen stake, one contract at a time. Entry trigger: digit 8. Start arms the bot; only the first purchase waits for a live digit 8. Later purchases continue after settlement. This bot does not predict digits.</p>
    <div className="rounded-xl border p-4" aria-label="Live last digit">
      <p className="mb-3 text-sm">First entry: cursor on 8 · Last digit: {market.currentTick ? getLastDigit(market.currentTick.quote, market.pipSize) : '—'}</p>
      <div className="grid grid-cols-10 gap-1">{Array.from({ length: 10 }, (_, digit) => <span key={digit} className={'rounded-md border py-2 text-center font-bold ' + (market.currentTick && getLastDigit(market.currentTick.quote, market.pipSize) === digit ? 'bg-primary text-primary-foreground' : digit === 8 ? 'border-primary text-primary' : '')}>{digit}</span>)}</div>
    </div>
    <div className="rounded-xl border p-5 space-y-4">
      <label className="block">Volatility index<select className="mt-2 block w-full rounded-md border bg-background p-3" value={market.activeSymbol?.underlying_symbol ?? ''} disabled={busy} onChange={e => market.selectSymbol(e.target.value)}><option value="" disabled>Select a market</option>{market.symbols.filter(s => /volatility/i.test(s.underlying_symbol_name)).map(s => <option key={s.underlying_symbol} value={s.underlying_symbol}>{s.underlying_symbol_name}</option>)}</select></label>
      <div className="grid grid-cols-2 gap-4">{[{label:'Stake ('+currency+')',value:stake,set:setStake},{label:'Duration (ticks)',value:ticks,set:setTicks},{label:'Profit target ('+currency+')',value:target,set:setTarget},{label:'Loss limit ('+currency+')',value:limit,set:setLimit}].map(f => <label key={f.label}>{f.label}<Input className="mt-2" type="number" min="0" step={f.label.includes('ticks')?'1':'0.01'} value={f.value} disabled={busy} onChange={e => f.set(e.target.value)} /></label>)}</div>
      <p className="text-sm">Account: {auth.activeAccount ? auth.activeAccount.account_type+' · '+accountId : 'Not logged in'}. Settings lock while running.</p>
      <div className="flex gap-3">{auth.authState !== 'authenticated' ? <Button onClick={() => auth.login()}>Log in</Button> : <Button onClick={start} disabled={busy || anotherBotRunning || !isConnected || !market.activeSymbol}>Start bot</Button>}<Button variant="destructive" onClick={stop} disabled={!busy}>Stop</Button></div>
    </div>
    <div className="rounded-xl border p-5" aria-live="polite"><p>{message}</p><div className="mt-4 flex gap-8"><span>Trades: <b>{trades}</b></span><span>Net profit: <b>{profit.toFixed(2)} {currency}</b></span></div><p className="mt-3 text-sm">Session wins: {results.wins} · Losses: {results.losses} · Win rate: {trades ? (results.wins / trades * 100).toFixed(1) + '%' : '—'} · Largest drawdown: {results.drawdown.toFixed(2)} {currency}</p><p className="mt-3 text-sm">Options account balance: {auth.activeAccount?.balance ?? '—'} {currency}</p>{balanceSync.error && <p className="mt-2 text-sm text-amber-500" role="status">{balanceSync.error}</p>}<Button className="mt-3" variant="outline" onClick={() => void balanceSync.refresh()} disabled={!isConnected || !auth.wsUrl}>Refresh balance</Button></div>
    {anotherBotRunning && <p role="status" className="text-sm text-amber-500">The other bot is running. Stop it before starting {botName}.</p>}
    <p className="text-sm text-muted-foreground">Keep this page open. Leaving the page or backgrounding your iPhone stops new purchases. Stop cannot cancel an order already sent. Trading can lose money; targets do not guarantee profit.</p>
  </section>;
}
