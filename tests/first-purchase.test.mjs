import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const hookSource = stripTypeScriptTypes((await readFile(new URL('../hooks/use-digits-trading.ts', import.meta.url), 'utf8')).replace(/^import[\s\S]*?;\n/gm, '').replace('export function useDigitsTrading', 'function useDigitsTrading'));
const buySource = stripTypeScriptTypes((await readFile(new URL('../packages/core/src/react/useBuy.ts', import.meta.url), 'utf8')).replace(/^import[\s\S]*?;\n/gm, '').replace('export function useBuy', 'function useBuy'));
function fixture(recent = false, deferredBuy = false) {
  const slots = []; let cursor = 0;
  const requests = []; const refreshes = []; let resolveQuote, resolveBuy;
  const ws = { async send(request) {
    requests.push(request);
    if (request.proposal) return new Promise(resolve => { resolveQuote = resolve; });
    if (deferredBuy) return new Promise(resolve => { resolveBuy = resolve; });
    return { buy: { contract_id: 42, buy_price: 10, payout: 18 } };
  } };
  const base = { ws, isConnected: true, activeSymbol: { underlying_symbol: '1HZ100V' }, prices: [], currentTick: null, pipSize: 2 };
  const context = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useMemo: fn => fn(), useCallback: fn => fn, useEffect() {}, Date, Set,
    useBaseTrading: () => base,
    useProposal: (_ws, _connected, params) => ({ refresh: () => refreshes.push(params.contractType), proposal: { id: 'displayed', askPrice: 10, payout: 18, ...(recent ? {receivedAt:Date.now()} : {}) } }),
    computeDigitStats: () => ({}), getLastDigit: () => 0,
  };
  vm.createContext(context); vm.runInContext(buySource + '\n' + hookSource, context);
  const render = () => { cursor = 0; return context.useDigitsTrading({ ws: base.ws, isConnected: base.isConnected, isAuthenticated: true, isRealAccount: base.isRealAccount ?? true }); };
  const finishQuote = (price = 10, payout = 18) => resolveQuote({ proposal: { id: 'fresh', ask_price: price, payout } });
  return { render, requests, refreshes, base, finishQuote, finishBuy:()=>resolveBuy({buy:{contract_id:42,buy_price:10,payout:18}}) };
}
for (const [type, mode] of [['over-under', 'DIGITUNDER'], ['even-odd', 'DIGITODD'], ['matches-differs', 'DIGITDIFF']]) {
  test(`first tap purchases ${mode} and permits the next trade`, async () => {
    const f = fixture(); let h = f.render(); h.setTradeType(type); h = f.render();
    h.setContractMode(mode); const purchase = h.buyContract(mode); f.render();
    f.finishQuote(); await purchase;
    assert.equal(f.render().buyError, null);
    assert.equal(f.requests[0].contract_type, mode);
    assert.equal(f.requests.filter(r => r.buy).length, 1);
    const second = f.render().buyContract(mode); f.finishQuote(); await second;
    assert.equal(f.requests.filter(r => r.buy).length, 2);
  });
}
test('duplicate taps cannot create a second purchase', async () => {
  const f = fixture(), h = f.render(); const first = h.buyContract('DIGITOVER');
  await h.buyContract('DIGITOVER'); f.finishQuote(); await first;
  assert.equal(f.requests.filter(r => r.buy).length, 1);
});
for (const change of ['stake', 'digit', 'duration', 'account', 'disconnect']) {
  test(`${change} change while quoting cancels before sending buy`, async () => {
    const f = fixture(), h = f.render(); const purchase = h.buyContract('DIGITUNDER');
    if (change === 'stake') h.setStake('20');
    if (change === 'digit') h.setSelectedDigit(3);
    if (change === 'duration') h.setDuration(1);
    if (change === 'account') f.base.ws = { send() { throw Error('Wrong account'); } };
    if (change === 'disconnect') f.base.isConnected = false;
    f.render(); f.finishQuote(); await purchase;
    assert.match(f.render().buyError, /Trade settings or connection changed/);
    assert.equal(f.requests.filter(r => r.buy).length, 0);
  });
}
test('higher quote price is rejected without buying', async () => {
  const f = fixture(); const purchase = f.render().buyContract('DIGITOVER'); f.finishQuote(11); await purchase;
  assert.match(f.render().buyError, /Price changed/); assert.equal(f.requests.filter(r => r.buy).length, 0);
});

