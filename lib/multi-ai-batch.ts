export type MultiQuote = { id: string; ask_price: number | string; payout?: number | string };
export type MultiBuy = { contract_id: number; buy_price?: number | string; payout?: number | string };
export type BatchArgs = {
  count: number; maximumPrice: number; batchSize?: number; delayMs?: number;
  canContinue: () => boolean;
  quote: () => Promise<MultiQuote | undefined>;
  buy: (quote: MultiQuote) => Promise<MultiBuy | undefined>;
  onConfirmed: (buy: MultiBuy) => void;
  onBatch?: (confirmed: MultiBuy[]) => Promise<void>;
  wait?: (ms: number) => Promise<void>;
};
/** Concurrent purchases within bounded batches; never retry an uncertain purchase. */
export async function runMultiBatch(options: BatchArgs): Promise<{ confirmed: number; uncertain: number; reason: string }> {
  const size = Math.max(1, Math.min(10, options.batchSize ?? 10));
  const wait = options.wait ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  let confirmed = 0;
  for (let offset = 0; offset < options.count; offset += size) {
    if (!options.canContinue()) return { confirmed, uncertain: 0, reason: 'Stopped before the next group.' };
    const start = Date.now();
    const amount = Math.min(size, options.count - offset);
    const quoteResults = await Promise.allSettled(Array.from({length: amount}, () => options.quote()));
    if (!options.canContinue()) return { confirmed, uncertain: 0, reason: 'Stopped before the next group.' };
    if (quoteResults.some(result => result.status !== 'fulfilled' || !result.value?.id || !Number.isFinite(Number(result.value.ask_price)) || Number(result.value.ask_price) <= 0 || Number(result.value.ask_price) > options.maximumPrice)) return { confirmed, uncertain: 0, reason: 'A quote failed or its price increased. No purchases were sent for this group.' };
    const quotes = quoteResults.map(result => (result as PromiseFulfilledResult<MultiQuote>).value);
    if (new Set(quotes.map(quote => quote.id)).size !== quotes.length) return { confirmed, uncertain: 0, reason: 'Deriv returned duplicate quotes. No purchases were sent for this group.' };
    const results = await Promise.allSettled(quotes.map(quote => options.buy(quote)));
    const purchased: MultiBuy[] = [];
    let uncertain = 0;
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value?.contract_id) { purchased.push(result.value); confirmed++; options.onConfirmed(result.value); }
      else uncertain++;
    }
    if (uncertain) return { confirmed, uncertain, reason: 'Some purchase results are unknown or failed. Check Deriv positions before trying again.' };
    if (options.onBatch && options.canContinue()) await options.onBatch(purchased);
    if (offset + amount < options.count && options.canContinue()) await wait(Math.max(0, (options.delayMs ?? 8000) - (Date.now() - start)));
  }
  return { confirmed, uncertain: 0, reason: 'Completed.' };
}
