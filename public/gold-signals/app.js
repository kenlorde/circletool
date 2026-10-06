'use strict';
const $=id=>document.getElementById(id),fmt=n=>Number.isFinite(n)?n.toFixed(2):'—';
let socket,seq=0,pending=new Map(),h4=[],m15=[],tick=null,connected=false,generation=0,result={direction:'WAIT'},busy=false,historyOk=false,expired=new Set(),activeSetup=null;
try { const saved=JSON.parse(sessionStorage.getItem('gold-setup-v3')||'null'); if(saved){expired=new Set(saved.expired||[]);activeSetup=saved.activeSetup||null;} } catch {}
function saveSetup(){try{sessionStorage.setItem('gold-setup-v3',JSON.stringify({expired:[...expired].slice(-200),activeSetup}));}catch{}}
function expireSetup(epoch){expired.add(epoch);activeSetup=null;saveSetup();}

const historyKey='gold-signal-history-v1';
let signalHistory=[];
try{const saved=JSON.parse(localStorage.getItem(historyKey)||'[]');if(Array.isArray(saved))signalHistory=saved.filter(x=>x&&['BUY','SELL'].includes(x.direction)&&[x.entry,x.stopLoss,x.takeProfit,x.candleClose,x.expiresAt].every(Number.isFinite)).slice(0,100);}catch{}
function eat(epoch){return new Date(epoch*1000).toLocaleString('en-KE',{timeZone:'Africa/Nairobi'});}
function renderHistory(){
 const list=$('signalHistory');list.replaceChildren();
 if(!signalHistory.length){const item=document.createElement('li');item.textContent='No signals recorded on this browser yet.';list.append(item);return;}
 for(const x of signalHistory){const item=document.createElement('li');const title=document.createElement('strong');title.textContent=x.direction+' · candle closed '+eat(x.candleClose)+' EAT';const detail=document.createElement('p');detail.textContent='Entry '+fmt(x.entry)+' · stop '+fmt(x.stopLoss)+' · target '+fmt(x.takeProfit);const state=document.createElement('small');state.textContent=(Date.now()/1000>x.expiresAt||expired.has(x.candleClose-900)?'Entry expired':'Entry window open')+' · entry deadline '+eat(x.expiresAt)+' EAT';item.append(title,detail,state);list.append(item);}
}
function recordSignal(setup){
 if(signalHistory.some(x=>x.candleClose===setup.candleClose&&x.direction===setup.direction))return;
 signalHistory.unshift({...setup,recordedAt:Date.now()/1000});signalHistory=signalHistory.slice(0,100);
 try{localStorage.setItem(historyKey,JSON.stringify(signalHistory));}catch{}
 renderHistory();
}
function showChecks(rows){$('checks').replaceChildren(...rows.map(([ok,label])=>{const item=document.createElement('li');item.textContent=(ok===null?'CHECK: ':ok?'PASS: ':'FAIL: ')+label;item.className=ok===null?'':ok?'check-pass':'check-fail';return item;}));}

