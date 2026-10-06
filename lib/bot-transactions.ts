export interface BotTransaction {
  accountId: string;
  botId: 'master' | 'expert';
  contractId: number;
  symbol: string;
  currency: string;
  barrier: '7' | '8';
  ticks: number;
  stake: number;
  purchasedAt: number;
  settledAt?: number;
  profit?: number;
  status: 'open' | 'won' | 'lost' | 'break-even';
}
const key = (accountId: string) => `circletool.bot-transactions.v1:${accountId}`;
export function readBotTransactions(accountId: string): BotTransaction[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(key(accountId)) ?? '[]');
    if (!Array.isArray(data)) return [];
    return data.filter((x): x is BotTransaction => !!x && x.accountId === accountId && ['master','expert'].includes(x.botId) && Number.isSafeInteger(x.contractId) && x.contractId > 0 && typeof x.symbol === 'string' && typeof x.currency === 'string' && ['7','8'].includes(x.barrier) && Number.isInteger(x.ticks) && x.ticks > 0 && Number.isFinite(x.stake) && x.stake > 0 && Number.isFinite(x.purchasedAt) && ['open','won','lost','break-even'].includes(x.status) && (x.status === 'open' || (Number.isFinite(x.profit) && Number.isFinite(x.settledAt)))).slice(0,200);
  } catch { return []; }
}
export function upsertBotTransaction(rows: BotTransaction[], transaction: BotTransaction): BotTransaction[] {
  const existing = rows.find(x => x.accountId === transaction.accountId && x.contractId === transaction.contractId);
  // Late purchase messages cannot replace an already recorded settlement.
  const next = existing && existing.status !== 'open' && transaction.status === 'open' ? existing : transaction;
  return [next, ...rows.filter(x => x.accountId === transaction.accountId && x.contractId !== transaction.contractId)].sort((a,b)=>b.purchasedAt-a.purchasedAt).slice(0,200);
}
export function saveBotTransaction(transaction: BotTransaction): BotTransaction[] {
  const rows = upsertBotTransaction(readBotTransactions(transaction.accountId),transaction);
  localStorage.setItem(key(transaction.accountId),JSON.stringify(rows));
  return rows;
}
