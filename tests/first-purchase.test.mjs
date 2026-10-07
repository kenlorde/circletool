import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const hookSource = stripTypeScriptTypes((await readFile(new URL('../hooks/use-digits-trading.ts', import.meta.url), 'utf8')).replace(/^import[\s\S]*?;\n/gm, '').replace('export function useDigitsTrading', 'function useDigitsTrading'));
const buySource = stripTypeScriptTypes((await readFile(new URL('../packages/core/src/react/useBuy.ts', import.meta.url), 'utf8')).replace(/^import[\s\S]*?;\n/gm, '').replace('export function useBuy', 'function useBuy'));
function fixture() {
  const slots = []; let cursor = 0;
  const requests = []; let resolveQuote;
  const ws = { async send(request) {
    requests.push(request);
    if (request.proposal) return new Promise(resolve => { resolveQuote = resolve; });
    return { buy: { contract_id: 42, buy_price: 10, payout: 18 } };
  } };
  const base = { ws, isConnected: true, activeSymbol: { underlying_symbol: '1HZ100V' }, prices: [], currentTick: null, pipSize: 2 };
  const context = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = value; }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useMemo: fn => fn(), useCallback: fn => fn,
    useBaseTrading: () => base,
    useProposal: () => ({ proposal: { id: 'displayed', askPrice: 10, payout: 18 } }),
    computeDigitStats: () => ({}), getLastDigit: () => 0,
  };
  vm.createContext(context); vm.runInContext(buySource + '\n' + hookSource, context);
  const render = () => { cursor = 0; return context.useDigitsTrading({ ws: base.ws, isConnected: base.isConnected, isAuthenticated: true }); };
  const finishQuote = (price = 10) => resolveQuote({ proposal: { id: 'fresh', ask_price: price, payout: 18 } });
  return { render, requests, base, finishQuote };
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
