import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
const source = await readFile(new URL('../components/advanced-manual-trader.tsx', import.meta.url), 'utf8');
const purchase = stripTypeScriptTypes(source.slice(source.indexOf('  async function buy('), source.indexOf('  const fields =')));
async function fixture(canTrade, stale = false) {
  const sent = [], errors = [];
  const ws = { async send(payload) { sent.push(payload); return { buy: { contract_id: 7 } }; } };
  const context = { ws, isConnected: true, validQuotes: true, key: 'settings', currentKey: { current: 'settings' }, quoteSet: { key: 'settings', time: Date.now(), quotes: { CALL: { id: 'quote', ask_price: 1 } } }, buyLock: { current: false }, auth: { authState: 'authenticated', activeAccountId: 'account' }, realSession: { current: { canTrade, ws: stale ? {} : ws, accountId: 'account' } }, setError: value => errors.push(value), setBuying() {}, setReceipt() {}, setQuoteSet() {}, withTimeout: p => p, message: e => e.message };
  vm.createContext(context); vm.runInContext(purchase, context); await context.buy('CALL');
  return { sent, errors };
}
test('advanced manual purchase rejects demo even when invoked directly', async () => { const f = await fixture(false); assert.equal(f.sent.length, 0); assert.match(f.errors.at(-1), /real account/); });
test('advanced manual purchase rejects a stale account socket', async () => { const f = await fixture(true, true); assert.equal(f.sent.length, 0); });
test('advanced manual purchase permits the active real account', async () => { const f = await fixture(true); assert.equal(f.sent.length, 1); assert.equal(f.sent[0].buy, 'quote'); });
