const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const nodes=new Map(),storage=new Map();function node(){return {textContent:'',className:'',children:[],replaceChildren(...x){this.children=x;this.lastElementChild=x.at(-1);},append(...x){this.children.push(...x);}};}
let now=1791284400;class Clock extends Date{static now(){return now*1000;}}
const context={Date:Clock,document:{body:{className:''},getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},createElement:node,addEventListener(){}},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},sessionStorage:{getItem:()=>null,setItem(){}},setTimeout(){},clearTimeout(){},setInterval(){},WebSocket:class{close(){}send(){}},console};vm.createContext(context);
for(const f of ['history-utils.js','signal-engine.js','app.js'])vm.runInContext(fs.readFileSync(require('path').join(__dirname,f),'utf8'),context);
const bucket=Math.floor(now/900),close=bucket*900;now=close+30;
const b=Array.from({length:120},(_,i)=>({epoch:(Math.floor(close/14400)-120+i)*14400,open:90+i*.2,close:90+i*.2+.1,low:89+i*.2,high:91+i*.2}));b[100].low=100;b[80].high=130;
const a=Array.from({length:100},(_,i)=>({epoch:close-(100-i)*900,open:100.7,close:100.8,low:100,high:102}));a[99]={epoch:close-900,open:101,close:102,low:99.8,high:102.2};context.a=a;context.b=b;
let e=vm.runInContext('GoldSignal.evaluate(a,b,102)',context);assert.equal(e.direction,'BUY');assert.equal(e.targetOk,true);assert.equal((e.takeProfit-e.entry)/(e.entry-e.stopLoss),2);
const mirror=x=>({...x,open:220-x.open,close:220-x.close,low:220-x.high,high:220-x.low});context.sellA=a.map(mirror);context.sellB=b.map(mirror);e=vm.runInContext('GoldSignal.evaluate(sellA,sellB,118)',context);assert.equal(e.direction,'SELL');assert.equal(e.targetOk,true);
vm.runInContext('connected=true;historyOk=true;m15=a;h4=b;tick={quote:102,epoch:Date.now()/1000};analyze()',context);assert.equal(nodes.get('direction').textContent,'BUY');assert.equal(JSON.parse(storage.get('gold-signal-history-v1')).length,1);
vm.runInContext('analyze()',context);assert.equal(JSON.parse(storage.get('gold-signal-history-v1')).length,1);
now=close+181;vm.runInContext('tick.epoch=Date.now()/1000;analyze()',context);assert.equal(nodes.get('direction').textContent,'WAIT');assert.equal(nodes.get('tag').textContent,'Entry expired');
now=close+30;vm.runInContext('expired.clear();activeSetup=null;m15=sellA;h4=sellB;tick={quote:118,epoch:Date.now()/1000};analyze()',context);assert.equal(nodes.get('direction').textContent,'SELL');
vm.runInContext('historyOk=false;analyze()',context);assert.equal(nodes.get('direction').textContent,'WAIT');assert.match(nodes.get('reason').textContent,/latest completed/);
vm.runInContext('historyOk=true;tick.epoch=Date.now()/1000-91;analyze()',context);assert.equal(nodes.get('tag').textContent,'Data unavailable');
vm.runInContext('m15=a;h4=b;reviewHistory()',context);assert.match(nodes.get('reviewSummary').textContent,/1 candle setups/);assert.match(nodes.get('reviewHistory').children[0].textContent,/historical review only/);
// Adding future H4 bars must not alter historical review.
vm.runInContext('h4=b.concat([{epoch:Date.now()/1000+14400,open:1,close:1,low:.5,high:2}]);reviewHistory()',context);assert.match(nodes.get('reviewSummary').textContent,/1 candle setups/);
console.log('BUY/SELL paths, 2:1 target, entry expiry, deduplication, stale-data blocking and review without future H4 data passed.');
(async()=>{
now=close+30;context.responses=[{candles:a.slice(0,-1)},{candles:a}];context.setTimeout=fn=>{fn();return 1;};
vm.runInContext('rpc=async()=>responses.shift();connected=true;historyOk=false;busy=false;boundaryRetryAt=0;retryNotBefore=0;lastHistoryBucket=null;h4=b;h4Bucket=Math.floor(Date.now()/14400000)',context);
await vm.runInContext('history()',context);assert.equal(vm.runInContext('historyOk',context),false);assert.equal(vm.runInContext('lastHistoryBucket',context),null);
now+=61;await vm.runInContext('history()',context);assert.equal(vm.runInContext('historyOk',context),true);assert.equal(vm.runInContext('lastHistoryBucket',context),Math.floor(now/900));
vm.runInContext('lastHistoryBucket=null;rpc=async()=>{throw Error("request failed");}',context);await vm.runInContext('history()',context);assert.equal(vm.runInContext('historyOk',context),false);
console.log('Late boundary candles retry without caching; refresh errors invalidate prior history.');
})().catch(error=>{console.error(error);process.exitCode=1;});
