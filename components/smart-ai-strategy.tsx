'use client';
import { useState } from 'react';
import { useDerivWSContext } from '@/components/custom/deriv-ws-provider';
import { useBaseTrading } from '@/hooks/use-base-trading';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const TYPES = ['CALL', 'PUT'];
export function SmartAIStrategy() {
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
  return <section className="space-y-5 rounded-2xl border p-4 sm:p-6" aria-label="Smart AI">
    <h2 className="text-2xl font-bold">Smart AI · Rise/Fall bot</h2>
    <p className="text-muted-foreground">Review the original strategy’s market, stake, duration and session settings below.</p>
    <div className="rounded-xl border p-4"><p className="text-sm">Live price: <b>{market.currentTick?.quote ?? '—'}</b> · Rise/Fall</p></div>
    <div className="rounded-xl border p-5 space-y-4">
      <label className="block">Volatility index<select className="mt-2 block w-full rounded-md border bg-background p-3" value={market.activeSymbol?.underlying_symbol ?? ''} onChange={e => market.selectSymbol(e.target.value)}><option value="" disabled>Select a market</option>{market.symbols.filter(s => /volatility/i.test(s.underlying_symbol_name)).map(s => <option key={s.underlying_symbol} value={s.underlying_symbol}>{s.underlying_symbol_name}</option>)}</select></label>
      <div className="grid grid-cols-2 gap-4">{[{label:`Stake (${currency})`,value:stake,set:setStake},{label:'Duration (ticks)',value:ticks,set:setTicks},{label:`Profit target (${currency})`,value:target,set:setTarget},{label:`Loss limit (${currency})`,value:limit,set:setLimit},{label:'Martingale multiplier',value:martingale,set:setMartingale}].map(f => <label key={f.label}>{f.label}<Input className="mt-2" type="number" min="0" step={f.label.includes('ticks') ? '1' : '0.01'} value={f.value} onChange={e => f.set(e.target.value)} /></label>)}</div>
      <label className="flex items-center gap-2"><input type="checkbox" checked={useList} onChange={e => setUseList(e.target.checked)} />Use stake list</label>
      {useList && <label className="block">Stake sequence<Input className="mt-2" value={stakeList} onChange={e => setStakeList(e.target.value)} /></label>}
      <p className="text-sm">Account: {auth.activeAccount ? `${auth.activeAccount.account_type} · ${auth.activeAccount.account_id}` : 'Not logged in'}.</p>
      <div className="flex gap-3">{auth.authState !== 'authenticated' ? <Button onClick={() => auth.login()}>Log in</Button> : <Button disabled aria-describedby="smart-ai-status">Start bot</Button>}<Button variant="destructive" disabled>Stop</Button></div>
    </div>
    <div className="rounded-xl border p-5" aria-live="polite"><p id="smart-ai-status">Trading requires support for this strategy’s Rise/Fall and custom analysis blocks. These settings do not place trades.</p><div className="mt-4 flex gap-8"><span>Trades: <b>0</b></span><span>Net profit: <b>0.00 {currency}</b></span></div><p className="mt-3 text-sm">Options account balance: {auth.activeAccount?.balance ?? '—'} {currency}</p><Button className="mt-3" variant="outline" onClick={() => void balanceSync.refresh()} disabled={!isConnected || !auth.wsUrl}>Refresh balance</Button>{balanceSync.error && <p role="status" className="mt-2 text-sm text-amber-500">{balanceSync.error}</p>}</div>
  </section>;
}