test('demo account cannot request or send a manual purchase', async () => {
  const f = fixture(); f.base.isRealAccount = false;
  await f.render().buyContract('DIGITOVER');
  assert.match(f.render().buyError, /real account/);
  assert.equal(f.requests.length, 0);
});
test('switching to demo while a quote is pending prevents the purchase', async () => {
  const f = fixture(); const purchase = f.render().buyContract('DIGITOVER');
  f.base.isRealAccount = false; f.render(); f.finishQuote(); await purchase;
  assert.match(f.render().buyError, /real account/);
  assert.equal(f.requests.some(request => request.buy), false);
});

for (const mode of ['DIGITOVER','DIGITUNDER','DIGITEVEN','DIGITODD','DIGITMATCH','DIGITDIFF']) {
 test(`recent ${mode} quote sends buy without waiting for another proposal`,async()=>{
  const f=fixture(true);let h=f.render();h.setTradeType(mode==='DIGITEVEN'||mode==='DIGITODD'?'even-odd':mode==='DIGITMATCH'||mode==='DIGITDIFF'?'matches-differs':'over-under');h=f.render();
  const pending=h.buyContract(mode);
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].buy,'displayed');assert.equal(f.requests[0].price,'10');await pending;
  assert.equal(f.render().buyResult.contractId,42);
 });
}
test('a consumed quote is not reused for the next purchase',async()=>{
 const f=fixture(true);await f.render().buyContract('DIGITUNDER');
 const second=f.render().buyContract('DIGITUNDER');assert.equal(f.requests.at(-1).proposal,1);f.finishQuote();await second;
 assert.equal(f.requests.filter(r=>r.buy).length,2);assert.equal(f.requests.at(-1).buy,'fresh');
});
test('fast path still blocks duplicate taps and demo accounts',async()=>{
 const f=fixture(true),h=f.render();const first=h.buyContract('DIGITUNDER');await h.buyContract('DIGITUNDER');await first;
 assert.equal(f.requests.filter(r=>r.buy).length,1);
 const demo=fixture(true);demo.base.isRealAccount=false;await demo.render().buyContract('DIGITUNDER');assert.equal(demo.requests.length,0);
});

test('fast buy stays locked until broker confirmation, then releases without waiting for settlement',async()=>{
 const f=fixture(true,true);const first=f.render().buyContract('DIGITUNDER');
 assert.equal(f.requests[0].buy,'displayed');assert.equal(f.render().isBuying,true);
 await f.render().buyContract('DIGITUNDER');assert.equal(f.requests.length,1);
 f.finishBuy();await first;assert.equal(f.render().isBuying,false);assert.equal(f.render().buyResult.contractId,42);
});

for (const mode of ['DIGITOVER', 'DIGITUNDER']) {
  for (const payout of [17, 19, NaN]) {
    test(`${mode} rejects replacement payout ${payout} and refreshes both direction buttons`, async () => {
      const f = fixture();
      const purchase = f.render().buyContract(mode);
      assert.equal(f.requests[0].contract_type, mode);
      f.finishQuote(10, payout);
      await purchase;
      assert.equal(f.requests.some(r => r.buy), false);
      assert.match(f.render().buyError, /payout changed/);
      assert.ok(f.refreshes.includes('DIGITOVER'));
      assert.ok(f.refreshes.includes('DIGITUNDER'));
      // The blocked purchase releases its lock and the next reviewed quote can buy.
      const retry = f.render().buyContract(mode);
      f.finishQuote();
      await retry;
      assert.equal(f.requests.filter(r => r.buy).length, 1);
    });
  }
}
test('a lower replacement stake also requires reviewing the new quote', async () => {
  const f = fixture();
  const purchase = f.render().buyContract('DIGITUNDER');
  f.finishQuote(9, 18);
  await purchase;
  assert.equal(f.requests.some(r => r.buy), false);
  assert.match(f.render().buyError, /Price changed/);
});
