import type { BotTransaction, SmartAIContractType } from './bot-transactions';

export interface SmartAISettings {
  stake: number; ticks: number; target: number; lossLimit: number;
  martingale: number; useList: boolean; stakeList: number[];
  contractType?: SmartAIContractType; prediction?: number;
  switchAfterTwoLosses?: boolean;
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
export interface SmartAIProgress { message: string; trades: number; profit: number; wins: number; losses: number; nextStake: number; activeContract?: string; consecutiveLosses?: number }
interface Transport { send<T>(payload: Record<string, unknown>): Promise<T> }
export interface PendingStore { get(): string | null; set(value: string): void; clear(): void }
type Contract = { contract_id?: number | string; is_sold?: number | boolean; profit?: number | string };
// Smart AI only: preserve an attempt identifier across a timeout/reload.
// Never associate a different account's or bot's late response with this attempt.
interface PurchaseAttempt { token: string; transaction: Omit<BotTransaction, 'contractId'> }
export function readSmartAIAttempt(value: string | null): PurchaseAttempt | undefined {
  try {
    const parsed = JSON.parse(value ?? 'null');
    if (typeof parsed?.token === 'string' && parsed.token && parsed.transaction?.botId === 'smart') return parsed;
  } catch { /* Old versions stored the literal "unknown". */ }
  return undefined;
}
const definitiveRejections = ['InsufficientBalance', 'InvalidContractProposal', 'PriceMoved', 'ContractCreationFailure', 'InvalidOfferings'];
export function captureSmartAIConfirmation(message: Record<string, unknown>, pending: PendingStore, onTransaction: (t: BotTransaction) => void) {
  const attempt = readSmartAIAttempt(pending.get());
  const echo = message.echo_req as { passthrough?: { smart_ai_attempt?: string } } | undefined;
  if (!attempt || echo?.passthrough?.smart_ai_attempt !== attempt.token) return false;
  const rejection = message.error as { code?: string } | undefined;
  if (rejection) {
    if (rejection.code && definitiveRejections.includes(rejection.code)) pending.clear();
    return false;
  }
  const id = Number((message.buy as { contract_id?: unknown } | undefined)?.contract_id);
  if (!Number.isSafeInteger(id) || id <= 0) return false;
  pending.set(String(id));
  onTransaction({ ...attempt.transaction, contractId: id });
  return true;
}
export function smartAIHasUnknownPurchase(value: string | null) {
  return value === 'unknown' || !!readSmartAIAttempt(value);
}
export async function checkSmartAIHistory(ws: Transport) {
  const [open, closed] = await Promise.all([
    ws.send<{ portfolio?: { contracts?: { contract_id: number }[] } }>({ portfolio: 1 }),
    ws.send<{ profit_table?: { transactions?: { contract_id: number }[] } }>({ profit_table: 1, sort: 'DESC', limit: 20 }),
  ]);
  if (!Array.isArray(open.portfolio?.contracts) || !Array.isArray(closed.profit_table?.transactions)) throw Error('Deriv history could not be verified. Purchase remains locked.');
  const ids = [...open.portfolio.contracts, ...closed.profit_table.transactions].map(c => Number(c.contract_id)).filter(id => Number.isSafeInteger(id) && id > 0);
  return { openCount: open.portfolio.contracts.length, ids: [...new Set(ids)] };
}
export function validateSmartAISettings(s: SmartAISettings) {
  if (![s.stake, s.ticks, s.target, s.lossLimit, s.martingale].every(n => Number.isFinite(n) && n > 0) || !Number.isInteger(s.ticks)) throw Error('Enter positive settings and a whole number of ticks.');
  if (s.useList && (!s.stakeList.length || !s.stakeList.every(n => Number.isFinite(n) && n > 0))) throw Error('Enter a comma-separated list of positive stakes.');
  if ((s.useList ? s.stakeList[0] : s.stake) > s.lossLimit) throw Error('The first stake must fit the session loss limit.');
}
export async function runSmartAI(input: {
  settings: SmartAISettings; ws: Transport; symbol: string; currency: string; accountId: string; accountType: 'real' | 'demo';
  signal: AbortSignal; isCurrent: () => boolean; pending: PendingStore;
  findTransaction: (id: number) => BotTransaction | undefined;
  onTransaction: (transaction: BotTransaction) => void;
  onProgress: (progress: SmartAIProgress) => void; refreshBalance: () => Promise<unknown>;
  recoverPurchases?: boolean; requestTimeoutMs?: number; pollMs?: number; paceMs?: number; settlementTimeoutMs?: number;
}) {
  const { settings: s, ws, signal, pending } = input;
  if (input.accountType !== 'real') throw Error('Bots require a real account. Demo accounts are not supported.');
  validateSmartAISettings(s);
  let contract = smartAIContract(s.switchAfterTwoLosses ? { contractType: 'DIGITUNDER', prediction: 7 } : s);
  let consecutiveLosses = 0;
  let trades = 0, profit = 0, wins = 0, losses = 0, stake = s.stake, listIndex = 0;
  const nextStake = () => s.useList ? s.stakeList[listIndex] : stake;
  const report = (message: string) => { const result = { message, trades, profit, wins, losses, nextStake: nextStake() ?? 0, activeContract: contract.label, consecutiveLosses }; input.onProgress(result); return result; };
  const active = () => !signal.aborted && input.isCurrent();
  const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
  const request = <T,>(payload: Record<string, unknown>, transport: Transport = ws): Promise<T> => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Deriv request timed out. Check account transactions before restarting.')), input.requestTimeoutMs ?? 15000);
    transport.send<T>(payload).then(result => { clearTimeout(timer); resolve(result); }, error => { clearTimeout(timer); reject(error); });
  });
  const closed = (contract: Contract | undefined, id: number) => {
    if (Number(contract?.contract_id) !== id) throw Error('Invalid settlement response. Check account transactions.');
    if (contract?.is_sold !== 1 && contract?.is_sold !== true) return undefined;
    if (contract.profit === undefined || contract.profit === null || contract.profit === '' || !Number.isFinite(Number(contract.profit))) throw Error('Settlement profit unavailable. Check account transactions.');
    return Number(contract.profit);
  };
  let previous = pending.get();
  if (previous) {
    if (smartAIHasUnknownPurchase(previous)) {
      if (!input.recoverPurchases) throw Error('A previous buy has no confirmed contract ID. Verify the transaction in Deriv history before restarting. Smart AI remains stopped to prevent a duplicate purchase.');
      report('Checking previous purchase against Deriv history…');
      const history = await checkSmartAIHistory({ send: request });
      // A late confirmation may have resolved the attempt while history loaded.
      previous = pending.get();
      if (smartAIHasUnknownPurchase(previous)) throw Error(`Purchase needs verification. Deriv history checked: ${history.openCount} open position(s). Use Recover previous purchase below to verify the contract or confirm no purchase occurred.`);
      if (!previous) return report('Deriv confirmed the purchase was rejected. Press Start to begin again.');
    }
    const id = Number(previous);
    if (!Number.isSafeInteger(id) || id <= 0) throw Error('Invalid pending contract. Check account transactions.');
    // A confirmed contract ID can be queried again safely; this never repeats a buy.
    let response: { proposal_open_contract?: Contract } | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await request<{ proposal_open_contract?: Contract }>({ proposal_open_contract: 1, contract_id: id });
        break;
      } catch (error) {
        if (!active()) throw error;
        if (attempt === 2) throw Error('Could not verify previous contract with Deriv. Bot stopped; no new purchase sent.');
        await delay(500 * (attempt + 1));
      }
    }
    const recovered = closed(response?.proposal_open_contract, id);
    if (recovered === undefined) throw Error('A previous bot contract is still open. Wait for settlement before restarting.');
    const transaction = input.findTransaction(id);
    if (transaction) input.onTransaction({ ...transaction, profit: recovered, settledAt: Date.now(), status: recovered > 0 ? 'won' : recovered < 0 ? 'lost' : 'break-even' });
    pending.clear();
    try { await input.refreshBalance(); } catch { report('Previous contract reconciled; balance refresh failed. Checking live balance before any new purchase.'); }
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
    // Never attempt a purchase that exceeds the live real-account balance.
    // A failed or unavailable balance check stops trading rather than guessing.
    const balanceReply = await request<{ balance?: { balance?: number | string; currency?: string; loginid?: string } }>({ balance: 1 });
    const available = Number(balanceReply.balance?.balance);
    if (!Number.isFinite(available) || available < 0 || (balanceReply.balance?.currency && balanceReply.balance.currency !== input.currency) || (balanceReply.balance?.loginid && balanceReply.balance.loginid !== input.accountId))
      return report('Account balance could not be verified. Bot stopped.');
    if (amount > available + 0.000001)
      return report(`Next stake ${amount.toFixed(2)} ${input.currency} exceeds available balance ${available.toFixed(2)} ${input.currency}. Bot stopped.`);
    report(`Requesting ${contract.label} quote…`);
    const quote = await request<{ proposal?: { id?: string; ask_price?: number | string } }>({ proposal: 1, amount, basis: 'stake', contract_type: contract.contractType, ...(contract.barrier === undefined ? {} : { barrier: contract.barrier }), currency: input.currency, duration: s.ticks, duration_unit: 't', underlying_symbol: input.symbol });
    if (!active()) return report('Stopped before purchase.');
    const price = Number(quote.proposal?.ask_price);
    if (!quote.proposal?.id || !Number.isFinite(price) || price <= 0 || Math.abs(price - amount) > 0.000001 || price > s.lossLimit + profit + 0.000001) throw Error('Quote does not match the stake or loss allowance. No purchase sent.');
    // Confirm the quoted price against the balance immediately before buying.
    // Quote requests can take time, and account funds may change in between.
    const latestReply = await request<{ balance?: { balance?: number | string; currency?: string; loginid?: string } }>({ balance: 1 });
    const latestBalance = Number(latestReply.balance?.balance);
    if (!Number.isFinite(latestBalance) || latestBalance < 0 || (latestReply.balance?.currency && latestReply.balance.currency !== input.currency) || (latestReply.balance?.loginid && latestReply.balance.loginid !== input.accountId))
      return report('Account balance could not be verified. Bot stopped.');
    if (!active()) return report('Stopped before purchase.');
    if (price > latestBalance + 0.000001)
      return report(`Next stake ${price.toFixed(2)} ${input.currency} exceeds available balance ${latestBalance.toFixed(2)} ${input.currency}. Bot stopped.`);
    // Persist before sending buy: a missing confirmation must never be retried.
    report(`Purchasing ${contract.label}…`);
    if (!active()) return report('Stopped before purchase.');
    const transactionBase: Omit<BotTransaction, 'contractId'> = { accountId: input.accountId, botId: 'smart', contractType: contract.contractType, symbol: input.symbol, currency: input.currency, barrier: contract.barrier ?? '', ticks: s.ticks, stake: price, purchasedAt: Date.now(), status: 'open' };
    const attempt = input.recoverPurchases ? { token: crypto.randomUUID(), transaction: transactionBase } : undefined;
    pending.set(attempt ? JSON.stringify(attempt) : 'unknown');
    const purchaseTransport = { send: <T,>(payload: Record<string, unknown>): Promise<T> => ws.send<T>(payload).then(result => {
      if (attempt) captureSmartAIConfirmation({ ...result as Record<string, unknown>, echo_req: payload }, pending, input.onTransaction);
      return result;
    }) };
    let purchase: { buy?: { contract_id?: number | string } };
    try {
      const payload = { buy: quote.proposal.id, price: String(price), ...(attempt ? { passthrough: { smart_ai_attempt: attempt.token } } : {}) };
      // Capture the underlying promise even when the runner's timeout has fired.
      purchase = await request<{ buy?: { contract_id?: number | string } }>(payload, purchaseTransport);
    } catch (error) {
      // Only a definitive broker rejection can safely unlock this attempt.
      // Timeouts, disconnects, and missing confirmations remain locked.
      const code = (error as { code?: string })?.code;
      if (typeof code === 'string' && definitiveRejections.includes(code)) {
        pending.clear();
        return report(`Purchase rejected by Deriv (${code}). Bot stopped.`);
      }
      throw error;
    }
    const id = Number(purchase.buy?.contract_id);
    if (!Number.isSafeInteger(id) || id <= 0) throw Error('Purchase confirmation missing. Check account transactions before restarting.');
    pending.set(String(id));
    const transaction: BotTransaction = { accountId: input.accountId, botId: s.switchAfterTwoLosses ? 'scanner' : 'smart', contractType: contract.contractType, contractId: id, symbol: input.symbol, currency: input.currency, barrier: contract.barrier ?? '', ticks: s.ticks, stake: price, purchasedAt: Date.now(), status: 'open' };
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
    if (s.switchAfterTwoLosses) {
      consecutiveLosses = pnl < 0 ? consecutiveLosses + 1 : 0;
      if (consecutiveLosses === 2) {
        contract = smartAIContract(contract.contractType === 'DIGITUNDER'
          ? { contractType: 'DIGITOVER', prediction: 2 }
          : { contractType: 'DIGITUNDER', prediction: 7 });
        consecutiveLosses = 0;
      }
    }
    report(`Contract settled: ${pnl.toFixed(2)} ${input.currency}.${s.switchAfterTwoLosses ? ` Next: ${contract.label} · consecutive losses ${consecutiveLosses}/2.` : ''}`);
    try { await input.refreshBalance(); } catch { report('Balance refresh failed; next trade requires a fresh verified balance.'); }
    if (!active()) return report('Stopped. No further purchases.');
    if (profit >= s.target) return report('Profit target reached. Stopped.');
    await delay(input.paceMs ?? 1000);
  }
  return report('Stopped. No further purchases.');
}
