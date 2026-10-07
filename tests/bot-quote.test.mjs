import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const source = stripTypeScriptTypes(await readFile(new URL('../lib/bot-quote.ts', import.meta.url), 'utf8'));
const { assessUnderQuote } = await import('data:text/javascript,' + encodeURIComponent(source));
test('a high win rate can still have a negative expected return', () => {
  const q = assessUnderQuote('8', 1, 1.2);
  assert.equal(q.eligible,false);
  assert.ok(Math.abs(q.breakEvenWinRate - 1/1.2) < 1e-10);
  assert.ok(Math.abs(q.expectedProfit + .04) < 1e-10);
});
test('payout includes stake; break-even and positive returns are distinguished', () => {
  assert.equal(assessUnderQuote('8',1,1.25).eligible,false);
  assert.equal(assessUnderQuote('8',1,1.3).eligible,true);
  assert.equal(assessUnderQuote('7',1,1.3).eligible,false);
});
test('invalid payout never passes screening', () => {
  for (const payout of [undefined,null,0,-1,1,NaN,Infinity]) assert.throws(()=>assessUnderQuote('7',1,payout));
});
