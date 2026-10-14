'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { DerivWS } from '../ws';
import type { ProposalResponse, ProposalInfo, ProposalParams } from '../types';

interface UseProposalReturn {
  proposal: ProposalInfo | null;
  refresh: () => void;
}

export function useProposal(
  ws: DerivWS | null,
  isConnected: boolean,
  params: ProposalParams | null
): UseProposalReturn {
  const [quote, setQuote] = useState<{ key: string; ws: DerivWS; proposal: ProposalInfo } | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const key = JSON.stringify(params);
  const proposal = isConnected && params && quote?.key === key && quote.ws === ws ? quote.proposal : null;
  const unsubRef = useRef<(() => void) | null>(null);
  const retryAttempt = useRef(0);
  const retryIdentity = useRef<{ ws: DerivWS | null; key: string } | null>(null);

  useEffect(() => {
    // Forget previous proposal subscription
    if (unsubRef.current) {
      unsubRef.current();
      unsubRef.current = null;
    }

    if (!ws || !isConnected || !params || params.amount <= 0) {
      return;
    }

    let cancelled = false;
    if (retryIdentity.current?.ws !== ws || retryIdentity.current?.key !== key) {
      retryAttempt.current = 0;
      retryIdentity.current = { ws, key };
    }
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let quoteTimer: ReturnType<typeof setTimeout> | undefined;
    const retry = () => {
      if (cancelled || retryTimer !== undefined) return;
      clearTimeout(quoteTimer);
      setQuote(null);
      const delay = Math.min(250 * 2 ** Math.min(retryAttempt.current++, 5), 8000);
      retryTimer = setTimeout(() => {
        if (!cancelled) refresh();
      }, delay);
    };
    // A silent request must recover too, without retrying any purchase.
    quoteTimer = setTimeout(retry, 3000);

    const payload: Record<string, unknown> = {
      proposal: 1,
      amount: params.amount,
      basis: params.basis,
      contract_type: params.contractType,
      currency: params.currency,
      underlying_symbol: params.symbol,
    };

    if (params.dateExpiry !== undefined) {
      payload.date_expiry = params.dateExpiry;
    } else {
      payload.duration = params.duration;
      payload.duration_unit = params.durationUnit;
    }

    if (params.barrier !== undefined) {
      payload.barrier = params.barrier;
    }

    ws.subscribe(payload, (data) => {
      if (cancelled) return;
      const resp = data as unknown as ProposalResponse;
      if (resp.proposal) {
        clearTimeout(quoteTimer);
        clearTimeout(retryTimer);
        retryTimer = undefined;
        retryAttempt.current = 0;
        setQuote({ key, ws, proposal: {
          receivedAt: Date.now(),
          id: resp.proposal.id,
          askPrice: Number(resp.proposal.ask_price),
          payout: Number(resp.proposal.payout),
          longcode: resp.proposal.longcode,
          minStake: parseFloat(resp.proposal.validation_params?.stake?.min ?? '0'),
          maxPayout: parseFloat(resp.proposal.validation_params?.payout?.max ?? '0'),
        } });
      }
    }).then((sub) => {
      if (cancelled) {
        sub.unsubscribe();
      } else {
        unsubRef.current = sub.unsubscribe;
      }
    }).catch(() => {
      retry();
    });

    return () => {
      cancelled = true;
      clearTimeout(quoteTimer);
      clearTimeout(retryTimer);
      setQuote(null);
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally using individual param fields to avoid re-subscribing on object reference changes
  }, [ws, isConnected, params?.contractType, params?.symbol, params?.amount, params?.duration, params?.durationUnit, params?.barrier, params?.basis, params?.currency, params?.dateExpiry, revision]);

  return { proposal, refresh };
}
