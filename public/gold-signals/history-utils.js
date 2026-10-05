'use strict';
(function(root){
 const DAY=86400,STEP=900,dateOf=epoch=>new Date(epoch*1000).toISOString().slice(0,10);
 function gaps(candles,n=30){const tail=candles.slice(-n);return tail.slice(1).flatMap((c,i)=>{const previous=tail[i];return c.epoch-previous.epoch===STEP?[]:[{start:previous.epoch+STEP,end:c.epoch}];});}
 function gapDates(candles){const dates=new Set();for(const gap of gaps(candles)){if(gap.end<=gap.start||gap.end-gap.start>7*DAY)continue;for(let day=Math.floor(gap.start/DAY)*DAY;day<gap.end;day+=DAY)dates.add(dateOf(day));}return [...dates];}
 function findGold(value){if(!value||typeof value!=='object')return null;if(value.underlying_symbol==='frxXAUUSD'||value.symbol==='frxXAUUSD')return value;for(const child of Object.values(value)){const found=findGold(child);if(found)return found;}return null;}
 function seconds(time){if(!/^\d{2}:\d{2}:\d{2}$/.test(time))return null;const [h,m,s]=time.split(':').map(Number);return h<=24&&m<60&&s<60?h*3600+m*60+s:null;}
 function sessions(response,date){const symbol=findGold(response.trading_times);if(!symbol?.times)return null;const open=symbol.times.open,close=symbol.times.close;if(!Array.isArray(open)||!Array.isArray(close)||open.length!==close.length)return null;
  if(open.length===1&&open[0]==='--'&&close[0]==='--')return [];
  const base=Date.parse(date+'T00:00:00Z')/1000,result=[];
  if(!Number.isFinite(base))return null;
  for(let i=0;i<open.length;i++){const a=seconds(open[i]),b=seconds(close[i]);if(a===null||b===null||b<a)return null;result.push({start:base+a,end:base+(b===86399?DAY:b)});}return result;
 }
 function continuity(candles,schedules){const missing=gaps(candles);let closures=0;
  for(const gap of missing){if(gap.end<=gap.start||gap.end-gap.start>7*DAY)return {ok:false,closures,reason:'Unexpected candle timestamps'};
   for(let day=Math.floor(gap.start/DAY)*DAY;day<gap.end;day+=DAY){const key=dateOf(day),hours=schedules.get(key);if(!hours)return {ok:false,closures,reason:'Trading hours could not be verified'};
    const start=Math.max(day,gap.start),end=Math.min(day+DAY,gap.end);if(hours.some(session=>session.start<end&&session.end>start))return {ok:false,closures,reason:'Candles are missing during an open trading session'};
   }closures++;
  }
  return {ok:true,closures,reason:closures?'Scheduled market closures verified':'Recent candles complete'};
 }
 root.GoldHistory={gaps,gapDates,sessions,continuity};
})(globalThis);
