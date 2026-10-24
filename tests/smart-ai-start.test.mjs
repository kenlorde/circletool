import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const runner=await readFile(new URL('../lib/smart-ai-runner.ts',import.meta.url),'utf8');
const {runSmartAI,prepareSmartAIStart}=await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(runner)).toString('base64')}`);
const component=await readFile(new URL('../components/smart-ai-strategy.tsx',import.meta.url),'utf8');
const clickSource=stripTypeScriptTypes(component.slice(component.indexOf('  async function start()'),component.indexOf('  return <section')));
function fixture(previous=null){
  const key='circletool-under7-pending:REAL1',storage=new Map(previous?[[key,previous]]:[]),calls=[];
  const ws={isConnected:true,async send(p){
    calls.push(p);
    if(p.portfolio)return {portfolio:{contracts:[]}};
    if(p.profit_table)return {profit_table:{transactions:[{contract_id:5}]}};
    if(p.balance)return {balance:{balance:9.41,currency:'USD',loginid:'REAL1'}};
    if(p.proposal)return {proposal:{id:'quote',ask_price:1}};
    if(p.buy){assert.equal(typeof p.price,'number','Deriv buy price must be numeric');return {buy:{contract_id:42}};}
    return {proposal_open_contract:{contract_id:p.contract_id,is_sold:1,profit:0.5}};
  }};
  const context={session:{current:null},sessionLock:{current:false},mounted:{current:true},resetAttempt:null,
    ws,isConnected:true,auth:{authState:'authenticated',activeAccount:{account_id:'REAL1',account_type:'real'}},
    accountRef:{current:{ws,accountId:'REAL1',authenticated:true,isConnected:true}},currency:'USD',
    market:{activeSymbol:{underlying_symbol:'R_10'},contracts:[{contract_type:'DIGITUNDER',min_contract_duration:'1t',max_contract_duration:'10t'}]},
    selectedContractAvailable:true,contractType:'DIGITUNDER',prediction:'7',ticks:'1',stake:'1',target:'0.5',limit:'5',martingale:'1',useList:false,stakeList:'1',
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    setBusy(){},onRunStateChange(){},setResetAttempt:v=>{context.resetAttempt=v;},
    setProgress:update=>{context.progress=typeof update==='function'?update(context.progress):update;},progress:{},
    prepareSmartAIStart,runSmartAI:input=>runSmartAI({...input,paceMs:0,pollMs:0}),AbortController,Error,
    readBotTransactions:()=>[],onTransaction(){},balanceSync:{refresh:async()=>true}};
  vm.createContext(context);vm.runInContext(clickSource,context);
  return {context,calls,storage,key,start:()=>vm.runInContext('start()',context)};
}
test('actual Start handler buys and settles in one tap when there is no pending attempt',async()=>{
  const f=fixture();await f.start();assert.equal(f.calls.filter(p=>p.buy).length,1);
  assert.equal(f.context.progress.trades,1);assert.equal(f.storage.has(f.key),false);
});
test('actual Start handler uses two deliberate taps to clear an old unknown attempt and purchase',async()=>{
  const f=fixture('unknown');await f.start();
  assert.equal(f.calls.filter(p=>p.buy).length,0);assert.equal(f.context.resetAttempt,'unknown');
  assert.equal(f.storage.get(f.key),'unknown');
  await f.start();assert.equal(f.calls.filter(p=>p.buy).length,1);
  assert.equal(f.calls.filter(p=>p.profit_table).length,2);assert.equal(f.storage.has(f.key),false);
  assert.equal(f.context.progress.trades,1);
});
test('second-tap reset cannot clear a newly open position',async()=>{
  const f=fixture('unknown');await f.start();const send=f.context.ws.send;
  f.context.ws.send=async p=>p.portfolio?{portfolio:{contracts:[{contract_id:99}]}}:send(p);
  await f.start();assert.match(f.context.progress.message,/still has an open contract/);
  assert.equal(f.storage.get(f.key),'unknown');assert.equal(f.calls.some(p=>p.buy),false);
});
test('a failed history request preserves the attempt and sends no buy',async()=>{
  const f=fixture('unknown');f.context.ws.send=async()=>{throw Error('network');};
  await f.start();assert.match(f.context.progress.message,/network/);
  assert.equal(f.storage.get(f.key),'unknown');assert.equal(f.context.resetAttempt,null);
});
test('a late confirmed contract is verified rather than cleared by the reset tap',async()=>{
  const f=fixture('unknown');await f.start();f.storage.set(f.key,'123');
  await f.start();assert.equal(f.calls.find(p=>p.proposal_open_contract).contract_id,123);
  assert.equal(f.calls.filter(p=>p.buy).length,1);
});
test('changing accounts during the broker check cannot clear the old attempt',async()=>{
  const f=fixture('unknown');await f.start();const send=f.context.ws.send;
  f.context.ws.send=async p=>{const r=await send(p);f.context.accountRef.current.accountId='OTHER';return r;};
  await f.start();assert.equal(f.storage.get(f.key),'unknown');assert.equal(f.calls.some(p=>p.buy),false);
});
test('broker validation rejection unlocks its failed request and the next tap can buy',async()=>{
  const f=fixture(),send=f.context.ws.send;let rejected=false;
  f.context.ws.send=async p=>{if(p.buy&&!rejected){rejected=true;throw Object.assign(Error('Invalid request price'),{code:'InputValidationFailed'});}return send(p);};
  await f.start();assert.equal(f.storage.has(f.key),false);assert.match(f.context.progress.message,/Invalid request price/);
  await f.start();assert.equal(f.calls.filter(p=>p.buy).length,1);assert.equal(f.context.progress.trades,1);
});

test('rapid second tap stops before purchase instead of creating a second session',async()=>{
  const f=fixture();const first=f.start();await f.start();await first;
  assert.equal(f.calls.some(p=>p.buy),false);assert.equal(f.context.session.current,null);
});

test('stake exceeding the real account balance still blocks the actual Start handler',async()=>{
  const f=fixture();f.context.stake='10';f.context.limit='20';await f.start();
  assert.match(f.context.progress.message,/exceeds available balance 9.41/);
  assert.equal(f.calls.some(p=>p.buy||p.proposal),false);
});
