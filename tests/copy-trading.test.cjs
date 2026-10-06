const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const Module = require('node:module');
const compiled = ts.transpileModule(fs.readFileSync('lib/copy-trading.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = new Module('copy-runtime'); m._compile(compiled, 'copy-runtime.cjs');
const { copyParameters, CopySocket } = m.exports;
const contract = { contract_type: 'DIGITUNDER', status: 'open', currency: 'USD', buy_price: '5', underlying_symbol: 'R_100', purchase_time: 100, tick_count: 5, barrier: '7' };
test('copies digit prediction and duration with capped stake', () => {
  assert.deepEqual(copyParameters(contract, 'USD', 1, 101), { amount: 1, basis: 'stake', currency: 'USD', contract_type: 'DIGITUNDER', underlying_symbol: 'R_100', barrier: '7', duration: 5, duration_unit: 't' });
});
test('blocks closed, stale, missing prediction, cross-currency and unsupported contracts', () => {
  for (const change of [{ status: 'won' }, { purchase_time: 80 }, { barrier: null }, { currency: 'EUR' }, { contract_type: 'MULTUP' }, { buy_price: 'NaN' }, { purchase_time: undefined }]) assert.throws(() => copyParameters({ ...contract, ...change }, 'USD', 1, 101));
});
test('time-based Rise/Fall keeps expiry and rejects barrier contracts or imminent expiry', () => {
  const call = { ...contract, contract_type: 'CALL', tick_count: undefined, barrier_count: 0, date_expiry: 200 };
  assert.equal(copyParameters(call, 'USD', 2, 101).date_expiry, 200);
  assert.throws(() => copyParameters({ ...call, barrier_count: 1 }, 'USD', 2, 101));
  assert.throws(() => copyParameters({ ...call, date_expiry: 110 }, 'USD', 2, 101));
});
class FakeSocket {
  static OPEN = 1;
  static instances = [];
  readyState = 1;
  constructor() { FakeSocket.instances.push(this); queueMicrotask(() => this.onopen?.()); }
  send(raw) { this.last = JSON.parse(raw); }
  close() { this.readyState = 3; this.onclose?.(); }
  receive(p) { this.onmessage({ data: JSON.stringify(p) }); }
}
global.WebSocket = FakeSocket;
test('authenticated socket correlates requests, rejects API errors and clears pending on stop', async () => {
  const socket = await CopySocket.open('wss://example.invalid');
  const fake = FakeSocket.instances.at(-1);
  const request = socket.request({ balance: 1 });
  fake.receive({ req_id: fake.last.req_id, balance: { balance: '20' } });
  assert.equal((await request).balance.balance, '20');
  const denied = socket.request({ proposal: 1 });
  fake.receive({ req_id: fake.last.req_id, error: { code: 'PermissionDenied', message: 'secret-token' } });
  await assert.rejects(denied, e => !e.message.includes('secret-token'));
  const pending = socket.request({ buy: 'quote', price: 1 });
  socket.close();
  await assert.rejects(pending, /Check account history/);
  await assert.rejects(socket.request({ buy: 'quote', price: 1 }), /closed/);
});
const routeCode = ts.transpileModule(fs.readFileSync('app/api/copy-connection/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const routeModule = new Module('copy-route');
routeModule.require = name => name === 'next/server' ? { NextResponse: { json: (body, options) => ({ body, ...options }) } } : require(name);
routeModule._compile(routeCode, 'copy-route.cjs');
const { POST } = routeModule.exports;
const request = (body, origin = 'https://circletool.pro') => ({ headers: new Headers({ origin }), nextUrl: { origin: 'https://circletool.pro' }, json: async () => body });
test('connection bridge rejects foreign origins and invalid credentials before upstream calls', async () => {
  assert.equal((await POST(request({}, 'https://other.example'))).status, 403);
  assert.equal((await POST(request({ appId: 'new-app-id', token: 'bad\nvalue' }))).status, 400);
  assert.equal((await POST(request({ appId: 'new-app-id', token: 'valid', accountId: '../escape' }))).status, 400);
});
test('new App ID is preserved, credentials stay in upstream headers, active accounts only', async () => {
  const saved = global.fetch;
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://api.derivws.com/trading/v1/options/accounts');
    assert.equal(options.headers['Deriv-App-ID'], 'a1b2-new-id');
    assert.equal(options.headers.Authorization, 'Bearer secret');
    return { ok: true, json: async () => ({ data: [{ account_id: 'DOT1', currency: 'USD', account_type: 'demo', status: 'active' }, { account_id: 'ROT2', status: 'inactive' }] }) };
  };
  try {
    const response = await POST(request({ appId: 'a1b2-new-id', token: 'secret' }));
    assert.deepEqual(response.body, { accounts: [{ id: 'DOT1', currency: 'USD', type: 'demo' }] });
    assert.equal(response.headers['Cache-Control'], 'no-store');
    assert.ok(!JSON.stringify(response.body).includes('secret'));
  } finally { global.fetch = saved; }
});
test('OTP bridge accepts only Deriv authenticated URLs and redacts upstream errors', async () => {
  const saved = global.fetch;
  try {
    for (const url of ['wss://evil.example/trading/v1/options/ws/demo?otp=x', 'https://api.derivws.com/trading/v1/options/ws/demo?otp=x']) {
      global.fetch = async () => ({ ok: true, json: async () => ({ data: { url } }) });
      assert.equal((await POST(request({ appId: 'new-id', token: 'secret', accountId: 'DOT1' }))).status, 502);
    }
    global.fetch = async () => ({ ok: true, json: async () => ({ data: { url: 'wss://api.derivws.com/trading/v1/options/ws/demo?otp=x' } }) });
    assert.equal((await POST(request({ appId: 'new-id', token: 'secret', accountId: 'DOT1' }))).status, 200);
    global.fetch = async () => ({ ok: false, status: 401, json: async () => ({ message: 'secret' }) });
    const denied = await POST(request({ appId: 'new-id', token: 'secret' }));
    assert.equal(denied.status, 401); assert.ok(!JSON.stringify(denied.body).includes('secret'));
  } finally { global.fetch = saved; }
});
