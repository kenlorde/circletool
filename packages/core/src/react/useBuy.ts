'use client';

import { useState, useCallback, useRef } from 'react';
import type { DerivWS } from '../ws';
import type { ProposalInfo, BuyResponse, BuyResult } from '../types';

interface UseBuyReturn {
  buyContract: (proposal: ProposalInfo, getFreshProposal?: () => Promise<ProposalInfo>) => Promise<void>;
  isBuying: boolean;
  buyResult: BuyResult | null;
  buyError: string | null;
  clearBuyResult: () => void;
}

export function useBuy(
  ws: DerivWS | null,
  isConnected: boolean
): UseBuyReturn {
  const purchaseLock = useRef(false);
  const [isBuying, setIsBuying] = useState(false);
  const [buyResult, setBuyResult] = useState<BuyResult | null>(null);
  const [buyError, setBuyError] = useState<string | null>(null);

  const clearBuyResult = useCallback(() => {
    setBuyResult(null);
    setBuyError(null);
  }, []);

  const buyContract = useCallback(async (proposal: ProposalInfo, getFreshProposal?: () => Promise<ProposalInfo>) => {
    if (!ws || !isConnected || purchaseLock.current) return;
    purchaseLock.current = true;

    setIsBuying(true);
    setBuyError(null);
    setBuyResult(null);

    try {
      const fresh = getFreshProposal ? await getFreshProposal() : proposal;
      if (!fresh.id || !Number.isFinite(fresh.askPrice) || fresh.askPrice <= 0) throw new Error('No valid purchase quote returned.');
      // Never pay above the price displayed when the user tapped Buy.
      if (fresh.askPrice > proposal.askPrice) throw new Error('Price changed. Review the updated quote and tap Buy again.');
      const response = await ws.send<BuyResponse>({
        buy: fresh.id,
        price: String(proposal.askPrice),
      });

      if (!response.buy) throw new Error('Purchase confirmation missing. Check Positions before trying again.');
      if (response.buy) {
        setBuyResult({
          contractId: response.buy.contract_id,
          buyPrice: response.buy.buy_price,
          payout: response.buy.payout,
          longcode: response.buy.longcode,
          balanceAfter: response.buy.balance_after,
        });
      }
    } catch (err) {
      setBuyError(err instanceof Error ? err.message : 'Purchase failed');
    } finally {
      purchaseLock.current = false;
      setIsBuying(false);
    }
  }, [ws, isConnected]);

  return { buyContract, isBuying, buyResult, buyError, clearBuyResult };
}
