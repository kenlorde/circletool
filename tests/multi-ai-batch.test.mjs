import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMultiBatch } from '../lib/multi-ai-batch.ts';
let quoteId=0; const quote = () => Promise.resolve({id:`q${++quoteId}`,ask_price:1});
test('sends distinct contracts concurrently and confirms all', async () => {
 let inFlight=0,max=0,id=0; const seen=[];
 const result=await runMultiBatch({count:12,maximumPrice:1,batchSize:10,delayMs:0,canContinue:()=>true,quote,buy:async()=>{ inFlight++;max=Math.max(max,inFlight); await new Promise(r=>setTimeout(r,1));inFlight--;return {contract_id:++id};},onConfirmed:x=>seen.push(x),wait:async()=>{}});
 assert.equal(max,10);assert.equal(result.confirmed,12);assert.equal(seen.length,12);
});
test('price change blocks entire group',async()=>{let n=0;const r=await runMultiBatch({count:5,maximumPrice:1,canContinue:()=>true,quote:async()=>({id:'q',ask_price:2}),buy:async()=>{n++;return {contract_id:1}},onConfirmed:()=>{}});assert.equal(n,0);assert.equal(r.confirmed,0)});
test('unknown purchase stops subsequent groups without retry',async()=>{let n=0;const r=await runMultiBatch({count:20,maximumPrice:1,canContinue:()=>true,quote,buy:async()=>{n++;if(n===2)throw Error('timeout');return {contract_id:n}},onConfirmed:()=>{}});assert.equal(n,10);assert.equal(r.confirmed,9);assert.equal(r.uncertain,1)});
test('stopped during quoting does not send purchases',async()=>{let running=true,n=0;const r=await runMultiBatch({count:10,maximumPrice:1,canContinue:()=>running,quote:async()=>{running=false;return {id:'q',ask_price:1}},buy:async()=>{n++;return {contract_id:1}},onConfirmed:()=>{}});assert.equal(n,0);assert.equal(r.confirmed,0)});

test('duplicate quote IDs stop the group',async()=>{let n=0;const r=await runMultiBatch({count:2,maximumPrice:1,canContinue:()=>true,quote:async()=>({id:'same',ask_price:1}),buy:async()=>{n++;return {contract_id:1}},onConfirmed:()=>{}});assert.equal(n,0);assert.match(r.reason,/duplicate/)});
