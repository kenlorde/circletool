import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

// A minimal DOM adapter for the fixed XML fixtures below. Browser XML parsing is
// handled by bot-xml; these tests cover compilation and order execution.
class Element {
  constructor(name, attributes = {}) { this.localName = name; this.attributes = attributes; this.children = []; this.text = ''; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
}
globalThis.DOMParser = class {
  parseFromString(source) {
    const stack = [], roots = [];
    for (const token of source.match(/<[^>]+>|[^<]+/g) ?? []) {
      if (token.startsWith('</')) { stack.pop(); continue; }
      if (token.startsWith('<?')) continue;
      if (token.startsWith('<')) {
        const name = token.match(/^<([^\s/>]+)/)[1];
        const attributes = Object.fromEntries([...token.matchAll(/([\w:-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
        const element = new Element(name, attributes);
        (stack.at(-1)?.children ?? roots).push(element);
        if (!token.endsWith('/>')) stack.push(element);
      } else if (stack.length) stack.at(-1).text += token;
    }
    return { documentElement: roots[0], querySelector: () => null };
  }
};
const asModule = source => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`;
const xmlModule = asModule(await readFile(new URL('../lib/bot-xml.ts', import.meta.url), 'utf8'));
const runtimeSource = (await readFile(new URL('../lib/bot-runtime.ts', import.meta.url), 'utf8')).replace("'./bot-xml'", JSON.stringify(xmlModule));
const { compileBotXml, runBotSession, QUICK_DIGIT_BOT } = await import(asModule(runtimeSource));
const limits = { maxTrades: 2, maxStake: 1, lossLimit: 5 };
function mockTransport(profits = [0.2, -1]) {
  const calls = []; let quotes = 0, buys = 0;
  return { calls, async send(payload) {
    calls.push(payload);
    if (payload.proposal) return { proposal: { id: `fresh-${++quotes}`, ask_price: 1 } };
    if (payload.buy) { assert.equal(payload.buy, `fresh-${++buys}`); return { buy: { contract_id: 100 + buys } }; }
    return { proposal_open_contract: { contract_id: payload.contract_id, is_sold: 1, profit: String(profits[buys - 1] ?? 0.2) } };
  } };
}
function session(ws, overrides = {}) {
  return runBotSession({ program: compileBotXml(QUICK_DIGIT_BOT), ws, currency: 'USD', accountType: 'real', limits, signal: new AbortController().signal, isAccountCurrent: () => true, onProgress: () => {}, requestTimeoutMs: 30, pollIntervalMs: 0, ...overrides });
}
test('two consecutive trades use fresh proposals and settle before the next buy', async () => {
  const ws = mockTransport(); const result = await session(ws);
  assert.equal(result.trades, 2); assert.equal(result.profit, -0.8);
  assert.deepEqual(ws.calls.map(call => call.proposal ? 'quote' : call.buy ? 'buy' : 'settle'), ['quote', 'buy', 'settle', 'quote', 'buy', 'settle']);
});
test('unsupported XML instructions are rejected before any order', () => {
  assert.throws(() => compileBotXml(QUICK_DIGIT_BOT.replace('type="trade_again"', 'type="tick_analysis"')), /Unsupported block: tick_analysis/);
  assert.throws(() => compileBotXml(QUICK_DIGIT_BOT.replace('type="math_number"', 'type="custom_javascript"')), /Unsupported block/);
});
test('a bot without Trade again finishes after one contract', async () => {
  const program = compileBotXml(QUICK_DIGIT_BOT.replace('<block type="trade_again"/>', ''));
  const result = await session(mockTransport(), { program });
  assert.equal(result.trades, 1); assert.match(result.message, /completed/);
});
test('Stop during a pending proposal prevents its purchase', async () => {
  const controller = new AbortController(), calls = [];
  const ws = { async send(payload) { calls.push(payload); controller.abort(); return { proposal: { id: 'late', ask_price: 1 } }; } };
  const result = await session(ws, { signal: controller.signal });
  assert.equal(result.trades, 0); assert.equal(calls.length, 1);
});
test('Stop after buy tracks settlement and sends no further buy', async () => {
  const controller = new AbortController(), ws = mockTransport();
  const send = ws.send; ws.send = async payload => { const result = await send(payload); if (payload.buy) controller.abort(); return result; };
  const result = await session(ws, { signal: controller.signal });
  assert.equal(result.trades, 1); assert.equal(ws.calls.filter(call => call.buy).length, 1);
  assert.equal(ws.calls.at(-1).proposal_open_contract, 1);
});
test('an account change while quoting prevents a purchase', async () => {
  let current = true; const ws = mockTransport(); const send = ws.send;
  ws.send = async payload => { const result = await send(payload); current = false; return result; };
  const result = await session(ws, { isAccountCurrent: () => current });
  assert.equal(result.trades, 0); assert.equal(ws.calls.length, 1);
});
test('purchase timeout is never retried', async () => {
  const ws = mockTransport(), send = ws.send;
  ws.send = payload => payload.buy ? (ws.calls.push(payload), new Promise(() => {})) : send(payload);
  await assert.rejects(session(ws), /Check Trade history/);
  assert.equal(ws.calls.filter(call => call.buy).length, 1);
});
test('loss reservation blocks the next stake and the maximum stake blocks the first', async () => {
  const ws = mockTransport([-1]);
  const result = await session(ws, { limits: { ...limits, lossLimit: 1 } });
  assert.equal(result.trades, 1); assert.match(result.message, /loss limit/);
  const other = mockTransport(); const blocked = await session(other, { limits: { ...limits, maxStake: 0.5 } });
  assert.equal(blocked.trades, 0); assert.equal(other.calls.length, 0);
});
test('a stale or changed quote price is rejected before buy', async () => {
  const ws = { async send() { return { proposal: { id: 'wrong', ask_price: 0.9 } }; } };
  await assert.rejects(session(ws), /Quote does not match/);
});
test('invalid limits place no trades', async () => {
  const ws = mockTransport(); await assert.rejects(session(ws, { limits: { ...limits, maxTrades: NaN } }), /Set 1–100/);
  assert.equal(ws.calls.length, 0);
});
test('martingale variables are updated after a loss and stake cap stops escalation', async () => {
  let source = QUICK_DIGIT_BOT.replace('<statement name="SUBMARKET">', '<statement name="INITIALIZATION"><block type="variables_set"><field name="VAR" id="stake">Stake</field><value name="VALUE"><block type="math_number"><field name="NUM">1</field></block></value></block></statement><statement name="SUBMARKET">');
  source = source.replace('<value name="AMOUNT"><block type="math_number"><field name="NUM">1</field></block></value>', '<value name="AMOUNT"><block type="variables_get"><field name="VAR" id="stake">Stake</field></block></value>');
  source = source.replace('<block type="trade_again"/>', '<block type="controls_if"><value name="IF0"><block type="contract_check_result"><field name="CHECK_RESULT">loss</field></block></value><statement name="DO0"><block type="variables_set"><field name="VAR" id="stake">Stake</field><value name="VALUE"><block type="math_arithmetic"><field name="OP">MULTIPLY</field><value name="A"><block type="variables_get"><field name="VAR" id="stake">Stake</field></block></value><value name="B"><block type="math_number"><field name="NUM">2</field></block></value></block></value></block></statement><next><block type="trade_again"/></next></block>');
  const result = await session(mockTransport([-1]), { program: compileBotXml(source) });
  assert.equal(result.trades, 1); assert.match(result.message, /maximum stake/);
});

test('XML runner rejects demo and unverified account types before any request',async()=>{
 for(const accountType of ['demo',undefined]) {
  const ws=mockTransport();await assert.rejects(session(ws,{accountType}),/real account/);assert.equal(ws.calls.length,0);
 }
});
