'use client';
import { useEffect, useState } from 'react';
import type { Tick } from '@deriv/core';

export function ManualPriceChart({ tick, symbol, pipSize }: { tick: Tick | null; symbol: string; pipSize: number }) {
  const [series, setSeries] = useState<{ symbol: string; ticks: Tick[] }>({ symbol, ticks: [] });
  useEffect(() => {
    if (!tick || tick.symbol !== symbol || !Number.isFinite(Number(tick.quote))) return;
    setSeries(previous => {
      const ticks = previous.symbol === symbol ? previous.ticks : [];
      if (ticks.at(-1)?.epoch === tick.epoch && ticks.at(-1)?.quote === tick.quote) return previous;
      return { symbol, ticks: [...ticks.slice(-59), tick] };
    });
  }, [tick, symbol]);
  const values = series.symbol === symbol ? series.ticks.map(item => Number(item.quote)) : [];
  if (values.length < 2) return <div className="manual-price-chart manual-chart-wait" role="status">Waiting for live price history…</div>;
  const low = Math.min(...values), high = Math.max(...values);
  const padding = Math.max((high - low) * .3, 10 ** -pipSize * 5);
  const min = low - padding, max = high + padding;
  const y = (price: number) => 240 - (price - min) / (max - min) * 210;
  const points = values.map((price, index) => `${18 + index / (values.length - 1) * 300},${y(price)}`);
  const last = values[values.length - 1];
  return <figure className="manual-price-chart" aria-label={`Live ${symbol} price chart. Latest price ${last.toFixed(pipSize)}`}>
    <svg viewBox="0 0 400 280" role="img" aria-label="Recent live tick prices">
      {[max, (max + min) / 2, min].map((price, index) => <g key={index}><line x1="12" x2="340" y1={y(price)} y2={y(price)} stroke="#30353b" strokeDasharray="2 5" /><text x="345" y={y(price) + 4} fill="#89939e" fontSize="9">{price.toFixed(pipSize)}</text></g>)}
      <path d={`M${points[0]} L${points.join(' L')} L318,255 L18,255 Z`} fill="#ffffff" opacity=".04" />
      <polyline points={points.join(' ')} fill="none" stroke="#cbd5df" strokeWidth="1.8" strokeLinejoin="round" />
      <line x1="318" x2="342" y1={y(last)} y2={y(last)} stroke="#cbd5df" strokeDasharray="2 3" /><circle cx="318" cy={y(last)} r="3" fill="white" />
      <rect x="341" y={y(last) - 9} width="59" height="18" rx="2" fill="#f4f7fa" /><text x="345" y={y(last) + 3} fill="#111a24" fontSize="10" fontWeight="700">{last.toFixed(pipSize)}</text>
      <text x="16" y="273" fill="#89939e" fontSize="9">Live ticks</text>
    </svg>
    <figcaption className="sr-only">A rolling window of up to 60 live ticks. No simulated prices.</figcaption>
  </figure>;
}
