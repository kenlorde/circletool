'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useDerivWSContext } from '@/components/custom/deriv-ws-provider';
import { useBaseTrading } from '@/hooks/use-base-trading';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
const TYPES = ['DIGITUNDER'];
type Reply = { proposal?: { id: string; ask_price: number | string }; buy?: { contract_id: number }; proposal_open_contract?: { is_sold: number; profit: number | string }; portfolio?: { contracts: unknown[] } };
export function SmartAIBot() {
  const { ws, isConnected, auth } = useDerivWSContext();
  const market = useBaseTrading({ ws, isConnected, isAuthenticated: !!auth.wsUrl, contractTypes: TYPES });
  const [stake, setStake] = useState('0.35'), [ticks, setTicks] = useState('1'), [target, setTarget] = useState('2'), [limit, setLimit] = useState('2');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('Stopped. Press Start to begin.'), [profit, setProfit] = useState(0), [trades, setTrades] = useState(0);
  const running = useRef(false), lock = useRef(false), mounted = useRef(true);
  const accountId = auth.activeAccount?.account_id;
  const currency = auth.activeAccount?.currency ?? 'USD';
  useEffect(() => { mounted.current = true; const hide = () => { if (document.hidden) running.current = false; }; document.addEventListener('visibilitychange', hide); return () => { mounted.current = false; running.current = false; document.removeEventListener('visibilitychange', hide); }; }, []);
  useEffect(() => { running.current = false; }, [ws, isConnected, accountId]);
  const stop = () => { running.current = false; setMessage('Stopping. A sent purchase or open contract will finish; no next trade.'); };
  async function start() {
    if (lock.current || !ws || !isConnected || auth.authState !== 'authenticated' || !accountId || !market.activeSymbol) return;
    const amount = Number(stake), duration = Number(ticks), goal = Number(target), loss = Number(limit);
    if (![amount, duration, goal, loss].every(n => Number.isFinite(n) && n > 0) || !Number.isInteger(duration) || amount > loss) { setMessage('Enter positive settings. Ticks must be a whole number and stake must fit the loss limit.'); return; }
    const key = 'circletool-under7-pending:' + accountId;
    lock.current = true; setBusy(true); running.current = true;
    const say = (s: string) => { if (mounted.current) setMessage(s); };
    let total = 0, count = 0;
    try {
      const pending = localStorage.getItem(key);
      if (pending) {
        if (pending === 'unknown') throw Error('A previous purchase was not confirmed. Check account transactions before trading. This bot remains locked to prevent duplicate purchases.');
        const check = await ws.send<Reply>({ proposal_open_contract: 1, contract_id: Number(pending) });
        if (!check.proposal_open_contract?.is_sold) throw Error('A previous bot contract is still open. Wait for settlement before restarting.');
        localStorage.removeItem(key);
      }
      const portfolio = await ws.send<Reply>({ portfolio: 1 });
      if (!portfolio.portfolio || portfolio.portfolio.contracts.length) throw Error('Wait until existing account positions close before starting the bot.');
      if (!running.current || !mounted.current) return;
      setProfit(0); setTrades(0);
      const symbol = market.activeSymbol.underlying_symbol;
      while (running.current && mounted.current) {
        if (total >= goal) { say('Profit target reached. Stopped.'); break; }
        if (total <= -loss || amount > loss + total + 0.000001) { say('Loss limit reached, or remaining allowance is below the stake. Stopped.'); break; }
        if (!ws.isConnected) throw Error('Disconnected. Stopped; no automatic restart.');
        say('Requesting Under 7 quote…');
        const quote = await ws.send<Reply>({ proposal: 1, amount, basis: 'stake', contract_type: 'DIGITUNDER', currency, duration, duration_unit: 't', symbol, barrier: '7' });
        if (!running.current || !mounted.current) break;
        const p = quote.proposal, price = Number(p?.ask_price);
        if (!p?.id || !Number.isFinite(price) || price <= 0 || price > amount + 0.000001 || price > loss + total + 0.000001) throw Error('Invalid quote or quote exceeds the stake/loss allowance.');
        localStorage.setItem(key, 'unknown');
        say('Purchasing Under 7…');
        const purchase = await ws.send<Reply>({ buy: p.id, price: String(price) });
        const id = purchase.buy?.contract_id;
        if (!id) throw Error('Purchase confirmation missing. Stopped; check account transactions.');
        localStorage.setItem(key, String(id));
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
            localStorage.removeItem(key); settled = true;
            if (mounted.current) { setProfit(total); setTrades(count); }
            say('Contract settled: ' + pnl.toFixed(2) + ' ' + currency);
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 1200));
        }
        if (!settled) throw Error('Settlement timed out. Stopped; reconcile the pending contract before restarting.');
        if (running.current) await new Promise(resolve => setTimeout(resolve, 1000));
      }
      if (!running.current) say('Stopped. No further purchases.');
    } catch (e) { say(e instanceof Error ? e.message : 'Bot stopped after an error.'); }
    finally { running.current = false; lock.current = false; if (mounted.current) setBusy(false); }
  }
  return <main className="mx-auto max-w-2xl space-y-5 px-4 py-6">
    <nav className="flex flex-wrap gap-4 text-sm"><Link href="/">Manual Trader</Link><span className="font-bold text-emerald-500">Smart AI</span><Link href="/copy-trading">Copy Trading</Link><Link href="/charts">Charts</Link></nav>
    <h1 className="text-2xl font-bold">Smart AI · Under 7 bot</h1>
    <p className="text-muted-foreground">Digit Under 7 wins on 0–6 and loses on 7–9. Fixed stake, one contract at a time. This bot follows rules; it does not predict digits.</p>
    <div className="rounded-xl border p-5 space-y-4">
      <label className="block">Volatility index<select className="mt-2 block w-full rounded-md border bg-background p-3" value={market.activeSymbol?.underlying_symbol ?? ''} disabled={busy} onChange={e => market.selectSymbol(e.target.value)}><option value="" disabled>Select a market</option>{market.symbols.filter(s => /volatility/i.test(s.underlying_symbol_name)).map(s => <option key={s.underlying_symbol} value={s.underlying_symbol}>{s.underlying_symbol_name}</option>)}</select></label>
      <div className="grid grid-cols-2 gap-4">{[{label:'Stake ('+currency+')',value:stake,set:setStake},{label:'Duration (ticks)',value:ticks,set:setTicks},{label:'Profit target ('+currency+')',value:target,set:setTarget},{label:'Loss limit ('+currency+')',value:limit,set:setLimit}].map(f => <label key={f.label}>{f.label}<Input className="mt-2" type="number" min="0" step={f.label.includes('ticks')?'1':'0.01'} value={f.value} disabled={busy} onChange={e => f.set(e.target.value)} /></label>)}</div>
      <p className="text-sm">Account: {auth.activeAccount ? auth.activeAccount.account_type+' · '+accountId : 'Not logged in'}. Settings lock while running.</p>
      <div className="flex gap-3">{auth.authState !== 'authenticated' ? <Button onClick={() => auth.login()}>Log in</Button> : <Button onClick={start} disabled={busy || !isConnected || !market.activeSymbol}>Start bot</Button>}<Button variant="destructive" onClick={stop} disabled={!busy}>Stop</Button></div>
    </div>
    <div className="rounded-xl border p-5" aria-live="polite"><p>{message}</p><div className="mt-4 flex gap-8"><span>Trades: <b>{trades}</b></span><span>Net profit: <b>{profit.toFixed(2)} {currency}</b></span></div></div>
    <p className="text-sm text-muted-foreground">Keep this page open. Leaving the page or backgrounding your iPhone stops new purchases. Stop cannot cancel an order already sent. Trading can lose money; targets do not guarantee profit.</p>
  </main>;
}
