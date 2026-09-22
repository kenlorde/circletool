'use client';

import { useState, useMemo, useCallback } from 'react';
import { useProposal, useBuy } from '@deriv/core';

import type {
  ActiveSymbol,
  Tick,
  ProposalInfo,
  ProposalParams,
  DurationLimits,
  BuyResult,
} from '@deriv/core';

import { useBaseTrading } from '@/hooks/use-base-trading';
import type { UseBaseTradingParams } from '@/hooks/use-base-trading';

import { computeDigitStats, getLastDigit } from '../lib/digit-stats';

import type {
  ContractMode,
  TradeType,
  DigitStats,
  OpenPosition,
  ClosedPosition,
} from '../lib/types';

const CONTRACT_TYPES = [
  'DIGITMATCH',
  'DIGITDIFF',
  'DIGITOVER',
  'DIGITUNDER',
  'DIGITEVEN',
  'DIGITODD',
];

interface UseDigitsTradingReturn {
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;

  symbols: ActiveSymbol[];
  activeSymbol: ActiveSymbol | null;

  selectSymbol: (symbol: string) => void;

  currentTick: Tick | null;
  lastDigit: number | null;
  digitStats: DigitStats;

  tradeType: TradeType;
  setTradeType: (type: TradeType) => void;

  contractMode: ContractMode;
  setContractMode: (mode: ContractMode) => void;

  selectedDigit: number;
  setSelectedDigit: (digit: number) => void;

  contractsAvailable: boolean;
  pipSize: number;

  stake: string;
  setStake: (value: string) => void;

  duration: number;
  setDuration: (value: number) => void;

  durationLimits: DurationLimits;
  defaultStake: number;

  proposal: ProposalInfo | null;
  isProposalLoading: boolean;

  buyContract: () => Promise<void>;
  isBuying: boolean;
  buyResult: BuyResult | null;
  buyError: string | null;
  clearBuyResult: () => void;

  openPositions: OpenPosition[];
  closedPositions: ClosedPosition[];

  sellContract: (
    contractId: number,
    bidPrice: string
  ) => Promise<void>;

  sellingId: number | null;
  sellError: string | null;
  clearSellError: () => void;
}

export type UseDigitsTradingParams = Pick<
  UseBaseTradingParams,
  | 'ws'
  | 'isConnected'
  | 'isExhausted'
  | 'isAuthenticated'
  | 'onAuthWSFailed'
>;

