import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const source=stripTypeScriptTypes(await readFile(new URL('../lib/bot-transactions.ts',import.meta.url),'utf8'));
const { readBotTransactions,saveBotTransaction,upsertBotTransaction,botContractLabel }=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)};
const row={accountId:'A',botId:'expert',contractId:123,symbol:'1HZ100V',currency:'USD',barrier:'8',ticks:1,stake:.35,purchasedAt:100,status:'open'};
test('purchase becomes one settled row and survives reading again',()=>{
 storage.clear();saveBotTransaction(row);saveBotTransaction({...row,status:'lost',profit:-.35,settledAt:101});
 const rows=readBotTransactions('A');assert.equal(rows.length,1);assert.equal(rows[0].profit,-.35);assert.equal(rows[0].status,'lost');
 saveBotTransaction(row);assert.equal(readBotTransactions('A')[0].status,'lost');
});
test('accounts have independent transaction records',()=>{
 storage.clear();saveBotTransaction(row);saveBotTransaction({...row,accountId:'B',botId:'master',barrier:'7'});
 assert.equal(readBotTransactions('A')[0].botId,'expert');assert.equal(readBotTransactions('B')[0].botId,'master');
});
test('Smart AI Rise records persist alongside existing digit bots',()=>{
 storage.clear();saveBotTransaction(row);
 const smart={...row,botId:'smart',contractType:'CALL',barrier:'',contractId:456};
 saveBotTransaction(smart);saveBotTransaction({...smart,status:'won',profit:.2,settledAt:101});
 const rows=readBotTransactions('A');assert.equal(rows.length,2);
 assert.equal(rows.find(x=>x.botId==='smart').contractType,'CALL');
 assert.equal(rows.find(x=>x.botId==='smart').profit,.2);
 assert.equal(rows.find(x=>x.botId==='expert').barrier,'8');
});
test('all Smart AI directions persist with the correct transaction label',()=>{
 storage.clear();
 const directions=[['CALL','','Rise'],['PUT','','Fall'],['DIGITOVER','3','Over 3'],['DIGITUNDER','8','Under 8'],['DIGITEVEN','','Even'],['DIGITODD','','Odd']];
 directions.forEach(([contractType,barrier,label],i)=>saveBotTransaction({...row,botId:'smart',contractType,barrier,contractId:500+i,purchasedAt:100+i}));
 const rows=readBotTransactions('A');assert.equal(rows.length,6);
 for(const [type,barrier,label] of directions)assert.equal(botContractLabel(rows.find(t=>t.contractType===type)),label);
 assert.equal(botContractLabel(row),'Under 8');
});
test('invalid persisted data is rejected and journal caps at 200 newest rows',()=>{
 storage.clear();storage.set('circletool.bot-transactions.v1:A','bad json');assert.deepEqual(readBotTransactions('A'),[]);
 storage.set('circletool.bot-transactions.v1:A',JSON.stringify([{...row,status:'won'},{...row,accountId:'B'}]));assert.deepEqual(readBotTransactions('A'),[]);
 let rows=[];for(let i=0;i<205;i++)rows=upsertBotTransaction(rows,{...row,contractId:i+1,purchasedAt:i});assert.equal(rows.length,200);assert.equal(rows[0].contractId,205);
});
