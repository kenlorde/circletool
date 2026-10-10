import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
const source=await readFile(new URL('../components/copy-trading-panel.tsx',import.meta.url),'utf8');
const command=stripTypeScriptTypes(source.slice(source.indexOf('function sendCopyCommand'),source.indexOf('function LegacyCopyTradingPanel')));
async function run(isVirtual,action='copy_start') {
 const sent=[];
 class Socket {
  constructor(){queueMicrotask(()=>this.onopen());}
  send(raw){const p=JSON.parse(raw);sent.push(p);queueMicrotask(()=>this.onmessage({data:JSON.stringify(p.authorize ? {req_id:1,msg_type:'authorize',authorize:{is_virtual:isVirtual}} : {req_id:2,msg_type:action})}));}
  close(){}
 }
 const context={WebSocket:Socket,window:{setTimeout,clearTimeout},queueMicrotask};
 vm.createContext(context);vm.runInContext(command,context);
 let error;
 try {await context.sendCopyCommand('123','follower','trader',action,1);} catch(e){error=e;}
 return {sent,error};
}
test('legacy automated copying rejects demo and unverified accounts before copy_start',async()=>{
 for(const virtual of [1,true,undefined]){
  const result=await run(virtual);assert.match(result.error.message,/real account/);
  assert.equal(result.sent.some(p=>p.copy_start),false);
 }
});
test('legacy copying permits verified real accounts and demo accounts can still stop copying',async()=>{
 for(const virtual of [0,false]){const result=await run(virtual);assert.equal(result.error,undefined);assert.equal(result.sent.some(p=>p.copy_start),true);}
 const stopped=await run(1,'copy_stop');assert.equal(stopped.error,undefined);assert.equal(stopped.sent.some(p=>p.copy_stop),true);
});
