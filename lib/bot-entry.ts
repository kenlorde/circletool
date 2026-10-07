import type { DerivWS } from '@deriv/core';
import { getLastDigit } from './digit-stats';

// Listen to the market's existing tick stream; never open a duplicate subscription.
export function waitForDigitEight(ws: Pick<DerivWS, 'onMessage' | 'isConnected'>, symbol: string, pipSize: number, afterEpoch: number, active: () => boolean): Promise<number | null> {
  return new Promise(resolve => {
    let finished = false;
    const finish = (epoch: number | null) => {
      if (finished) return;
      finished = true; unsubscribe(); clearInterval(timer); resolve(epoch);
    };
    const unsubscribe = ws.onMessage(data => {
      if (!active() || !ws.isConnected) { finish(null); return; }
      if (data.msg_type !== 'tick') return;
      const tick = data.tick as { symbol?: string; quote?: unknown; epoch?: unknown; pip_size?: unknown } | undefined;
      if (!tick || tick.symbol !== symbol || tick.quote == null) return;
      const price = Number(tick.quote), epoch = Number(tick.epoch);
      const precision = tick.pip_size == null ? pipSize : Number(tick.pip_size);
      if (!Number.isFinite(price) || !Number.isFinite(epoch) || epoch <= afterEpoch || !Number.isInteger(precision) || precision < 0 || precision > 20) return;
      if (getLastDigit(price, precision) === 8) finish(epoch);
    });
    // Stop/background/account change must release the run lock even without ticks.
    const timer = setInterval(() => { if (!active() || !ws.isConnected) finish(null); }, 100);
  });
}