export function useDigitsTrading({
  ws,
  isConnected,
  isExhausted,
  isAuthenticated,
  onAuthWSFailed,
}: UseDigitsTradingParams): UseDigitsTradingReturn {
  const {
    ws: tradingWs,
    isConnected: tradingIsConnected,
    isLoading,
    error,
    symbols,
    activeSymbol,
    selectSymbol,
    currentTick,
    prices,
    pipSize,
    contractsAvailable,
    durationLimits,
    defaultStake,
    openPositions,
    closedPositions,
    sellContract,
    sellingId,
    sellError,
    clearSellError,
  } = useBaseTrading({
    ws,
    isConnected,
    isExhausted,
    isAuthenticated,
    onAuthWSFailed,
    contractTypes: CONTRACT_TYPES,
  });

  const [tradeType, setTradeTypeRaw] =
    useState<TradeType>('matches-differs');

  const [contractMode, setContractMode] =
    useState<ContractMode>('DIGITMATCH');

  const [selectedDigit, setSelectedDigit] =
    useState<number>(5);

  const [stake, setStake] =
    useState<string>('10');

  const [duration, setDuration] =
    useState<number>(5);

  const setTradeType = useCallback((type: TradeType) => {
    setTradeTypeRaw(type);

    switch (type) {
      case 'matches-differs':
        setContractMode('DIGITMATCH');
        break;

      case 'over-under':
        setContractMode('DIGITOVER');
        break;

      case 'even-odd':
        setContractMode('DIGITEVEN');
        break;
    }
  }, []);

  const digitStats: DigitStats = useMemo(
    () => computeDigitStats(prices, pipSize),
    [prices, pipSize]
  );

  const lastDigit = useMemo(() => {
    if (currentTick) {
      return getLastDigit(
        currentTick.quote,
        pipSize
      );
    }

    if (prices.length > 0) {
      return getLastDigit(
        prices[prices.length - 1],
        pipSize
      );
    }

    return null;
  }, [currentTick, prices, pipSize]);

  const {
    buyContract: buyWithProposal,
    isBuying,
    buyResult,
    buyError,
    clearBuyResult,
  } = useBuy(
    tradingWs,
    tradingIsConnected
  );

  const proposalParams: ProposalParams | null =
    useMemo(() => {
      if (isBuying || !activeSymbol) {
        return null;
      }

      const stakeNum = parseFloat(stake);

      if (!stakeNum || stakeNum <= 0) {
        return null;
      }

      const needsBarrier =
        contractMode !== 'DIGITEVEN' &&
        contractMode !== 'DIGITODD';

      return {
        contractType: contractMode,

        symbol:
          activeSymbol.underlying_symbol,

        amount: stakeNum,

        duration,

        durationUnit: 't',

        basis: 'stake' as const,

        currency: 'USD',

        ...(needsBarrier
          ? { barrier: selectedDigit }
          : {}),
      };
    }, [
      activeSymbol,
      contractMode,
      stake,
      duration,
      selectedDigit,
      isBuying,
    ]);

  const { proposal } = useProposal(
    tradingWs,
    tradingIsConnected,
    proposalParams
  );

  const buyContract =
    useCallback(async () => {
      if (!proposal) {
        return;
      }

      /*
       * STEP 1
       * Execute the original trade on the
       * currently authenticated Deriv account.
       */
      const masterResult =
        await buyWithProposal(proposal);

      /*
       * STEP 2
       * Notify our copy-trading endpoint only
       * after the original purchase succeeds.
       */
      try {
        const needsBarrier =
          contractMode !== 'DIGITEVEN' &&
          contractMode !== 'DIGITODD';

        const copyTradePayload = {
          symbol:
            activeSymbol?.underlying_symbol,

          contractType:
            contractMode,

          amount:
            parseFloat(stake),

          duration,

          durationUnit: 't',

          ...(needsBarrier
            ? { barrier: selectedDigit }
            : {}),
        };

        const response = await fetch(
          '/api/copy-trade',
          {
            method: 'POST',

            headers: {
              'Content-Type':
                'application/json',
            },

            body: JSON.stringify(
              copyTradePayload
            ),
          }
        );

        if (!response.ok) {
          const message =
            await response.text();

          console.error(
            'Copy trade failed:',
            message
          );
        }
      } catch (copyError) {
        /*
         * A copy failure must NOT turn a
         * successful master purchase into a
         * failed purchase.
         */
        console.error(
          'Copy trade error:',
          copyError
        );
      }

      return masterResult;
    }, [
      proposal,
      buyWithProposal,
      activeSymbol,
      contractMode,
      stake,
      duration,
      selectedDigit,
    ]);

  return {
    isConnected,

    isLoading,

    error,

    symbols,

    activeSymbol,

    selectSymbol,

    currentTick,

    lastDigit,

    digitStats,

    tradeType,

    setTradeType,

    contractMode,

    setContractMode,

    selectedDigit,

    setSelectedDigit,

    contractsAvailable,

    pipSize,

    stake,

    setStake,

    duration,

    setDuration,

    durationLimits,

    defaultStake,

    proposal,

    isProposalLoading:
      isConnected &&
      proposalParams !== null &&
      proposal === null,

    buyContract,

    isBuying,

    buyResult,

    buyError,

    clearBuyResult,

    openPositions,

    closedPositions,

    sellContract,

    sellingId,

    sellError,

    clearSellError,
  };
}