function renderSetup(setup){recordSignal(setup);const targetCheck=$('checks').lastElementChild;if(targetCheck&&targetCheck.textContent.startsWith('CHECK: 2:1')){targetCheck.textContent='PASS: Fixed setup has a 2:1 target before the opposing zone.';targetCheck.className='check-pass';}result={...setup,quoteTime:tick.epoch};document.body.className=setup.direction.toLowerCase();$('direction').textContent=setup.direction;$('tag').textContent='2.00 reward / risk';$('reason').textContent=setup.direction==='BUY'?'Bullish rejection confirmed. These entry, stop and target levels are fixed for this setup.':'Bearish rejection confirmed. These entry, stop and target levels are fixed for this setup.';$('entry').textContent=fmt(setup.entry);$('sl').textContent=fmt(setup.stopLoss);$('tp').textContent=fmt(setup.takeProfit);}
const schedules=new Map(),scheduleCache=new Map();
let lastHistoryBucket=null,h4Bucket=null,retryNotBefore=0,scheduleRetryNotBefore=0,boundaryRetryAt=0;
try{for(const [date,cached] of JSON.parse(sessionStorage.getItem('gold-hours-v1')||'[]')){if(cached&&Date.now()-cached.fetchedAt<1800000&&Array.isArray(cached.hours)){scheduleCache.set(date,cached);schedules.set(date,cached.hours);}}}catch{}
function saveHours(){try{sessionStorage.setItem('gold-hours-v1',JSON.stringify([...scheduleCache].slice(-10)));}catch{}}
async function verifySchedules(candles,g){await Promise.all([...new Set(candles.flatMap((_,i)=>GoldHistory.gapDates(candles.slice(0,i+1))))].map(async date=>{try{const cached=scheduleCache.get(date);if(cached&&Date.now()-cached.fetchedAt<1800000){if(g===generation)schedules.set(date,cached.hours);return;}if(Date.now()<scheduleRetryNotBefore)return;const response=await rpc({trading_times:date});const hours=GoldHistory.sessions(response,date);if(g!==generation)return;if(hours!==null){schedules.set(date,hours);scheduleCache.set(date,{hours,fetchedAt:Date.now()});saveHours();}else schedules.delete(date);}catch(error){if(g===generation){schedules.delete(date);if(/rate limit/i.test(error.message))scheduleRetryNotBefore=Date.now()+120000;}}}));}
const endpoints=['wss://api.derivws.com/trading/v1/options/ws/public','wss://ws.derivws.com/websockets/v3?app_id=1089'];
function rpc(data){return new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);reject(Error('Market-data request timed out.'));},15000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({...data,req_id:id}));});}
function wait(reason,tag='No setup'){if(['Data unavailable','History rate limited','Insufficient data','Incomplete M15 history','Session warming up','Stale history','Connecting','Offline'].includes(tag))showChecks([[false,reason]]);result={direction:'WAIT',reason};document.body.className='';$('direction').textContent='WAIT';$('reason').textContent=reason;$('tag').textContent=tag;for(const x of ['entry','sl','tp'])$(x).textContent='—';}
function clean(c){return c.filter(x=>[x.epoch,x.open,x.high,x.low,x.close].every(Number.isFinite)&&x.low>0&&x.low<=Math.min(x.open,x.close)&&x.high>=Math.max(x.open,x.close)).sort((a,b)=>a.epoch-b.epoch).filter((x,i,a)=>!i||x.epoch!==a[i-1].epoch);}
function consecutive(a,n,step){const tail=a.slice(-n);return tail.every((c,i)=>!i||c.epoch-tail[i-1].epoch===step);}
function analyze(){showChecks([[null,'Checking live prices and candle history.']]);renderHistory();const now=Date.now()/1000;if(!connected||!tick||now-tick.epoch>90||tick.epoch>now+30){wait('Fresh market prices are unavailable. Refresh to reconnect.','Data unavailable');return;}if(!historyOk){if(Date.now()<retryNotBefore){wait('Deriv limited candle-history requests. Automatic retry is scheduled in '+Math.ceil((retryNotBefore-Date.now())/1000)+' seconds.','History rate limited');}else wait('Waiting for the latest completed M15 candle. Retrying automatically; no entry until it arrives.','Data unavailable');return;}const a=m15.filter(c=>c.epoch+900<=now),b=h4.filter(c=>c.epoch+14400<=now);if(a.length<60||b.length<60){wait('Not enough candle history to confirm a setup.','Insufficient data');return;}const c=a.at(-1);if(c.epoch!==(Math.floor(now/900)-1)*900){wait('Waiting for the latest completed M15 candle. Retrying automatically; no entry until it arrives.','Data unavailable');return;}const evaluation=GoldSignal.evaluate(a,b,tick.quote),{s,r,v}=evaluation;$('support').textContent=fmt(s);$('resistance').textContent=fmt(r);draw(m15.slice(-50),s,r);const completeness=GoldHistory.continuity(a,schedules);if(!completeness.ok){wait(completeness.reason+'. Refreshing history and checking Deriv trading hours.','Incomplete M15 history');return;}if(!consecutive(a,3,900)){wait('Gold has reopened. Waiting for three completed M15 candles before checking entries.','Session warming up');return;}$('signalTime').textContent='Candle closed '+new Date((c.epoch+900)*1000).toLocaleTimeString('en-KE',{timeZone:'Africa/Nairobi',hour:'2-digit',minute:'2-digit'})+' EAT · entry window: first 3 minutes after close'+(completeness.closures?' · market break verified':'');if(now-(c.epoch+900)>900||now-(b.at(-1).epoch+14400)>14520){wait('Candle history is too old. No entry signal.','Stale history');return;}if(!evaluation.ready){wait('No confirmed support and resistance around price yet.');return;}const {buy,sell,selected,side,trend}=evaluation;
showChecks([[true,'Fresh quote and verified candle history.'],[trend!=='FLAT','4H trend: '+trend+' · checking '+side+' conditions.'],...selected,[now-(c.epoch+900)<=180&&Math.abs(tick.quote-c.close)<=.2*v,'Entry is within 3 minutes of candle close and price drift is within 0.2 ATR.'],[null,'2:1 target space is checked only after a rejection qualifies.']]);
if(!buy&&!sell){wait((trend==='FLAT'?'No setup: the 4H trend is mixed. ':'No '+side+' setup. ')+selected.filter(([ok])=>!ok).map(([,label])=>'Not met: '+label).join(' ')+' Next candle close: '+new Date((c.epoch+1800)*1000).toLocaleTimeString('en-KE',{timeZone:'Africa/Nairobi',hour:'2-digit',minute:'2-digit'})+' EAT.');return;}if(activeSetup&&activeSetup.candleClose!==c.epoch+900){activeSetup=null;saveSetup();}
if(activeSetup){
 const x=activeSetup,isBuy=x.direction==='BUY';
 if(now>x.expiresAt||Math.abs(tick.quote-c.close)>.2*v||(isBuy?(tick.quote<=x.stopLoss||tick.quote>=x.takeProfit):(tick.quote>=x.stopLoss||tick.quote<=x.takeProfit))){
  expireSetup(c.epoch);wait('This setup expired or its stop/target was reached. Wait for a new completed candle.','Entry expired');return;
 }
 renderSetup(x);return;
}
if(expired.has(c.epoch)){wait('This setup has expired. Waiting for a new completed candle.','Entry expired');return;}
if(now-(c.epoch+900)>180||Math.abs(tick.quote-c.close)>.2*v){expireSetup(c.epoch);wait('The three-minute entry window has ended or price moved too far.','Entry expired');return;}
const {entry,stopLoss:sl,takeProfit:tp,targetOk}=evaluation;
if(!targetOk){showChecks([...selected,[false,'Insufficient room for a valid 2:1 target before the opposing zone.']]);wait('The opposing zone is too close. Reward from the current quote is below twice the risk.');return;}
activeSetup={direction:buy?'BUY':'SELL',entry,stopLoss:sl,takeProfit:tp,support:s,resistance:r,candleClose:c.epoch+900,expiresAt:c.epoch+1080,trend};
showChecks([...selected,[true,'Entry window, price drift and 2:1 target space passed.']]);saveSetup();renderSetup(activeSetup);}

