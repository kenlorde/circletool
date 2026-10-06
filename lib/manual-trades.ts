import type { TradeType } from './types';

export const ADVANCED_TYPES = [
  {
    "value": "rise-fall",
    "group": "Ups & Downs",
    "label": "Rise / Fall",
    "contracts": [
      "CALL",
      "PUT"
    ],
    "directions": [
      "Rise",
      "Fall"
    ],
    "mode": "spot"
  },
  {
    "value": "rise-fall-equal",
    "group": "Ups & Downs",
    "label": "Rise / Fall (Allow equals)",
    "contracts": [
      "CALLE",
      "PUTE"
    ],
    "directions": [
      "Rise or equal",
      "Fall or equal"
    ],
    "mode": "spot"
  },
  {
    "value": "higher-lower",
    "group": "Ups & Downs",
    "label": "Higher / Lower",
    "contracts": [
      "HIGHER",
      "LOWER"
    ],
    "directions": [
      "Higher",
      "Lower"
    ],
    "mode": "barrier"
  },
  {
    "value": "touch-no-touch",
    "group": "Touch & No Touch",
    "label": "Touch / No Touch",
    "contracts": [
      "ONETOUCH",
      "NOTOUCH"
    ],
    "directions": [
      "Touch",
      "No Touch"
    ],
    "mode": "barrier"
  },
  {
    "value": "ends-between-outside",
    "group": "In & Out",
    "label": "Ends Between / Outside",
    "contracts": [
      "EXPIRYRANGE",
      "EXPIRYMISS"
    ],
    "directions": [
      "Ends Between",
      "Ends Outside"
    ],
    "mode": "range"
  },
  {
    "value": "ends-between-outside-equal",
    "group": "In & Out",
    "label": "Ends Between / Outside (Allow equals)",
    "contracts": [
      "EXPIRYRANGEE",
      "EXPIRYMISSE"
    ],
    "directions": [
      "Ends Between or equal",
      "Ends Outside or equal"
    ],
    "mode": "range"
  },
  {
    "value": "stays-between-outside",
    "group": "In & Out",
    "label": "Stays Between / Goes Outside",
    "contracts": [
      "RANGE",
      "UPORDOWN"
    ],
    "directions": [
      "Stays Between",
      "Goes Outside"
    ],
    "mode": "range"
  },
  {
    "value": "asian",
    "group": "Asian",
    "label": "Asian Up / Down",
    "contracts": [
      "ASIANU",
      "ASIAND"
    ],
    "directions": [
      "Asian Up",
      "Asian Down"
    ],
    "mode": "none"
  },
  {
    "value": "only-ups-downs",
    "group": "Tick trades",
    "label": "Only Ups / Only Downs",
    "contracts": [
      "RUNHIGH",
      "RUNLOW"
    ],
    "directions": [
      "Only Ups",
      "Only Downs"
    ],
    "mode": "none"
  },
  {
    "value": "highest-lowest-tick",
    "group": "Tick trades",
    "label": "Highest / Lowest Tick",
    "contracts": [
      "TICKHIGH",
      "TICKLOW"
    ],
    "directions": [
      "Highest Tick",
      "Lowest Tick"
    ],
    "mode": "tick"
  },
  {
    "value": "reset-call-put",
    "group": "Reset",
    "label": "Reset Call / Put",
    "contracts": [
      "RESETCALL",
      "RESETPUT"
    ],
    "directions": [
      "Reset Call",
      "Reset Put"
    ],
    "mode": "none"
  },
  {
    "value": "accumulators",
    "group": "Accumulators",
    "label": "Accumulators",
    "contracts": [
      "ACCU"
    ],
    "directions": [
      "Accumulator"
    ],
    "mode": "accumulator"
  },
  {
    "value": "multipliers",
    "group": "Multipliers",
    "label": "Multipliers",
    "contracts": [
      "MULTUP",
      "MULTDOWN"
    ],
    "directions": [
      "Up",
      "Down"
    ],
    "mode": "multiplier"
  },
  {
    "value": "turbos",
    "group": "Turbos",
    "label": "Turbos",
    "contracts": [
      "TURBOSLONG",
      "TURBOSSHORT"
    ],
    "directions": [
      "Up",
      "Down"
    ],
    "mode": "turbo"
  },
  {
    "value": "vanillas",
    "group": "Vanillas",
    "label": "Call / Put",
    "contracts": [
      "VANILLALONGCALL",
      "VANILLALONGPUT"
    ],
    "directions": [
      "Call",
      "Put"
    ],
    "mode": "barrier"
  }
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
  barrier2?: string; growthRate?: string; selectedTick?: string;
}
export function buildManualProposal(settings: ManualSettings, contractType: string): Record<string, unknown> {
  const definition = ADVANCED_TYPES.find(type => type.value === settings.type)!;
  if (!(definition.contracts as readonly string[]).includes(contractType)) throw new Error('Invalid contract direction.');
  if (!settings.symbol || !Number.isFinite(Number(settings.amount)) || Number(settings.amount) <= 0) throw new Error('Enter a positive stake and select a market.');
  const payload: Record<string, unknown> = { proposal: 1, amount: Number(settings.amount), basis: 'stake', currency: settings.currency, contract_type: contractType, underlying_symbol: settings.symbol };
  if (definition.mode === 'multiplier' || definition.mode === 'accumulator') {
    if (definition.mode === 'accumulator') {
      const rate = Number(settings.growthRate);
      if (![1, 2, 3, 4, 5].includes(rate)) throw new Error('Choose a growth rate from 1% to 5%.');
      payload.growth_rate = rate / 100;
    } else {
    if (!Number.isInteger(Number(settings.multiplier)) || Number(settings.multiplier) <= 0) throw new Error('Enter a positive multiplier.');
    payload.multiplier = Number(settings.multiplier);
    }
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
    if (definition.mode === 'turbo') {
      if (!Number.isFinite(Number(settings.payoutPerPoint)) || Number(settings.payoutPerPoint) <= 0) throw new Error('Enter a positive payout per point.');
      payload.payout_per_point = Number(settings.payoutPerPoint);
    } else if (definition.mode === 'barrier' || definition.mode === 'range') {
      if (!/^[+-]?[0-9]+\.?[0-9]*$/.test(settings.barrier)) throw new Error('Enter a barrier price or relative offset, such as +0.10.');
      payload.barrier = settings.barrier;
      if (definition.mode === 'range') {
        if (!/^[+-]?[0-9]+\.?[0-9]*$/.test(settings.barrier2 ?? '')) throw new Error('Enter the lower barrier.');
        if (Number(settings.barrier) <= Number(settings.barrier2)) throw new Error('The upper barrier must exceed the lower barrier.');
        payload.barrier2 = settings.barrier2;
      }
    }
  }
  if (definition.mode === 'tick') {
    const tick = Number(settings.selectedTick);
    if (!Number.isInteger(tick) || tick < 1 || tick > 5) throw new Error('Select tick 1 to 5.');
    payload.selected_tick = tick;
  }
  return payload;
}
