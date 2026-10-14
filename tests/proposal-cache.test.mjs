import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const source=stripTypeScriptTypes((await readFile(new URL('../packages/core/src/react/useProposal.ts',import.meta.url),'utf8')).replace(/^import.*;\n/gm,'').replace('export function','function'));
function fixture(){
 const slots=[],timers=new Map();let cursor=0,effect,cleanup,timerId=0;
 const context={Date,JSON,Number,parseFloat,clearTimeout:id=>timers.delete(id),setTimeout(fn,delay){timers.set(++timerId,{fn,delay});return timerId;},useCallback:fn=>fn,
  useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},
  useRef(initial){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i];},useEffect(fn){effect=fn;}};
 vm.createContext(context);vm.runInContext(source,context);
 const params={contractType:'DIGITUNDER',symbol:'1HZ100V',amount:10,basis:'stake',currency:'USD',duration:1,durationUnit:'t',barrier:8};
 const render=(ws,overrides={})=>{cursor=0;return context.useProposal(ws,true,{...params,...overrides});};
 const flush=()=>{cleanup?.();cleanup=effect();};
 return {render,flush,dispose:()=>cleanup?.(),timers,runTimer(){const [id,timer]=timers.entries().next().value;timers.delete(id);timer.fn();return timer.delay;}};
}
function socket(){const handlers=[],requests=[];return {handlers,requests,subscribe(payload,handler){handlers.push(handler);requests.push(payload);return Promise.resolve({unsubscribe(){}});}};}
const response={proposal:{id:'quote',ask_price:'10.00',payout:'11.76',longcode:'Under',validation_params:{stake:{min:'0.35'},payout:{max:'10000'}}}};
test('displayed proposal records receipt time and normalizes numeric API strings',()=>{
 const f=fixture(),ws=socket();f.render(ws);f.flush();const before=Date.now();ws.handlers[0](response);const proposal=f.render(ws).proposal;
 assert.equal(proposal.askPrice,10);assert.equal(proposal.payout,11.76);assert.ok(proposal.receivedAt>=before);
});
test('an old-account quote is never exposed on the new account socket',()=>{
 const f=fixture(),old=socket(),current=socket();f.render(old);f.flush();old.handlers[0](response);
 assert.equal(f.render(current).proposal,null);f.flush();old.handlers[0](response);assert.equal(f.render(current).proposal,null);
 current.handlers[0](response);assert.equal(f.render(current).proposal.id,'quote');
});
test('settings changes invalidate the displayed quote before a replacement arrives',()=>{
 const f=fixture(),ws=socket();f.render(ws);f.flush();ws.handlers[0](response);assert.equal(f.render(ws,{amount:20}).proposal,null);
});
test('refresh prepares a replacement quote and ignores cancelled stream messages',()=>{
 const f=fixture(),ws=socket();f.render(ws);f.flush();ws.handlers[0](response);f.render(ws).refresh();f.render(ws);f.flush();
 assert.equal(ws.requests.length,2);ws.handlers[0](response);assert.equal(f.render(ws).proposal,null);
 ws.handlers[1]({proposal:{...response.proposal,id:'next'}});assert.equal(f.render(ws).proposal.id,'next');
});

test('a rejected quote retries automatically and recovers without sending a buy',async()=>{
 const f=fixture(),ws=socket();let fail=true;
 const subscribe=ws.subscribe;ws.subscribe=(...args)=>fail?Promise.reject(new Error('Temporary failure')):subscribe(...args);
 f.render(ws);f.flush();await Promise.resolve();await Promise.resolve();
 assert.equal(f.render(ws).proposal,null);assert.equal(f.runTimer(),1000);
 fail=false;f.render(ws);f.flush();ws.handlers[0](response);
 assert.equal(f.render(ws).proposal.id,'quote');assert.equal(f.timers.size,0);
 assert.ok(ws.requests.every(request=>request.proposal===1&&!request.buy));
});
test('silent requests recover and late replies from cancelled attempts are ignored',()=>{
 const f=fixture(),ws=socket();f.render(ws);f.flush();
 assert.equal(f.runTimer(),8000);assert.equal(f.runTimer(),1000);
 f.render(ws);f.flush();ws.handlers[0](response);assert.equal(f.render(ws).proposal,null);
 ws.handlers[1](response);assert.equal(f.render(ws).proposal.id,'quote');
});
test('repeated failures back off and cleanup cancels retries',async()=>{
 const f=fixture(),ws={subscribe:()=>Promise.reject(new Error('Unavailable'))};
 for(const delay of [1000,2000,4000,8000,15000,15000]){
  f.render(ws);f.flush();await Promise.resolve();await Promise.resolve();assert.equal(f.runTimer(),delay);
 }
 f.render(ws);f.flush();await Promise.resolve();await Promise.resolve();f.dispose();assert.equal(f.timers.size,0);
});