function draw(data,s,r){const vals=data.flatMap(c=>[c.high,c.low]).concat([s,r].filter(Number.isFinite));if(!vals.length)return;let lo=Math.min(...vals),hi=Math.max(...vals),pad=(hi-lo)*.08||1;lo-=pad;hi+=pad;const y=p=>230-(p-lo)/(hi-lo)*210;let html='';for(let i=0;i<4;i++){const yy=20+i*70;html+=`<path d="M0 ${yy}H600" stroke="#243348"/>`;}data.forEach((c,i)=>{const x=12+i*490/data.length,col=c.close>=c.open?'#52d4ab':'#ff8494';html+=`<path d="M${x} ${y(c.high)}V${y(c.low)}" stroke="${col}"/><rect x="${x-3}" y="${Math.min(y(c.open),y(c.close))}" width="6" height="${Math.max(1,Math.abs(y(c.open)-y(c.close)))}" fill="${col}"/>`;});[[s,'#52d4ab'],[r,'#ff8494']].forEach(([p,col])=>{if(Number.isFinite(p))html+=`<path d="M0 ${y(p)}H505" stroke="${col}" stroke-dasharray="5 5"/><text x="510" y="${y(p)+4}" font-size="12" fill="${col}">${fmt(p)}</text>`;});$('chart').innerHTML=html;}
function reviewHistory(){
 const list=$('reviewHistory'),summary=$('reviewSummary');if(!list||!summary)return;
 list.replaceChildren();const now=Date.now()/1000,completed=m15.filter(c=>c.epoch+900<=now),rows=[],blocked=new Map();let checked=0,unverified=0;
 for(let i=59;i<completed.length;i++){
  const c=completed[i],close=c.epoch+900;if(close<now-86400)continue;
  const a=completed.slice(0,i+1),b=h4.filter(x=>x.epoch+14400<=close);
  if(b.length<60||close-(b.at(-1).epoch+14400)>14520||!GoldHistory.continuity(a,schedules).ok||!consecutive(a,3,900)){unverified++;continue;}
  const e=GoldSignal.evaluate(a,b,c.close);if(!e.ready){unverified++;continue;}checked++;
  if(e.direction!=='WAIT'&&e.targetOk)rows.push(e);
  else {for(const [,label] of e.selected.filter(([ok])=>!ok))blocked.set(label,(blocked.get(label)||0)+1);if(e.direction!=='WAIT'&&!e.targetOk)blocked.set('Enough room for a 2:1 target before the opposing zone.',(blocked.get('Enough room for a 2:1 target before the opposing zone.')||0)+1);}
 }
 summary.textContent='Last 24 hours: '+checked+' completed candles reviewed; '+rows.length+' candle setups matched the pattern and 2:1 target rules.'+(unverified?' '+unverified+' candles could not be verified.':'')+' This review uses candle closes, not historical executable quotes. It cannot prove an entry was available.';
 if(!rows.length){const item=document.createElement('li');item.textContent=checked?'No matching candle setup in the verified history.':'Not enough verified history to determine whether setups occurred.';list.append(item);}
 for(const e of rows.reverse()){const item=document.createElement('li');item.textContent=e.direction+' pattern · '+eat(e.candleClose)+' EAT · historical review only; entry expired.';list.append(item);}
 const failures=$('reviewFailures');if(failures){failures.replaceChildren(...[...blocked].sort((a,b)=>b[1]-a[1]).slice(0,4).map(([label,count])=>{const item=document.createElement('li');item.textContent='Not met in '+count+' candles: '+label;return item;}));}
}
async function history(){
 if(busy||!connected||Date.now()<retryNotBefore||Date.now()<boundaryRetryAt)return;
 const bucket=Math.floor(Date.now()/900000),fourHourBucket=Math.floor(Date.now()/14400000);
 if(historyOk&&lastHistoryBucket===bucket)return;
 busy=true;const g=generation;
 try{
  const b=await rpc({ticks_history:'frxXAUUSD',end:'latest',count:240,style:'candles',granularity:900});
  if(g!==generation)return;
  const recent=clean(b.candles??[]);
  if(h4.length<60||h4Bucket!==fourHourBucket){
   await new Promise(resolve=>setTimeout(resolve,1500));if(g!==generation)return;
   const a=await rpc({ticks_history:'frxXAUUSD',end:'latest',count:260,style:'candles',granularity:14400});
   if(g!==generation)return;h4=clean(a.candles??[]);h4Bucket=h4.filter(c=>c.epoch+14400<=Date.now()/1000).at(-1)?.epoch===(fourHourBucket-1)*14400?fourHourBucket:null;
  }
  m15=recent;await verifySchedules(m15.filter(c=>c.epoch+900<=Date.now()/1000),g);if(g!==generation)return;
  const completed=m15.filter(c=>c.epoch+900<=Date.now()/1000);
  historyOk=completed.at(-1)?.epoch===(bucket-1)*900;retryNotBefore=0;
  if(historyOk&&GoldHistory.continuity(completed,schedules).ok){lastHistoryBucket=bucket;boundaryRetryAt=0;}
  else boundaryRetryAt=Date.now()+((Date.now()/1000-(completed.at(-1)?.epoch??0)>2700)?60000:10000);
  reviewHistory();analyze();
 }catch(e){if(g===generation){historyOk=false;boundaryRetryAt=Date.now()+10000;if(/rate limit/i.test(e.message)){retryNotBefore=Date.now()+120000;wait('Deriv limited candle-history requests. Automatic retry is scheduled in two minutes.','History rate limited');}else wait(e.message,'Data unavailable');}}
 finally{if(g===generation)busy=false;}
}
function connect(endpointIndex=0){generation++;busy=false;historyOk=false;lastHistoryBucket=null;boundaryRetryAt=0;if(socket){socket.onclose=null;socket.close();}for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('Reconnecting'));}pending.clear();connected=false;tick=null;wait('Connecting to gold market data…','Connecting');$('feed').textContent='Connecting to Deriv…';socket=new WebSocket(endpoints[endpointIndex]);const current=socket;const timeout=setTimeout(()=>{if(current===socket&&!connected){current.close();wait('The market-data connection is unavailable. Tap Refresh to retry.','Offline');}},15000);socket.onopen=async()=>{if(current!==socket)return;clearTimeout(timeout);$('feed').textContent='Connected · requesting gold';connected=true;try{await rpc({ticks:'frxXAUUSD',subscribe:1});await history();}catch(e){if(current!==socket)return;if(endpointIndex+1<endpoints.length){connect(endpointIndex+1);return;}wait(e.message,'Data unavailable');}};socket.onmessage=e=>{if(current!==socket)return;let d;try{d=JSON.parse(e.data);}catch{return;}if(d.req_id&&pending.has(d.req_id)){const p=pending.get(d.req_id);pending.delete(d.req_id);clearTimeout(p.timer);d.error?p.reject(Error(d.error.message)):p.resolve(d);}if(d.tick&&Number.isFinite(d.tick.quote)&&Number.isFinite(d.tick.epoch)){tick=d.tick;if(activeSetup){const x=activeSetup,buy=x.direction==='BUY';if(tick.epoch>x.expiresAt||(buy?(tick.quote<=x.stopLoss||tick.quote>=x.takeProfit):(tick.quote>=x.stopLoss||tick.quote<=x.takeProfit)))expireSetup(x.candleClose-900);}$('price').textContent=fmt(tick.quote);$('feed').textContent='Deriv · reference price';$('updated').textContent='Last quote: '+new Date(tick.epoch*1000).toLocaleString('en-KE',{timeZone:'Africa/Nairobi'})+' EAT';analyze();}};socket.onerror=()=>{if(current===socket)$('feed').textContent='Connection failed';};socket.onclose=()=>{if(current!==socket)return;connected=false;if(endpointIndex+1<endpoints.length){connect(endpointIndex+1);return;}$('feed').textContent='Disconnected';wait('Market data disconnected. Tap Refresh to reconnect.','Offline');};}
$('refresh').onclick=()=>connect();setInterval(()=>{if(connected)history();},10000);setInterval(()=>{if(tick)analyze();},10000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)connect();});
if(document.modelContext?.registerTool){try{Promise.resolve(document.modelContext.registerTool({name:'read_gold_signal',description:'Read the current XAUUSD analysis. WAIT means no actionable setup or unavailable data.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:input=>{if(!input||Object.keys(input).length)throw Error('No arguments accepted');analyze();return {...result,quote:tick?.quote,quoteTime:tick?.epoch};}})).catch(()=>{});}catch{}}
connect();
