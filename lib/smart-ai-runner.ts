import type { BotTransaction, SmartAIContractType } from './bot-transactions';

export interface SmartAISettings {
  stake: number; ticks: number; target: number; lossLimit: number;
  martingale: number; useList: boolean; stakeList: number[];
  contractType?: SmartAIContractType; prediction?: number;
}
export const SMART_AI_CONTRACTS = [
  { type: 'CALL', label: 'Rise', group: 'rise-fall' },
  { type: 'PUT', label: 'Fall', group: 'rise-fall' },
  { type: 'DIGITOVER', label: 'Over', group: 'over-under' },
  { type: 'DIGITUNDER', label: 'Under', group: 'over-under' },
  { type: 'DIGITEVEN', label: 'Even', group: 'even-odd' },
  { type: 'DIGITODD', label: 'Odd', group: 'even-odd' },
] as const;
export function smartAIContract(s: Pick<SmartAISettings, 'contractType' | 'prediction'>) {
  const contractType = s.contractType ?? 'CALL';
  const choice = SMART_AI_CONTRACTS.find(c => c.type === contractType);
  if (!choice) throw Error('Choose Rise, Fall, Over, Under, Even or Odd.');
  let barrier: string | undefined;
  if (choice.group === 'over-under') {
    const prediction = s.prediction;
    if (prediction === undefined || !Number.isInteger(prediction) || prediction < 0 || prediction > 9) throw Error('Choose a digit prediction from 0 to 9.');
    if (contractType === 'DIGITOVER' && prediction === 9) throw Error('Over prediction must be 0–8.');
    if (contractType === 'DIGITUNDER' && prediction === 0) throw Error('Under prediction must be 1–9.');
    barrier = String(prediction);
  }
  return { contractType, barrier, label: `${choice.label}${barrier === undefined ? '' : ` ${barrier}`}` };
}
export interface SmartAIProgress { message: string; trades: number; profit: number; wins: number; losses: number; nextStake: number }
interface Transport { send<T>(payload: Record<string, unknown>): Promise<T> }
interface PendingStore { get(): string | null; set(value: string): void; clear(): void }
type Contract = { contract_id?: number | string; is_sold?: number | boolean; profit?: number | string };
export function validateSmartAISettings(s: SmartAISettings) {
  if (![s.stake, s.ticks, s.target, s.lossLimit, s.martingale].every(n => Number.isFinite(n) && n > 0) || !Number.isInteger(s.ticks)) throw Error('Enter positive settings and a whole number of ticks.');
  if (s.useList && (!s.stakeList.length || !s.stakeList.every(n => Number.isFinite(n) && n > 0))) throw Error('Enter a comma-separated list of positive stakes.');
  if ((s.useList ? s.stakeList[0] : s.stake) > s.lossLimit) throw Error('The first stake must fit the session loss limit.');
}
export async function runSmartAI(input: {
  settings: SmartAISettings; ws: Transport; symbol: string; currency: string; accountId: string;
  signal: AbortSignal; isCurrent: () => boolean; pending: PendingStore;
  findTransaction: (id: number) => BotTransaction | undefined;
  onTransaction: (transaction: BotTransaction) => void;
  onProgress: (progress: SmartAIProgress) => void; refreshBalance: () => Promise<unknown>;
  requestTimeoutMs?: number; pollMs?: number; paceMs?: number; settlementTimeoutMs?: number;
}) {
  const { settings: s, ws, signal, pending } = input;
  validateSmartAISettings(s);
  const contract = smartAIContract(s);
  let trades = 0, profit = 0, wins = 0, losses = 0, stake = s.stake, listIndex = 0;
  const nextStake = () => s.useList ? s.stakeList[listIndex] : stake;
  const report = (message: string) => { const result = { message, trades, profit, wins, losses, nextStake: nextStake() ?? 0 }; input.onProgress(result); return result; };
  const active = () => !signal.aborted && input.isCurrent();
  const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
  const request = <T,>(payload: Record<string, unknown>): Promise<T> => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Deriv request timed out. Check account transactions before restarting.')), input.requestTimeoutMs ?? 15000);
    ws.send<T>(payload).then(result => { clearTimeout(timer); resolve(result); }, error => { clearTimeout(timer); reject(error); });
  });
  const closed = (contract: Contract | undefined, id: number) => {
    if (Number(contract?.contract_id) !== id) throw Error('Invalid settlement response. Check account transactions.');
    if (contract?.is_sold !== 1 && contract?.is_sold !== true) return undefined;
    if (contract.profit === undefined || contract.profit === null || contract.profit === '' || !Number.isFinite(Number(contract.profit))) throw Error('Settlement profit unavailable. Check account transactions.');
    return Number(contract.profit);
  };
  const previous = pending.get();
  if (previous) {
    if (previous === 'unknown') throw Error('A previous purchase was not confirmed. Check account transactions before restarting; no purchase will be retried.');
    const id = Number(previous);
    if (!Number.isSafeInteger(id) || id <= 0) throw Error('Invalid pending contract. Check account transactions.');
    const response = await request<{ proposal_open_contract?: Contract }>({ proposal_open_contract: 1, contract_id: id });
    const recovered = closed(response.proposal_open_contract, id);
    if (recovered === undefined) throw Error('A previous bot contract is still open. Wait for settlement before restarting.');
    const transaction = input.findTransaction(id);
    if (transaction) input.onTransaction({ ...transaction, profit: recovered, settledAt: Date.now(), status: recovered > 0 ? 'won' : recovered < 0 ? 'lost' : 'break-even' });
    pending.clear(); await input.refreshBalance();
  }
  if (!active()) return report('Stopped before purchase.');
  const portfolio = await request<{ portfolio?: { contracts: unknown[] } }>({ portfolio: 1 });
  if (!portfolio.portfolio || portfolio.portfolio.contracts.length) throw Error('Wait until existing account positions close before starting the bot.');
  while (active()) {
    if (profit >= s.target) return report('Profit target reached. Stopped.');
    const amount = nextStake();
    if (s.useList && amount === undefined) return report('Stake list exhausted. Stopped.');
    if (!Number.isFinite(amount) || amount <= 0) return report('Next stake is invalid. Stopped.');
    // Reserve the entire next stake, as in the existing native bots.
    if (profit <= -s.lossLimit || amount > s.lossLimit + profit + 0.000001) return report('Loss limit reached, or remaining allowance is below the next stake. Stopped.');
    report(`Requesting ${contract.label} quote…`);
    const quote = await request<{ proposal?: { id?: string; ask_price?: number | string } }>({ proposal: 1, amount, basis: 'stake', contract_type: contract.contractType, ...(contract.barrier === undefined ? {} : { barrier: contract.barrier }), currency: input.currency, duration: s.ticks, duration_unit: 't', underlying_symbol: input.symbol });
    if (!active()) return report('Stopped before purchase.');
    const price = Number(quote.proposal?.ask_price);
    if (!quote.proposal?.id || !Number.isFinite(price) || price <= 0 || Math.abs(price - amount) > 0.000001 || price > s.lossLimit + profit + 0.000001) throw Error('Quote does not match the stake or loss allowance. No purchase sent.');
    // Persist before sending buy: a missing confirmation must never be retried.
    report(`Purchasing ${contract.label}…`);
    if (!active()) return report('Stopped before purchase.');
    pending.set('unknown');
    const purchase = await request<{ buy?: { contract_id?: number | string } }>({ buy: quote.proposal.id, price: String(price) });
    const id = Number(purchase.buy?.contract_id);
    if (!Number.isSafeInteger(id) || id <= 0) throw Error('Purchase confirmation missing. Check account transactions before restarting.');
    pending.set(String(id));
    const transaction: BotTransaction = { accountId: input.accountId, botId: 'smart', contractType: contract.contractType, contractId: id, symbol: input.symbol, currency: input.currency, barrier: contract.barrier ?? '', ticks: s.ticks, stake: price, purchasedAt: Date.now(), status: 'open' };
    input.onTransaction(transaction); report(`Contract ${id} open. Waiting for settlement…`);
    const deadline = Date.now() + (input.settlementTimeoutMs ?? 180000);
    let pnl: number | undefined;
    while (Date.now() < deadline) {
      // Stop finishes tracking the sent trade; account changes end tracking.
      if (!input.isCurrent()) return report(`Tracking stopped for contract ${id}. Reconnect to reconcile it before restarting.`);
      const response = await request<{ proposal_open_contract?: Contract }>({ proposal_open_contract: 1, contract_id: id });
      pnl = closed(response.proposal_open_contract, id);
      if (pnl !== undefined) break;
      await delay(input.pollMs ?? 1200);
    }
    if (pnl === undefined) throw Error('Settlement timed out. Reconcile the pending contract before restarting.');
    input.onTransaction({ ...transaction, profit: pnl, settledAt: Date.now(), status: pnl > 0 ? 'won' : pnl < 0 ? 'lost' : 'break-even' });
    pending.clear();
    profit = Math.round((profit + pnl) * 100) / 100; trades++;
    if (pnl > 0) { wins++; stake = s.stake; listIndex = 0; }
    else { if (pnl < 0) losses++; stake = Math.round(stake * s.martingale * 100) / 100; listIndex++; }
    report(`Contract settled: ${pnl.toFixed(2)} ${input.currency}.`);
    await input.refreshBalance();
    if (!active()) return report('Stopped. No further purchases.');
    if (profit >= s.target) return report('Profit target reached. Stopped.');
    await delay(input.paceMs ?? 1000);
  }
  return report('Stopped. No further purchases.');
}
