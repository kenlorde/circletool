// A screening assumption, not a prediction or evidence of an edge.
export function assessUnderQuote(barrier: '7' | '8', askPrice: unknown, totalPayout: unknown) {
  const price = Number(askPrice), payout = Number(totalPayout);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(payout) || payout <= price) {
    throw Error('Quote payout unavailable or invalid. No purchase sent.');
  }
  const baselineWinRate = Number(barrier) / 10;
  const breakEvenWinRate = price / payout;
  const expectedProfit = baselineWinRate * payout - price;
  return { price, payout, baselineWinRate, breakEvenWinRate, expectedProfit,
    eligible: expectedProfit > 0.000001 };
}
