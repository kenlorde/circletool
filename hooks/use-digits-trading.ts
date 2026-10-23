'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useProposal, useBuy } from '@deriv/core';

import type {
  ActiveSymbol,
  Tick,
  ProposalInfo,
  ProposalParams,
  DurationLimits,
  BuyResult,
  ProposalResponse,
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

  modeProposals: Partial<Record<ContractMode, ProposalInfo | null>>;
  buyContract: (mode?: ContractMode) => Promise<void>;
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
> & { isRealAccount?: boolean };

export function useDigitsTrading({
  ws,
  isConnected,
  isExhausted,
  isAuthenticated,
  isRealAccount = false,
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
    useState<TradeType>('over-under');

  const [contractMode, setContractMode] =
    useState<ContractMode>('DIGITOVER');

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

  const realAccount = useRef(isAuthenticated && isRealAccount);
  realAccount.current = isAuthenticated && isRealAccount;
  const {
    buyContract: buyWithProposal,
    isBuying,
    buyResult,
    buyError,
    clearBuyResult,
  } = useBuy(
    tradingWs,
    tradingIsConnected,
    () => { if (!realAccount.current) throw new Error('Please log in to your real account to trade. Demo trading is disabled.'); }
  );

  const proposalParams: ProposalParams | null =
    useMemo(() => {
      if (!activeSymbol) {
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
    ]);

  const { proposal, updateProposal: updateSelected } = useProposal(
    tradingWs,
    tradingIsConnected,
    proposalParams
  );

  const modePair: Record<TradeType, [ContractMode, ContractMode]> = {
    'over-under': ['DIGITOVER', 'DIGITUNDER'],
    'even-odd': ['DIGITEVEN', 'DIGITODD'],
    'matches-differs': ['DIGITMATCH', 'DIGITDIFF'],
  };
  const [firstMode, secondMode] = modePair[tradeType];
  const { proposal: firstProposal, refresh: refreshFirst, updateProposal: updateFirst } = useProposal(tradingWs, tradingIsConnected,
    proposalParams ? { ...proposalParams, contractType: firstMode } : null);
  const { proposal: secondProposal, refresh: refreshSecond, updateProposal: updateSecond } = useProposal(tradingWs, tradingIsConnected,
    proposalParams ? { ...proposalParams, contractType: secondMode } : null);
  // Prepare the next quotes after broker confirmation, outside the next tap's
  // critical path. Both directions refresh in parallel; no purchase is retried.
  useEffect(() => {
    if (!buyResult) return;
    refreshFirst?.();
    refreshSecond?.();
  }, [buyResult?.contractId, refreshFirst, refreshSecond]);

  // Direction buttons select a mode and purchase it in the same tap. The
  // explicit purchase mode is authoritative; that selection must not invalidate
  // its own quote request. All other settings and the account socket still lock.
  const settingsKey = JSON.stringify([
    proposalParams ? { ...proposalParams, contractType: undefined } : null,
    tradeType, isAuthenticated,
  ]);
  const currentSettings = useRef({ key: settingsKey, mode: contractMode, ws: tradingWs, connected: tradingIsConnected });
  currentSettings.current = { key: settingsKey, mode: contractMode, ws: tradingWs, connected: tradingIsConnected };
  const purchaseLock = useRef(false);
  const consumedQuoteIds = useRef(new Set<string>());
  const modeProposals = { [firstMode]: firstProposal, [secondMode]: secondProposal };
  const buyContract = useCallback(async (mode?: ContractMode) => {
    const quote = mode === firstMode ? firstProposal : mode === secondMode ? secondProposal : mode ? null : proposal;
    if (!quote || !proposalParams || !tradingWs || !tradingIsConnected || !isAuthenticated || isBuying || purchaseLock.current) return;
    purchaseLock.current = true;
    try {
      const requestKey = settingsKey;
      const requestWs = tradingWs;
      const requestedMode = mode ?? contractMode;
      const assertCurrentSettings = () => {
        const current = currentSettings.current;
        if (current.key !== requestKey || current.ws !== requestWs || !current.connected ||
            (!mode && current.mode !== requestedMode)) {
          throw new Error('Trade settings or connection changed. Review the quote and tap Buy again.');
        }
      };
      const consume = (id: string) => {
        consumedQuoteIds.current.add(id);
        if (consumedQuoteIds.current.size > 100) {
          const oldest = consumedQuoteIds.current.values().next().value;
          if (oldest) consumedQuoteIds.current.delete(oldest);
        }
      };
      assertCurrentSettings();
      const age = quote.receivedAt === undefined ? Infinity : Date.now() - quote.receivedAt;
      if (age >= 0 && age <= 5000 && !consumedQuoteIds.current.has(quote.id)) {
        consume(quote.id);
        await buyWithProposal(quote);
        return;
      }
      await buyWithProposal(quote, async () => {
        const response = await requestWs.send<ProposalResponse>({
          proposal: 1,
          amount: proposalParams.amount,
          basis: proposalParams.basis,
          contract_type: requestedMode,
          currency: proposalParams.currency,
          underlying_symbol: proposalParams.symbol,
          duration: proposalParams.duration,
          duration_unit: proposalParams.durationUnit,
          ...(!['DIGITEVEN', 'DIGITODD'].includes(requestedMode) ? { barrier: selectedDigit } : {}),
        });
        assertCurrentSettings();
        const fresh = response.proposal;
        if (!fresh) throw new Error('No fresh purchase quote returned.');
        const freshQuote: ProposalInfo = {
          receivedAt: Date.now(),
          id: fresh.id, askPrice: Number(fresh.ask_price), payout: Number(fresh.payout),
          longcode: fresh.longcode,
          minStake: Number(fresh.validation_params?.stake?.min ?? 0),
          maxPayout: Number(fresh.validation_params?.payout?.max ?? 0),
        };
        if (!freshQuote.id || !Number.isFinite(freshQuote.askPrice) || freshQuote.askPrice <= 0 ||
            !Number.isFinite(freshQuote.payout) || freshQuote.payout <= 0) {
          throw new Error('No valid purchase quote returned.');
        }
        // Refresh the displayed payout for the requested direction before buying.
        // The purchase still uses that exact quote ID and the original stake cap.
        if (requestedMode === firstMode) updateFirst(freshQuote);
        if (requestedMode === secondMode) updateSecond(freshQuote);
        if (requestedMode === contractMode) updateSelected(freshQuote);
        consume(freshQuote.id);
        return freshQuote;
      });
    } finally {
      purchaseLock.current = false;
    }
  }, [firstMode, secondMode, firstProposal, secondProposal, proposal, tradingIsConnected, isBuying, buyWithProposal, proposalParams, tradingWs, isAuthenticated, settingsKey, contractMode, selectedDigit, updateSelected, updateFirst, updateSecond]);

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

    modeProposals,

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
