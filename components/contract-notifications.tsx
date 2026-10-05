'use client';

import { useEffect, useRef, useState } from 'react';
import type { BuyResult } from '@deriv/core';
import type { ContractMode, OpenPosition } from '@/lib/types';

interface Notice {
  id: string;
  title: 'Trade opened' | 'Trade closed';
  description: string;
  amount: number;
  currency: string;
  closed: boolean;
}
const LABELS: Record<ContractMode, string> = {
  DIGITOVER: 'Over', DIGITUNDER: 'Under', DIGITEVEN: 'Even',
  DIGITODD: 'Odd', DIGITMATCH: 'Matches', DIGITDIFF: 'Differs',
};

export function ContractNotifications({
  buyResult, positions, contractMode, marketName,
}: {
  buyResult: BuyResult | null;
  positions: OpenPosition[];
  contractMode: ContractMode;
  marketName: string;
}) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const purchases = useRef(new Map<number, { description: string; closed: boolean }>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => () => {
    timers.current.forEach(clearTimeout);
    timers.current.clear();
    purchases.current.clear();
  }, []);

  useEffect(() => {
    const show = (notice: Notice) => {
      setNotices((current) => [...current, notice].slice(-4));
      timers.current.set(notice.id, setTimeout(() => {
        setNotices((current) => current.filter((item) => item.id !== notice.id));
        timers.current.delete(notice.id);
      }, 6500));
    };

    if (buyResult && !purchases.current.has(buyResult.contractId)) {
      const description = `${LABELS[contractMode]} on ${marketName}`;
      purchases.current.set(buyResult.contractId, { description, closed: false });
      // Keep recent contract metadata without accumulating an unlimited history.
      if (purchases.current.size > 100) {
        const oldestClosed = [...purchases.current].find(([, value]) => value.closed);
        if (oldestClosed) purchases.current.delete(oldestClosed[0]);
      }
      show({
        id: `opened-${buyResult.contractId}`, title: 'Trade opened',
        description, amount: buyResult.buyPrice, currency: 'USD', closed: false,
      });
    }

    for (const position of positions) {
      const purchase = purchases.current.get(position.contract_id);
      // Expiry alone can precede the final settlement: wait for a sold result.
      if (!purchase || purchase.closed || !position.is_sold) continue;
      const profit = Number(position.profit);
      if (!Number.isFinite(profit)) continue;
      purchase.closed = true;
      show({
        id: `closed-${position.contract_id}`, title: 'Trade closed',
        description: purchase.description, amount: profit,
        currency: position.currency || 'USD', closed: true,
      });
    }
  }, [buyResult, positions, contractMode, marketName]);

  return (
    <div className="contract-notices" role="status" aria-live="polite" aria-atomic="false">
      {notices.map((notice) => (
        <div key={notice.id} className={`contract-notice ${notice.closed ? notice.amount >= 0 ? 'won' : 'lost' : ''}`}>
          <div><strong>{notice.title}:</strong> {notice.description}</div>
          <div>{notice.closed ? 'Total profit/loss:' : 'Stake:'} <strong>
            {notice.closed && notice.amount > 0 ? '+' : ''}{notice.amount.toFixed(2)} {notice.currency}
          </strong></div>
          {notice.closed && <span className="contract-notice-time">now</span>}
        </div>
      ))}
    </div>
  );
}
