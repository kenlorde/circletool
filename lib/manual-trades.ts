import type { TradeType } from './types';

export const ADVANCED_TYPES = [
  { value: 'higher-lower', group: 'Ups & Downs', label: 'Higher / Lower', contracts: ['CALL', 'PUT'], directions: ['Higher', 'Lower'] },
  { value: 'touch-no-touch', group: 'Touch & No Touch', label: 'Touch / No Touch', contracts: ['ONETOUCH', 'NOTOUCH'], directions: ['Touch', 'No Touch'] },
  { value: 'multipliers', group: 'Multipliers', label: 'Multipliers', contracts: ['MULTUP', 'MULTDOWN'], directions: ['Up', 'Down'] },
  { value: 'turbos', group: 'Turbos', label: 'Turbos', contracts: ['TURBOSLONG', 'TURBOSSHORT'], directions: ['Up', 'Down'] },
  { value: 'vanillas', group: 'Vanillas', label: 'Call / Put', contracts: ['VANILLALONGCALL', 'VANILLALONGPUT'], directions: ['Call', 'Put'] },
] as const;
export type AdvancedTradeType = typeof ADVANCED_TYPES[number]['value'];
export type ManualTradeType = TradeType | AdvancedTradeType;
export const DIGIT_TYPES: { value: TradeType; label: string }[] = [
  { value: 'matches-differs', label: 'Matches / Differs' },
  { value: 'over-under', label: 'Over / Under' },
  { value: 'even-odd', label: 'Even / Odd' },
];
export const isAdvancedTrade = (value: string): value is AdvancedTradeType => ADVANCED_TYPES.some(type => type.value === value);

export interface ManualSettings {
  type: AdvancedTradeType; symbol: string; currency: string; amount: string;
  duration: string; unit: string; barrier: string; multiplier: string;
  payoutPerPoint: string; stopLoss: string; takeProfit: string;
}
export function buildManualProposal(settings: ManualSettings, contractType: string): Record<string, unknown> {
  const definition = ADVANCED_TYPES.find(type => type.value === settings.type)!;
  if (!(definition.contracts as readonly string[]).includes(contractType)) throw new Error('Invalid contract direction.');
  if (!settings.symbol || !Number.isFinite(Number(settings.amount)) || Number(settings.amount) <= 0) throw new Error('Enter a positive stake and select a market.');
  const payload: Record<string, unknown> = { proposal: 1, amount: Number(settings.amount), basis: 'stake', currency: settings.currency, contract_type: contractType, underlying_symbol: settings.symbol };
  if (settings.type === 'multipliers') {
    if (!Number.isInteger(Number(settings.multiplier)) || Number(settings.multiplier) <= 0) throw new Error('Enter a positive multiplier.');
    payload.multiplier = Number(settings.multiplier);
    const limits: Record<string, number> = {};
    for (const [key, value] of [['stop_loss', settings.stopLoss], ['take_profit', settings.takeProfit]]) {
      if (!value) continue;
      if (!Number.isFinite(Number(value)) || Number(value) <= 0) throw new Error('Stop loss and take profit must be positive amounts.');
      limits[key] = Number(value);
    }
    if (Object.keys(limits).length) payload.limit_order = limits;
  } else {
    if (!Number.isInteger(Number(settings.duration)) || Number(settings.duration) <= 0) throw new Error('Enter a positive whole-number duration.');
    if (!['t', 's', 'm', 'h', 'd'].includes(settings.unit)) throw new Error('Invalid duration unit.');
    payload.duration = Number(settings.duration);
    payload.duration_unit = settings.unit;
    if (settings.type === 'turbos') {
      if (!Number.isFinite(Number(settings.payoutPerPoint)) || Number(settings.payoutPerPoint) <= 0) throw new Error('Enter a positive payout per point.');
      payload.payout_per_point = Number(settings.payoutPerPoint);
    } else {
      if (!/^[+-]?[0-9]+\.?[0-9]*$/.test(settings.barrier)) throw new Error('Enter a barrier price or relative offset, such as +0.10.');
      payload.barrier = settings.barrier;
    }
  }
  return payload;
}
