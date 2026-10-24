import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`;
const { createBalanceSync, parseBalanceUpdate } = await import(moduleUrl(await readFile(new URL('../lib/balance-sync.ts', import.meta.url), 'utf8')));
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture(overrides = {}, options = {}) {
  let frame; const updates = [], statuses = [], calls = [];
  const ws = {
    send: async payload => { calls.push(payload); return { balance: { balance: '101.20', currency: 'USD' } }; },
    subscribe: async (_payload, handler) => { frame = handler; return { unsubscribe: async () => {} }; },
    ...overrides,
  };
  const sync = createBalanceSync(ws, 'real-1', u => updates.push(u), s => statuses.push(s), { pollMs: 60000, retryMs: 60000, ...options });
  return { sync, updates, statuses, calls, frame: value => frame(value) };
}
test('accepts finite numeric/string balances and rejects malformed values', () => {
  assert.equal(parseBalanceUpdate({ balance: 0 }).balance, '0');
  assert.equal(parseBalanceUpdate({ balance: { balance: '12.50', loginid: 'real-1' } }).accountId, 'real-1');
  for (const balance of ['', 'NaN', Infinity, null, { balance: 'oops' }]) assert.equal(parseBalanceUpdate({ balance }), null);
});
test('post-settlement refresh reads authoritative balance instead of adding session profit', async () => {
  const f = fixture(); try {
    await tick(); f.calls.length = 0;
    assert.equal(await f.sync.refresh(true), true);
    assert.deepEqual(f.calls, [{ balance: 1 }]);
    assert.equal(f.updates[0].balance, '101.20');
    assert.equal(f.statuses.at(-1).error, null);
  } finally { f.sync.dispose(); }
});
test('failed balance subscription uses snapshot fallback and reports failures', async () => {
  const f = fixture({ subscribe: async () => { throw Error('offline'); }, send: async () => { throw Error('offline'); } });
  try { await tick(); assert.match(f.statuses[0].error, /Live balance/); assert.match(f.statuses.at(-1).error, /out of date/); }
  finally { f.sync.dispose(); }
});
test('failed subscription is retried and a later verified frame recovers the balance', async () => {
  let attempts = 0;
  const f = fixture({ subscribe: async (_p, handler) => {
    if (++attempts === 1) throw Error('temporary');
    handler({ balance: { balance: 102 } }); return { unsubscribe: async () => {} };
  } }, { retryMs: 5 });
  try { await new Promise(r => setTimeout(r, 25)); assert.equal(attempts, 2); assert.equal(f.updates.at(-1).balance, '102'); }
  finally { f.sync.dispose(); }
});
test('newer stream update is not overwritten by a delayed snapshot', async () => {
  const d = deferred(), f = fixture({ send: () => d.promise });
  try {
    const result = f.sync.refresh();
    f.frame({ balance: { balance: 110 } });
    d.resolve({ balance: { balance: 100 } });
    assert.equal(await result, true); assert.deepEqual(f.updates.map(u => u.balance), ['110']);
  } finally { f.sync.dispose(); }
});
test('fresh refresh after settlement cannot reuse a pre-settlement request', async () => {
  const d = deferred(); let requests = 0;
  const f = fixture({ send: () => ++requests === 1 ? d.promise : Promise.resolve({ balance: 120 }) });
  try {
    const before = f.sync.refresh(), after = f.sync.refresh(true);
    d.resolve({ balance: 100 }); await before; await after;
    assert.equal(requests, 2); assert.equal(f.updates.at(-1).balance, '120');
  } finally { f.sync.dispose(); }
});
test('account mismatch and late account responses cannot update the selected account', async () => {
  const d = deferred(), f = fixture({ send: () => d.promise });
  f.frame({ balance: { balance: 500, account_id: 'demo-2' } });
  const p = f.sync.refresh(); f.sync.dispose(); d.resolve({ balance: 600 });
  assert.equal(await p, false); assert.equal(f.updates.length, 0);
});
test('unresponsive balance request times out without hanging the bot', async () => {
  const f = fixture({ send: () => new Promise(() => {}) }, { requestTimeoutMs: 5 });
  try { assert.equal(await f.sync.refresh(), false); assert.match(f.statuses.at(-1).error, /out of date/); }
  finally { f.sync.dispose(); }
});
test('periodic refresh restores a lost stream update', async () => {
  const f = fixture({}, { pollMs: 5 });
  try { await new Promise(r => setTimeout(r, 18)); assert.ok(f.calls.length >= 1); assert.equal(f.updates.at(-1).balance, '101.20'); }
  finally { f.sync.dispose(); }
});

const source = (await readFile(new URL('../packages/core/src/ws/deriv-ws.ts', import.meta.url), 'utf8')).replace("import { getPublicWsUrl } from '../config/urls';", "const getPublicWsUrl = () => 'wss://test';");
const { DerivWS } = await import(moduleUrl(source));
class MockSocket {
  static OPEN = 1; static instance;
  readyState = 0;
  constructor() { MockSocket.instance = this; queueMicrotask(() => { this.readyState = 1; this.onopen(); }); }
  send(message) { this.lastMessage = JSON.parse(message); }
  close() { this.readyState = 3; this.onclose(); }
}
globalThis.WebSocket = MockSocket;
test('WebSocket unanswered purchase rejects once and is never automatically retried', async () => {
  const ws = new DerivWS('wss://test', 5); await ws.connect();
  try { await assert.rejects(ws.send({ buy: 'proposal', price: '1' }), /timed out/); }
  finally { ws.disconnect(); }
});
test('disconnect rejects pending settlement instead of leaving bot busy forever', async () => {
  const ws = new DerivWS('wss://test', 500); await ws.connect();
  const pending = ws.send({ proposal_open_contract: 1, contract_id: 123 });
  ws.disconnect(); await assert.rejects(pending, /connection closed/);
});

test('authenticated reconnect requests a fresh OTP URL and sends no purchase', async () => {
  let refreshes=0;
  const ws=new DerivWS('wss://used-once',100,async()=>{refreshes++;return 'wss://fresh-'+refreshes;});
  await ws.connect();const original=MockSocket.instance;
  original.close();
  await ws.resume();
  try {
    assert.equal(refreshes,1);assert.notEqual(MockSocket.instance,original);
    assert.equal(ws.url,'wss://fresh-1');assert.equal(ws.isConnected,true);
    assert.equal(MockSocket.instance.lastMessage,undefined);
  } finally {ws.disconnect();}
});

test('concurrent reconnect calls share one OTP request and settle together', async () => {
  const otp=deferred();let refreshes=0;
  const ws=new DerivWS('wss://initial',100,()=>{refreshes++;return otp.promise;});
  await ws.connect();MockSocket.instance.close();
  const first=ws.resume(),second=ws.connect();assert.equal(first,second);
  otp.resolve('wss://fresh');await Promise.all([first,second]);
  try {assert.equal(refreshes,1);assert.equal(ws.isConnected,true);}finally{ws.disconnect();}
});

test('logout during OTP refresh cannot open the old account socket', async () => {
  const otp=deferred();const ws=new DerivWS('wss://initial',100,()=>otp.promise);
  await ws.connect();const original=MockSocket.instance;original.close();
  const connection=ws.resume();ws.disconnect();otp.resolve('wss://old-account');
  await assert.rejects(connection,/cancelled/);
  assert.equal(MockSocket.instance,original);assert.equal(ws.isConnected,false);
});

test('OTP fetch failure can recover without reusing the consumed URL', async () => {
  let attempts=0;
  const ws=new DerivWS('wss://initial',100,async()=>{if(++attempts===1)throw Error('network');return 'wss://new';});
  await ws.connect();MockSocket.instance.close();
  await assert.rejects(ws.resume(),/network/);
  await ws.resume();try{assert.equal(attempts,2);assert.equal(ws.url,'wss://new');}finally{ws.disconnect();}
});

test('balance is verified immediately even when a subscription sends no initial frame', async () => {
  const f=fixture();try{await tick();assert.equal(f.updates[0].balance,'101.20');assert.equal(f.statuses.at(-1).error,null);}finally{f.sync.dispose();}
});

