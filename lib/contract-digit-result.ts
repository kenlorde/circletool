import type { OpenPosition } from './types';

export interface ContractDigitResult {
  digit: number;
  profit: number;
  price: string;
  ticks: number;
  symbol: string;
}

export function getContractDigitResult(position: OpenPosition, pipSize: number): ContractDigitResult | null {
  if (!position.is_sold) return null;
  const profit = Number(position.profit);
  if (!Number.isFinite(profit)) return null;
  const lastTick = position.tick_stream?.[position.tick_stream.length - 1];
  const exit = Number(position.exit_spot);
  // Preserve trailing zeroes from the API's display value where available.
  const price = position.exit_spot != null && Number.isFinite(exit)
    ? exit.toFixed(pipSize)
    : lastTick?.tick_display_value;
  if (!price || !/\d$/.test(price)) return null;
  return { digit: Number(price.slice(-1)), profit, price,
    ticks: position.tick_count || position.tick_stream?.length || 0,
    symbol: position.underlying_symbol };
}
