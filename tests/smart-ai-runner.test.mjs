import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const source = await readFile(new URL('../lib/smart-ai-runner.ts', import.meta.url), 'utf8');
const { runSmartAI, captureSmartAIConfirmation, smartAIHasUnknownPurchase } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`);
const settings = { stake: 1, ticks: 1, target: 0.5, lossLimit: 10, martingale: 2, useList: false, stakeList: [0.35, 0.43, 0.85] };
function fixture(profits = [0.5]) {
  const calls = [], transactions = [], controller = new AbortController();
  let pending = null, buys = 0, amount = 0;
  const ws = { async send(payload) {
    calls.push(payload);
    if (payload.balance) return { balance: { balance: 100, currency: 'USD', loginid: 'REAL1' } };
    if (payload.profit_table) return { profit_table: { transactions: [] } };
    if (payload.portfolio) return { portfolio: { contracts: [] } };
    if (payload.proposal) { amount = payload.amount; return { proposal: { id: `q-${buys + 1}`, ask_price: amount } }; }
    if (payload.buy) { buys++; return { buy: { contract_id: buys } }; }
    return { proposal_open_contract: { contract_id: payload.contract_id, is_sold: 1, profit: profits[buys - 1] ?? 0.5 } };
  } };
  const input = { settings, ws, symbol: 'R_10', currency: 'USD', accountId: 'REAL1', accountType: 'real', signal: controller.signal, isCurrent: () => true,
    pending: { get: () => pending, set: value => { pending = value; }, clear: () => { pending = null; } },
    findTransaction: id => transactions.find(t => t.contractId === id), onTransaction: t => transactions.push(t),
    onProgress: () => {}, refreshBalance: async () => {}, requestTimeoutMs: 30, pollMs: 0, paceMs: 0,
  };
  return { input, calls, transactions, controller, pending: () => pending };
}
test('Rise buys use fresh proposals, settle in sequence, and stop at profit target', async () => {
  const f = fixture([0.25, 0.25]); const result = await runSmartAI(f.input);
  assert.equal(result.trades, 2); assert.equal(result.profit, 0.5); assert.equal(f.pending(), null);
  assert.deepEqual(f.calls.filter(p => !p.balance).map(p => p.portfolio ? 'portfolio' : p.proposal ? 'quote' : p.buy ? 'buy' : 'settle'), ['portfolio', 'quote', 'buy', 'settle', 'quote', 'buy', 'settle']);
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
  await assert.rejects(runSmartAI(f.input), /no confirmed contract ID/); assert.equal(f.calls.filter(p => p.buy).length, 1);
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

test('demo or unknown account types are rejected before any request',async()=>{
 for(const accountType of ['demo',undefined,'unknown']) {
  const f=fixture();await assert.rejects(runSmartAI({...f.input,accountType}),/real account/);assert.equal(f.calls.length,0);
 }
});
test('Smart Scanner alternates only after two consecutive losses on each side and keeps fixed stake', async () => {
  const f = fixture([-1, 0.4, -1, -1, 0.4, -1, -1, 0.4]);
  const send=f.input.ws.send; let settled=0;
  f.input.ws.send=async p=>{const result=await send(p);if(p.proposal_open_contract && ++settled===8)f.controller.abort();return result;};
  const progress=[];
  await runSmartAI({...f.input,settings:{...settings,target:10,lossLimit:20,martingale:1,switchAfterTwoLosses:true},onProgress:p=>progress.push(p)});
  assert.deepEqual(f.calls.filter(p=>p.proposal).map(p=>[p.contract_type,p.barrier]),[
    ['DIGITUNDER','7'],['DIGITUNDER','7'],['DIGITUNDER','7'],['DIGITUNDER','7'],
    ['DIGITOVER','2'],['DIGITOVER','2'],['DIGITOVER','2'],['DIGITUNDER','7']]);
  assert.ok(f.calls.filter(p=>p.proposal).every(p=>p.amount===1));
  assert.ok(f.transactions.every(t=>t.botId==='scanner'));
  const closed=progress.filter(p=>p.message.startsWith('Contract settled'));
  assert.deepEqual(closed.map(p=>p.consecutiveLosses),[1,0,1,0,0,1,0,0]);
});
test('Smart Scanner break-even breaks loss streak and loss limit prevents the next purchase',async()=>{
  const f=fixture([-1,0,-1,-1]);let count=0;const send=f.input.ws.send;
  f.input.ws.send=async p=>{const r=await send(p);if(p.proposal_open_contract&&++count===4)f.controller.abort();return r;};
  await runSmartAI({...f.input,settings:{...settings,target:10,lossLimit:10,martingale:1,switchAfterTwoLosses:true}});
  assert.ok(f.calls.filter(p=>p.proposal).every(p=>p.contract_type==='DIGITUNDER'));
  const g=fixture([-1,-1]);const result=await runSmartAI({...g.input,settings:{...settings,target:10,lossLimit:2,martingale:1,switchAfterTwoLosses:true}});
  assert.equal(result.trades,2);assert.equal(g.calls.filter(p=>p.buy).length,2);assert.equal(result.activeContract,'Over 2');
});


test('Smart AI records a delayed successful buy after the runner times out, then reconciles without a duplicate', async () => {
  const f = fixture(), send = f.input.ws.send;
  let confirm;
  f.input.ws.send = p => p.buy ? (f.calls.push(p), new Promise(resolve => { confirm = resolve; })) : send(p);
  const input = { ...f.input, recoverPurchases: true };
  await assert.rejects(runSmartAI(input), /timed out/);
  assert.ok(smartAIHasUnknownPurchase(f.pending()));
  confirm({ buy: { contract_id: 123 } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.pending(), '123');
  assert.equal(f.transactions.at(-1).contractId, 123);
  f.controller.abort();
  await runSmartAI(input);
  assert.equal(f.pending(), null);
  assert.equal(f.transactions.at(-1).status, 'won');
  assert.equal(f.calls.filter(p => p.buy).length, 1);
});

test('late raw WebSocket confirmations require the exact persisted attempt token', async () => {
  const f = fixture(), send = f.input.ws.send;
  f.input.ws.send = p => p.buy ? (f.calls.push(p), new Promise(() => {})) : send(p);
  await assert.rejects(runSmartAI({ ...f.input, recoverPurchases: true }), /timed out/);
  const payload = f.calls.find(p => p.buy);
  const old = f.pending();
  assert.equal(captureSmartAIConfirmation({buy:{contract_id:321}, echo_req:{passthrough:{smart_ai_attempt:'different'}}}, f.input.pending, f.input.onTransaction), false);
  assert.equal(f.pending(), old);
  assert.equal(captureSmartAIConfirmation({buy:{contract_id:321}, echo_req:payload}, f.input.pending, f.input.onTransaction), true);
  assert.equal(f.pending(), '321');
  assert.equal(f.transactions.at(-1).contractId, 321);
});

test('legacy unknown purchases query Deriv history but never guess a contract or resend buy', async () => {
  const f = fixture(); f.input.pending.set('unknown');
  await assert.rejects(runSmartAI({...f.input,recoverPurchases:true}), /history checked/);
  assert.ok(f.calls.some(p => p.portfolio)); assert.ok(f.calls.some(p => p.profit_table));
  assert.equal(f.pending(), 'unknown'); assert.equal(f.calls.filter(p=>p.buy).length, 0);
});

test('a failed history check keeps the unknown purchase locked', async () => {
  const f=fixture();f.input.pending.set('unknown');
  f.input.ws.send=async()=>{throw Error('Connection lost')};
  await assert.rejects(runSmartAI({...f.input,recoverPurchases:true}), /Connection lost/);
  assert.equal(f.pending(),'unknown');
});

test('an excessive stake still stops Smart AI before requesting a quote or buy', async () => {
  const f=fixture();const send=f.input.ws.send;
  f.input.ws.send=p=>p.balance?Promise.resolve({balance:{balance:8.53,currency:'USD',loginid:'REAL1'}}):send(p);
  const result=await runSmartAI({...f.input,recoverPurchases:true,settings:{...settings,stake:10}});
  assert.match(result.message,/exceeds available balance/);
  assert.equal(f.calls.filter(p=>p.proposal||p.buy).length,0);
});

test('late definitive rejections unlock only their own attempt', async () => {
  const f=fixture(),send=f.input.ws.send;
  f.input.ws.send=p=>p.buy?(f.calls.push(p),new Promise(()=>{})):send(p);
  await assert.rejects(runSmartAI({...f.input,recoverPurchases:true}),/timed out/);
  const payload=f.calls.find(p=>p.buy);
  captureSmartAIConfirmation({echo_req:payload,error:{code:'UnknownError'}},f.input.pending,f.input.onTransaction);
  assert.ok(smartAIHasUnknownPurchase(f.pending()));
  captureSmartAIConfirmation({echo_req:payload,error:{code:'InsufficientBalance'}},f.input.pending,f.input.onTransaction);
  assert.equal(f.pending(),null);
});

test('one-tap restart waits for the previous contract to settle before buying once', async () => {
  const f=fixture(), send=f.input.ws.send; let checks=0;
  f.input.pending.set('99');
  f.input.ws.send=async p=>{
    if(p.proposal_open_contract && p.contract_id===99) {
      f.calls.push(p); checks++;
      assert.equal(f.calls.filter(p=>p.buy).length,0);
      return {proposal_open_contract:{contract_id:99,is_sold:checks>=3?1:0,profit:0.2}};
    }
    return send(p);
  };
  const result=await runSmartAI({...f.input,autoResumePending:true,recoverPurchases:true});
  assert.equal(checks,3);assert.equal(result.trades,1);
  assert.equal(f.calls.filter(p=>p.buy).length,1);assert.equal(f.pending(),null);
});

test('second tap during recovery stops restart and retains the previous open contract', async () => {
  const f=fixture();f.input.pending.set('99');
  const result=await runSmartAI({...f.input,autoResumePending:true,onProgress:p=>{
    if(p.message.includes('Waiting for settlement before restarting')) f.controller.abort();
  },ws:{async send(p){f.calls.push(p);return {proposal_open_contract:{contract_id:99,is_sold:0}};}}});
  assert.match(result.message,/Stopped/);assert.equal(f.pending(),'99');
  assert.equal(f.calls.filter(p=>p.buy).length,0);
});

test('late confirmation during automatic recovery settles the original buy without a second buy', async () => {
  const f=fixture(),send=f.input.ws.send;let confirm;
  f.input.ws.send=p=>p.buy?(f.calls.push(p),new Promise(resolve=>{confirm=resolve})):send(p);
  let resolved=false;
  const result=await runSmartAI({...f.input,recoverPurchases:true,autoResumePending:true,recoveryWaitMs:100,onProgress:p=>{
    if(p.message.startsWith('Waiting for the previous purchase')&&!resolved){resolved=true;confirm({buy:{contract_id:123}});}
  }});
  assert.equal(result.trades,1);assert.equal(f.pending(),null);
  assert.equal(f.calls.filter(p=>p.buy).length,1);
});

test('automatic restart never clears an unresolved buy just because history has no open positions', async () => {
  const f=fixture(), send=f.input.ws.send;
  f.input.ws.send=p=>p.buy?(f.calls.push(p),new Promise(()=>{})):send(p);
  const input={...f.input,recoverPurchases:true,autoResumePending:true,recoveryWaitMs:5};
  await assert.rejects(runSmartAI(input),/timed out/);
  const attempt=f.pending();
  await assert.rejects(runSmartAI(input),/Purchase needs verification/);
  assert.equal(f.pending(),attempt);assert.equal(f.calls.filter(p=>p.buy).length,1);
});

test('recovery settlement timeout preserves the pending contract and sends no buy', async () => {
  const f=fixture();f.input.pending.set('99');
  f.input.ws.send=async p=>{f.calls.push(p);return {proposal_open_contract:{contract_id:99,is_sold:0}};};
  await assert.rejects(runSmartAI({...f.input,autoResumePending:true,settlementTimeoutMs:5}),/still open/);
  assert.equal(f.pending(),'99');assert.equal(f.calls.filter(p=>p.buy).length,0);
});

