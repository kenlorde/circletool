import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
const source = await readFile(new URL('../components/smart-ai-bot.tsx', import.meta.url), 'utf8');
const startSource = stripTypeScriptTypes(source.slice(source.indexOf('  async function start()'), source.indexOf('  return <section')));
function bot(barrier, sessionLock, send, storage = new Map()) {
  const calls = [], state = [];
  const context = { barrier, sessionLock, anotherBotRunning: false, lock: { current: false }, running: { current: false }, mounted: { current: true },
    ws: { isConnected: true, async send(p) { calls.push(p); return send(p); } }, isConnected: true, auth: { authState: 'authenticated' }, accountId: 'test-account',
    market: { activeSymbol: { underlying_symbol: '1HZ100V' } }, currency: 'USD', stake: '0.35', ticks: '1', target: '0.1', limit: '1',
    localStorage: { getItem: k => storage.get(k), setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) },
    balanceSync: { async refresh() { return true; } }, onRunStateChange: v => state.push(v), setMessage() {}, setBusy() {}, setProfit() {}, setTrades() {},
    setTimeout(fn) { fn(); }, console };
  vm.createContext(context); vm.runInContext(startSource, context);
  return { context, calls, state, start: () => vm.runInContext('start()', context) };
}
const reply = p => p.portfolio ? { portfolio: { contracts: [] } } : p.proposal ? { proposal: { id: 'q', ask_price: .35 } } : p.buy ? { buy: { contract_id: 123 } } : { proposal_open_contract: { is_sold: 1, profit: .1 } };
test('Master and Expert send Under 7/8 and release the shared lock after settlement', async () => {
  const shared = { current: false };
  for (const barrier of ['7','8']) {
    const b = bot(barrier, shared, async p => reply(p)); await b.start();
    assert.equal(b.calls.find(p => p.proposal).barrier, barrier);
    assert.equal(b.calls.find(p => p.proposal).contract_type, 'DIGITUNDER');
    assert.equal(b.calls.filter(p => p.buy).length, 1); assert.deepEqual(b.state,[true,false]); assert.equal(shared.current,false);
  }
});
test('another bot cannot purchase while the first bot is awaiting its quote', async () => {
  const shared = { current: false }; let resolveQuote;
  const first = bot('7',shared,p => p.proposal ? new Promise(resolve => { resolveQuote=resolve; }) : Promise.resolve(reply(p)));
  const task=first.start(); while(!resolveQuote) await Promise.resolve();
  const second=bot('8',shared,async p=>reply(p)); await second.start(); assert.equal(second.calls.length,0);
  resolveQuote(reply({proposal:1})); await task; assert.equal(shared.current,false);
  await second.start(); assert.equal(second.calls.find(p=>p.proposal).barrier,'8');
});
test('unknown purchase lock is respected by Expert and prevents another purchase',async()=>{
  const shared={current:false},storage=new Map([['circletool-under7-pending:test-account','unknown']]);
  const b=bot('8',shared,async p=>reply(p),storage);await b.start();assert.equal(b.calls.length,0);assert.equal(shared.current,false);
});
