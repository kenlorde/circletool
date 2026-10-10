import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const source = await readFile(new URL('../lib/smart-ai-runner.ts', import.meta.url), 'utf8');
const { runSmartAI } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`);
const settings = { stake: 1, ticks: 1, target: 0.5, lossLimit: 10, martingale: 2, useList: false, stakeList: [0.35, 0.43, 0.85] };
function fixture(profits = [0.5]) {
  const calls = [], transactions = [], controller = new AbortController();
  let pending = null, buys = 0, amount = 0;
  const ws = { async send(payload) {
    calls.push(payload);
    if (payload.portfolio) return { portfolio: { contracts: [] } };
    if (payload.proposal) { amount = payload.amount; return { proposal: { id: `q-${buys + 1}`, ask_price: amount } }; }
    if (payload.buy) { buys++; return { buy: { contract_id: buys } }; }
    return { proposal_open_contract: { contract_id: payload.contract_id, is_sold: 1, profit: profits[buys - 1] ?? 0.5 } };
  } };
  const input = { settings, ws, symbol: 'R_10', currency: 'USD', accountId: 'VRTC1', signal: controller.signal, isCurrent: () => true,
    pending: { get: () => pending, set: value => { pending = value; }, clear: () => { pending = null; } },
    findTransaction: id => transactions.find(t => t.contractId === id), onTransaction: t => transactions.push(t),
    onProgress: () => {}, refreshBalance: async () => {}, requestTimeoutMs: 30, pollMs: 0, paceMs: 0,
  };
  return { input, calls, transactions, controller, pending: () => pending };
}
test('Rise buys use fresh proposals, settle in sequence, and stop at profit target', async () => {
  const f = fixture([0.25, 0.25]); const result = await runSmartAI(f.input);
  assert.equal(result.trades, 2); assert.equal(result.profit, 0.5); assert.equal(f.pending(), null);
  assert.deepEqual(f.calls.map(p => p.portfolio ? 'portfolio' : p.proposal ? 'quote' : p.buy ? 'buy' : 'settle'), ['portfolio', 'quote', 'buy', 'settle', 'quote', 'buy', 'settle']);
  for (const p of f.calls.filter(p => p.proposal)) { assert.equal(p.contract_type, 'CALL'); assert.equal(p.underlying_symbol, 'R_10'); assert.equal(p.duration_unit, 't'); assert.equal(p.barrier, undefined); }
  assert.deepEqual(f.transactions.map(t => t.status), ['open', 'won', 'open', 'won']);
});
test('all six directions send the selected contract and only digit Over/Under send prediction', async () => {
  for (const type of ['CALL','PUT','DIGITOVER','DIGITUNDER','DIGITEVEN','DIGITODD']) {
    const f=fixture();
    await runSmartAI({...f.input,settings:{...settings,contractType:type,prediction:7}});
    const quote=f.calls.find(p=>p.proposal), row=f.transactions[0];
    assert.equal(quote.contract_type,type);assert.equal(row.contractType,type);
    const isDigit=['DIGITOVER','DIGITUNDER'].includes(type);
    assert.equal(Object.hasOwn(quote,'barrier'),isDigit);
    assert.equal(quote.barrier,isDigit?'7':undefined);assert.equal(row.barrier,isDigit?'7':'');
  }
});
test('changing trade type between sessions drops the previous prediction', async () => {
  const f=fixture();
  await runSmartAI({...f.input,settings:{...settings,contractType:'DIGITUNDER',prediction:8}});
  await runSmartAI({...f.input,settings:{...settings,contractType:'DIGITODD',prediction:8}});
  await runSmartAI({...f.input,settings:{...settings,contractType:'PUT',prediction:8}});
  assert.deepEqual(f.calls.filter(p=>p.proposal).map(p=>[p.contract_type,p.barrier]),[['DIGITUNDER','8'],['DIGITODD',undefined],['PUT',undefined]]);
});
test('invalid directions and impossible predictions are blocked before broker requests', async () => {
  for(const extra of [{contractType:'BAD'},{contractType:'DIGITOVER',prediction:9},{contractType:'DIGITUNDER',prediction:0},{contractType:'DIGITUNDER',prediction:2.5},{contractType:'DIGITUNDER'}]) {
    const f=fixture();await assert.rejects(runSmartAI({...f.input,settings:{...settings,...extra}}));assert.equal(f.calls.length,0);
  }
  for(const extra of [{contractType:'DIGITOVER',prediction:0},{contractType:'DIGITUNDER',prediction:9}]) {
    const f=fixture();await runSmartAI({...f.input,settings:{...settings,...extra}});assert.equal(f.calls.find(p=>p.proposal).barrier,String(extra.prediction));
  }
});
test('loss multiplies stake and win resets it to the original stake', async () => {
  const f = fixture([-1, 1, 0.5]); await runSmartAI(f.input);
  assert.deepEqual(f.calls.filter(p => p.proposal).map(p => p.amount), [1, 2, 1]);
});
test('stake list advances after losses and resets after a win', async () => {
  const f = fixture([-0.35, -0.43, 0.8, 0.5]);
  await runSmartAI({ ...f.input, settings: { ...settings, useList: true } });
  assert.deepEqual(f.calls.filter(p => p.proposal).map(p => p.amount), [0.35, 0.43, 0.85, 0.35]);
});
test('list exhaustion and next-stake loss reservation stop before another quote', async () => {
  const f = fixture([-0.35]);
  const result = await runSmartAI({ ...f.input, settings: { ...settings, useList: true, stakeList: [0.35] } });
  assert.match(result.message, /exhausted/); assert.equal(result.trades, 1);
  const g = fixture([-1]);
  const limited = await runSmartAI({ ...g.input, settings: { ...settings, lossLimit: 2 } });
  assert.match(limited.message, /allowance/); assert.equal(g.calls.filter(p => p.proposal).length, 1);
});
test('Stop while quoting sends no purchase; Stop after buy still tracks settlement', async () => {
  const f = fixture(), send = f.input.ws.send;
  f.input.ws.send = async p => { const result = await send(p); if (p.proposal) f.controller.abort(); return result; };
  await runSmartAI(f.input); assert.equal(f.calls.filter(p => p.buy).length, 0);
  const g = fixture(), otherSend = g.input.ws.send;
  g.input.ws.send = async p => { const result = await otherSend(p); if (p.buy) g.controller.abort(); return result; };
  await runSmartAI(g.input); assert.equal(g.calls.filter(p => p.buy).length, 1); assert.equal(g.transactions.at(-1).status, 'won');
});
test('account changes during quoting prevent purchases', async () => {
  const f = fixture(); let current = true; const send = f.input.ws.send;
  f.input.ws.send = async p => { const result = await send(p); if (p.proposal) current = false; return result; };
  await runSmartAI({ ...f.input, isCurrent: () => current }); assert.equal(f.calls.filter(p => p.buy).length, 0);
});
test('unconfirmed buy is persisted and never automatically retried', async () => {
  const f = fixture(), send = f.input.ws.send;
  f.input.ws.send = p => p.buy ? (f.calls.push(p), new Promise(() => {})) : send(p);
  await assert.rejects(runSmartAI(f.input), /timed out/); assert.equal(f.pending(), 'unknown');
  await assert.rejects(runSmartAI(f.input), /not confirmed/); assert.equal(f.calls.filter(p => p.buy).length, 1);
});
test('malformed quote, existing positions, and bad settings send no purchases', async () => {
  const f = fixture(), send = f.input.ws.send;
  f.input.ws.send = p => p.proposal ? Promise.resolve({ proposal: { id: 'changed', ask_price: 0.9 } }) : send(p);
  await assert.rejects(runSmartAI(f.input), /does not match/); assert.equal(f.calls.filter(p => p.buy).length, 0);
  const g = fixture(); g.input.ws.send = async () => ({ portfolio: { contracts: [{}] } });
  await assert.rejects(runSmartAI(g.input), /existing account positions/);
  const h = fixture(); await assert.rejects(runSmartAI({ ...h.input, settings: { ...settings, ticks: 1.5 } }), /whole number/); assert.equal(h.calls.length, 0);
});
test('settlement timeout keeps contract pending and restart reconciles before trading', async () => {
  const f = fixture(), send = f.input.ws.send;
  f.input.ws.send = p => p.proposal_open_contract ? Promise.resolve({ proposal_open_contract: { contract_id: p.contract_id, is_sold: 0 } }) : send(p);
  await assert.rejects(runSmartAI({ ...f.input, settlementTimeoutMs: 5 }), /Settlement timed out/);
  assert.equal(f.pending(), '1');
  await assert.rejects(runSmartAI(f.input), /still open/); assert.equal(f.calls.filter(p => p.buy).length, 1);
  f.input.ws.send = send;
  f.controller.abort(); await runSmartAI(f.input);
  assert.equal(f.pending(), null); assert.equal(f.transactions.at(-1).status, 'won');
});
