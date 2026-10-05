'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useDerivWSContext } from '@/components/custom/deriv-ws-provider';
import { ADVANCED_TYPES, buildManualProposal, type AdvancedTradeType, type ManualSettings } from '@/lib/manual-trades';

interface Market { underlying_symbol: string; underlying_symbol_name: string }
interface Contract { contract_type: string; barriers?: number; min_contract_duration?: string; max_contract_duration?: string }
interface Quote { id: string; ask_price: number | string; payout?: number | string; longcode: string; barrier?: string; payout_per_point?: number | string }
interface QuoteSet { key: string; time: number; quotes: Record<string, Quote>; errors: Record<string, string> }
const message = (error: unknown) => error instanceof Error ? error.message : 'Deriv could not complete this request.';
async function withTimeout<T>(request: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([request, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error('Deriv request timed out.')), 20000); })]); }
  finally { clearTimeout(timer); }
}
const inputClass = 'w-full rounded-lg border border-border bg-background p-3 text-foreground';

export function AdvancedManualTrader({ type, initialSymbol, onBusy }: { type: AdvancedTradeType; initialSymbol?: string; onBusy?: (busy: boolean) => void }) {
  const { ws, isConnected, auth } = useDerivWSContext();
  const definition = ADVANCED_TYPES.find(item => item.value === type)!;
  const [markets, setMarkets] = useState<Market[]>([]);
  const [symbol, setSymbol] = useState(initialSymbol ?? '');
  const [catalog, setCatalog] = useState<{ symbol: string; contracts: Contract[] } | null>(null);
  const [amount, setAmount] = useState('1');
  const [duration, setDuration] = useState('5');
  const [unit, setUnit] = useState('m');
  const [barrier, setBarrier] = useState(type === 'vanillas' ? '+0.00' : '+0.10');
  const [multiplier, setMultiplier] = useState('100');
  const [payoutPerPoint, setPayoutPerPoint] = useState('1');
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [quoteSet, setQuoteSet] = useState<QuoteSet | null>(null);
  const [busy, setBusy] = useState(false);
  const [buying, setBuying] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState('');
  const [now, setNow] = useState(0);
  const buyLock = useRef(false);
  const generation = useRef(0);
  useEffect(() => { onBusy?.(busy || buying); return () => onBusy?.(false); }, [busy, buying, onBusy]);
  const currency = auth.activeAccount?.currency ?? 'USD';
  const settings: ManualSettings = { type, symbol, currency, amount, duration, unit, barrier, multiplier, payoutPerPoint, stopLoss, takeProfit };
  const key = JSON.stringify([settings, auth.activeAccountId, auth.wsUrl]);
  const currentKey = useRef(key);
  currentKey.current = key;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    generation.current += 1;
    setQuoteSet(null); setCatalog(null);
    if (!ws || !isConnected) return;
    let disposed = false;
    withTimeout(ws.send<{ active_symbols?: Market[] }>({ active_symbols: 'full' })).then(response => {
      if (disposed) return;
      const values = response.active_symbols ?? [];
      setMarkets(values);
      setSymbol(previous => values.some(market => market.underlying_symbol === previous) ? previous : values[0]?.underlying_symbol ?? '');
    }).catch(err => { if (!disposed) setError(message(err)); });
    return () => { disposed = true; };
  }, [ws, isConnected]);
  useEffect(() => {
    setCatalog(null); setQuoteSet(null); setError('');
    if (!ws || !isConnected || !symbol) return;
    let disposed = false;
    withTimeout(ws.send<{ contracts_for?: { available?: Contract[] } }>({ contracts_for: symbol })).then(response => {
      if (!disposed) setCatalog({ symbol, contracts: response.contracts_for?.available ?? [] });
    }).catch(err => { if (!disposed) setError(message(err)); });
    return () => { disposed = true; };
  }, [ws, isConnected, symbol]);

  const available = (contract: string) => catalog?.symbol === symbol && catalog.contracts.some(item => item.contract_type === contract && (type !== 'higher-lower' || Number(item.barriers) === 1));
  const validQuotes = isConnected && quoteSet?.key === key && Date.now() - quoteSet.time < 15000 && now - quoteSet.time < 15000;
  async function getQuotes() {
    if (!ws || !isConnected || busy || buying) return;
    const requestKey = key;
    const requestGeneration = generation.current;
    setBusy(true); setError(''); setQuoteSet(null); setReceipt('');
    try {
      const requests = definition.contracts.filter(available).map(contract => ({ contract, payload: buildManualProposal(settings, contract) }));
      if (!requests.length) throw new Error('This trade type is unavailable for this market. Select another market.');
      const results = await Promise.all(requests.map(async ({ contract, payload }) => {
        try {
          const response = await withTimeout(ws!.send<{ proposal?: Quote }>(payload));
          if (!response.proposal?.id || !Number.isFinite(Number(response.proposal.ask_price)) || Number(response.proposal.ask_price) <= 0) throw new Error('No valid price was returned.');
          return { contract, quote: response.proposal, error: '' };
        } catch (err) { return { contract, quote: null, error: message(err) }; }
      }));
      if (currentKey.current !== requestKey || generation.current !== requestGeneration) return;
      const quotes: Record<string, Quote> = {}; const errors: Record<string, string> = {};
      for (const result of results) { if (result.quote) quotes[result.contract] = result.quote; else errors[result.contract] = result.error; }
      setQuoteSet({ key: requestKey, time: Date.now(), quotes, errors }); setNow(Date.now());
    } catch (err) { if (currentKey.current === requestKey && generation.current === requestGeneration) setError(message(err)); }
    finally { setBusy(false); }
  }
  async function buy(contract: string) {
    if (buyLock.current || !ws || !isConnected || !validQuotes || !quoteSet || quoteSet.key !== currentKey.current) return;
    if (auth.authState !== 'authenticated') { await auth.login(); return; }
    const quote = quoteSet.quotes[contract];
    if (!quote || Date.now() - quoteSet.time >= 15000) return;
    buyLock.current = true; setBuying(true); setError(''); setReceipt(''); setQuoteSet(null);
    try {
      const response = await withTimeout(ws.send<{ buy?: { contract_id: number } }>({ buy: quote.id, price: String(quote.ask_price) }));
      if (!response.buy) throw new Error('No purchase confirmation returned. Check Positions before retrying.');
      setReceipt(`Contract ${response.buy.contract_id} purchased. View Positions to track or close it.`);
    } catch (err) { setError(`${message(err)} Check Positions before requesting another purchase.`); }
    finally { buyLock.current = false; setBuying(false); }
  }
  const fields = (label: string, value: string, change: (value: string) => void, numeric = true) => <label className="flex flex-col gap-1 text-sm">{label}<input className={inputClass} disabled={busy || buying} value={value} type={numeric ? 'number' : 'text'} step={numeric ? 'any' : undefined} onChange={event => change(event.target.value)} /></label>;

  return <div className="flex flex-col gap-4 py-4">
    <label className="flex flex-col gap-1 text-sm">Market<select className={inputClass} value={symbol} disabled={busy || buying || !isConnected} onChange={event => setSymbol(event.target.value)}>{markets.map(market => <option value={market.underlying_symbol} key={market.underlying_symbol}>{market.underlying_symbol_name}</option>)}</select></label>
    <p className="text-xs text-muted-foreground">{!isConnected ? 'Connecting to Deriv…' : !catalog ? 'Checking available contracts…' : definition.contracts.some(available) ? 'Live Deriv quotes • settings must be accepted by Deriv' : 'Unavailable on this market. Choose another market.'}</p>
    <fieldset disabled={busy || buying} className="grid grid-cols-2 gap-3">
      {fields(`Stake (${currency})`, amount, setAmount)}
      {type === 'multipliers' ? fields('Multiplier', multiplier, setMultiplier) : <>
        {fields('Duration', duration, setDuration)}
        <label className="flex flex-col gap-1 text-sm">Duration unit<select className={inputClass} value={unit} onChange={event => setUnit(event.target.value)}>{[['t', 'Ticks'], ['s', 'Seconds'], ['m', 'Minutes'], ['h', 'Hours'], ['d', 'Days']].map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        {type === 'turbos' ? fields(`Payout per point (${currency})`, payoutPerPoint, setPayoutPerPoint) : fields(type === 'vanillas' ? 'Strike barrier / offset' : 'Barrier / offset', barrier, setBarrier, false)}
      </>}
      {type === 'multipliers' && <>{fields(`Stop loss (${currency}, optional)`, stopLoss, setStopLoss)}{fields(`Take profit (${currency}, optional)`, takeProfit, setTakeProfit)}</>}
    </fieldset>
    {type !== 'multipliers' && type !== 'turbos' && <p className="text-xs text-muted-foreground">Use + or − for an offset from spot (for example +0.10), or an absolute price where supported.</p>}
    {type === 'turbos' && <p className="text-xs text-muted-foreground">Deriv calculates the knockout barrier from your payout per point. Review it in the quote before buying.</p>}
    <button type="button" className="rounded-lg bg-primary p-3 font-semibold text-primary-foreground disabled:opacity-50" disabled={!isConnected || !catalog || !definition.contracts.some(available) || busy || buying} onClick={getQuotes}>{busy ? 'Requesting quotes…' : 'Get live quotes'}</button>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {definition.contracts.map((contract, index) => {
        const quote = quoteSet?.key === key ? quoteSet.quotes[contract] : null;
        return <div className="flex flex-col gap-2 rounded-lg border border-border p-3" key={contract}>
          <strong>{definition.directions[index]}</strong>
          {quote ? <><p className="text-sm">Price: {Number(quote.ask_price).toFixed(2)} {currency}</p>{type === 'higher-lower' || type === 'touch-no-touch' ? <p className="text-sm">Payout: {Number(quote.payout ?? 0).toFixed(2)} {currency}</p> : null}{quote.barrier && <p className="text-sm">Barrier: {quote.barrier}</p>}{quote.payout_per_point != null && <p className="text-sm">Per point: {quote.payout_per_point} {currency}</p>}<p className="text-xs text-muted-foreground">{quote.longcode}</p></> : <p className="text-xs text-muted-foreground">{!available(contract) ? 'Unavailable for this market' : quoteSet?.key === key ? quoteSet.errors[contract] : 'Request a quote to view price and contract terms.'}</p>}
          <button type="button" className="mt-auto rounded-lg border border-border bg-secondary p-3 font-semibold disabled:opacity-50" disabled={!quote || !validQuotes || busy || buying} onClick={() => buy(contract)}>{buying ? 'Purchasing…' : auth.authState === 'authenticated' ? `Buy ${definition.directions[index]}` : 'Log in to buy'}</button>
        </div>;
      })}
    </div>
    {quoteSet?.key === key && <p className="text-xs text-muted-foreground">{validQuotes ? 'Quotes expire after 15 seconds. Tap Buy to purchase at the displayed price.' : 'Quotes expired. Get fresh quotes before buying.'}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {receipt && <p role="status" className="text-sm">{receipt}</p>}
    <Link className="text-sm underline" href="/reports">View Positions</Link>
  </div>;
}
