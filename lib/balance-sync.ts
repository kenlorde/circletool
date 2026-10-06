export interface BalanceUpdate { accountId?: string; balance: string; currency?: string }
export interface BalanceSyncStatus { error: string | null; lastUpdated: number | null }
interface Transport {
  send<T = Record<string, unknown>>(payload: Record<string, unknown>): Promise<T>;
  subscribe(payload: Record<string, unknown>, handler: (message: Record<string, unknown>) => void): Promise<{ unsubscribe: () => Promise<void> }>;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function amount(value: unknown): string | null {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '' || !Number.isFinite(Number(value))) return null;
  return String(value);
}
export function parseBalanceUpdate(message: Record<string, unknown>): BalanceUpdate | null {
  const payload = message.balance;
  const scalar = amount(payload);
  if (scalar !== null) return { balance: scalar };
  if (!record(payload)) return null;
  const balance = amount(payload.balance);
  if (balance === null) return null;
  return { balance, accountId: typeof payload.loginid === 'string' ? payload.loginid : typeof payload.account_id === 'string' ? payload.account_id : undefined,
    currency: typeof payload.currency === 'string' ? payload.currency : undefined };
}

// One controller per authenticated socket/account. Never derive balances from P&L.
export function createBalanceSync(ws: Transport, accountId: string,
  onUpdate: (update: BalanceUpdate) => void, onStatus: (status: BalanceSyncStatus) => void,
  options: { requestTimeoutMs?: number; pollMs?: number; retryMs?: number } = {}) {
  let disposed = false, revision = 0, lastUpdated: number | null = null;
  let inFlight: Promise<boolean> | null = null;
  let unsubscribe: (() => Promise<void>) | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  const timers = new Map<ReturnType<typeof setTimeout>, () => void>();
  const report = (error: string | null) => { if (!disposed) onStatus({ error, lastUpdated }); };
  const timed = <T>(promise: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { timers.delete(timer); reject(new Error('Balance request timed out')); }, options.requestTimeoutMs ?? 10000);
    timers.set(timer, () => reject(new Error('Balance sync stopped')));
    promise.then(value => { clearTimeout(timer); timers.delete(timer); resolve(value); }, error => { clearTimeout(timer); timers.delete(timer); reject(error); });
  });
  const apply = (message: Record<string, unknown>): boolean => {
    const update = parseBalanceUpdate(message);
    if (disposed || !update || (update.accountId && update.accountId !== accountId)) return false;
    revision++; lastUpdated = Date.now();
    onUpdate({ ...update, accountId }); report(null); return true;
  };
  const refresh = (fresh = false): Promise<boolean> => {
    if (disposed) return Promise.resolve(false);
    if (inFlight) return fresh ? inFlight.then(() => refresh()) : inFlight;
    const before = revision;
    inFlight = timed(ws.send({ balance: 1 })).then(message => {
      if (disposed) return false;
      // Don't overwrite a newer stream frame with a delayed snapshot.
      if (revision !== before) return true;
      if (!apply(message)) throw new Error('Invalid account balance response');
      return true;
    }).catch(() => {
      if (!disposed && revision === before) report('Balance could not be refreshed. Displayed balance may be out of date.');
      return !disposed && revision !== before;
    }).finally(() => { inFlight = null; });
    return inFlight;
  };
  const subscribe = () => {
    if (disposed) return;
    const request = ws.subscribe({ balance: 1 }, message => {
      if (!apply(message) && !disposed) report('Balance update could not be verified.');
    });
    // Release late subscriptions after account switches or request timeouts.
    let accepted = false, finished = false;
    request.then(subscription => { if (disposed || (finished && !accepted)) void subscription.unsubscribe(); }, () => {});
    void timed(request).then(subscription => {
      accepted = true;
      if (disposed) return;
      unsubscribe = subscription.unsubscribe;
    }).catch(() => {
      if (disposed) return;
      report('Live balance updates unavailable. Retrying; displayed balance may be out of date.');
      void refresh();
      retry = setTimeout(subscribe, options.retryMs ?? 15000);
    }).finally(() => { finished = true; });
  };
  subscribe();
  const poll = setInterval(() => { void refresh(); }, options.pollMs ?? 30000);
  return { refresh, dispose() {
    disposed = true; clearInterval(poll); if (retry) clearTimeout(retry);
    for (const [timer, cancel] of timers) { clearTimeout(timer); cancel(); }
    timers.clear(); if (unsubscribe) void unsubscribe();
  } };
}
