'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DerivWS } from '@deriv/core';
import { createBalanceSync, type BalanceSyncStatus } from '@/lib/balance-sync';
export { parseBalanceUpdate } from '@/lib/balance-sync';
export type { BalanceUpdate } from '@/lib/balance-sync';

export function useBalanceSync(ws: DerivWS | null, isConnected: boolean, activeAccountId: string | null,
  onBalanceUpdate: (accountId: string, balance: string, currency?: string) => void) {
  const updateRef = useRef(onBalanceUpdate);
  updateRef.current = onBalanceUpdate;
  const controllerRef = useRef<ReturnType<typeof createBalanceSync> | null>(null);
  const [status, setStatus] = useState<BalanceSyncStatus>({ error: null, lastUpdated: null });
  useEffect(() => {
    setStatus({ error: activeAccountId ? 'Account balance is awaiting verification.' : null, lastUpdated: null });
    if (!ws || !isConnected || !activeAccountId) return;
    const controller = createBalanceSync(ws, activeAccountId,
      update => updateRef.current(activeAccountId, update.balance, update.currency), setStatus);
    controllerRef.current = controller;
    const focus = () => { if (!document.hidden) void controller.refresh(); };
    document.addEventListener('visibilitychange', focus);
    return () => {
      controllerRef.current = null; controller.dispose();
      document.removeEventListener('visibilitychange', focus);
    };
  }, [ws, isConnected, activeAccountId]);
  const refresh = useCallback(() => controllerRef.current?.refresh(true) ?? Promise.resolve(false), []);
  return { ...status, refresh };
}
