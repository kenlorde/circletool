const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const compiled=ts.transpileModule(fs.readFileSync('lib/bot-entry.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
function fixture() {
 const context={exports:{},require:()=>({getLastDigit:(price,precision)=>Number(price.toFixed(precision).at(-1))}),setInterval,clearInterval};
 vm.runInNewContext(compiled,context);
 const handlers=new Set();let active=true;
 const ws={isConnected:true,onMessage(fn){handlers.add(fn);return()=>handlers.delete(fn)}};
 return {ws,handlers,stop:()=>{active=false},wait:()=>context.exports.waitForDigitEight(ws,'R_100',2,100,()=>active),tick:(quote,epoch=101,symbol='R_100',pip_size=2)=>{for(const fn of handlers)fn({msg_type:'tick',tick:{quote,epoch,symbol,pip_size}})}};
}
test('waits for a fresh digit 8 on the selected market, with correct price precision',async()=>{
 const f=fixture();let done=false;const task=f.wait().then(x=>{done=true;return x});
 for(const args of [[123.78,100],[123.78,101,'R_50'],[123.8,101,'R_100',2],[123.77,101],[NaN,101]]) f.tick(...args);
 await Promise.resolve();assert.equal(done,false);
 f.tick(123.78,102);assert.equal(await task,102);assert.equal(f.handlers.size,0);
});
test('Stop cancels a pending entry and removes its listener even without ticks',async()=>{
 const f=fixture();const task=f.wait();f.stop();assert.equal(await task,null);assert.equal(f.handlers.size,0);
});
test('disconnect cancels entry without waiting indefinitely',async()=>{
 const f=fixture();const task=f.wait();f.ws.isConnected=false;assert.equal(await task,null);assert.equal(f.handlers.size,0);
});
test('duplicate digit 8 events resolve only one entry',async()=>{
 const f=fixture();let entries=0;const task=f.wait().then(()=>entries++);
 f.tick(1.28);f.tick(1.28);await task;assert.equal(entries,1);assert.equal(f.handlers.size,0);
});
