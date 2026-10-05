'use client';
import { useEffect, useRef, useState } from 'react';
import type { BuyResult } from '@deriv/core';
import type { OpenPosition } from '@/lib/types';
import { getContractDigitResult, type ContractDigitResult } from '@/lib/contract-digit-result';

export function useContractDigitResult(buyResult: BuyResult | null, positions: OpenPosition[], pipSize: number, accountKey: string | null | undefined) {
  const [result, setResult] = useState<ContractDigitResult | null>(null);
  const purchases = useRef(new Map<number, { pipSize: number; closed: boolean }>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    purchases.current.clear();
    setResult(null);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [accountKey]);
  useEffect(() => {
    if (buyResult && !purchases.current.has(buyResult.contractId)) {
      purchases.current.set(buyResult.contractId, { pipSize, closed: false });
      if (timer.current) clearTimeout(timer.current);
      setResult(null);
    }
    for (const position of positions) {
      const purchase = purchases.current.get(position.contract_id);
      if (!purchase || purchase.closed) continue;
      const settled = getContractDigitResult(position, purchase.pipSize);
      if (!settled) continue;
      purchase.closed = true;
      if (timer.current) clearTimeout(timer.current);
      setResult(settled);
      timer.current = setTimeout(() => setResult(null), 6500);
    }
    if (purchases.current.size > 100) {
      const oldest = [...purchases.current].find(([, value]) => value.closed);
      if (oldest) purchases.current.delete(oldest[0]);
    }
  }, [buyResult, positions, pipSize]);
  return result;
}
