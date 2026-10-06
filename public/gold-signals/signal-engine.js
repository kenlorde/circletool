'use strict';
(function(root){
function atr(a){return a.slice(-14).reduce((sum,c,i)=>{const prev=a[a.length-14+i-1]?.close??c.open;return sum+Math.max(c.high-c.low,Math.abs(c.high-prev),Math.abs(c.low-prev));},0)/14;}
function ema(a,n){const k=2/(n+1);return a.reduce((value,c,i)=>i?value+k*(c.close-value):c.close,0);}
function levels(a,p){const lows=[],highs=[];for(let i=3;i<a.length-3;i++){const nearby=a.slice(i-3,i+4);if(nearby.every(c=>c===a[i]||c.low>a[i].low))lows.push(a[i].low);if(nearby.every(c=>c===a[i]||c.high<a[i].high))highs.push(a[i].high);}return {s:lows.filter(x=>x<p).sort((a,b)=>b-a)[0],r:highs.filter(x=>x>p).sort((a,b)=>a-b)[0]};}
function evaluate(a,b,entry){
 if(a.length<60||b.length<60)return {ready:false};
 const c=a.at(-1),prev=a.at(-2),v=atr(a),{s,r}=levels(b,prev.close),range=c.high-c.low,body=Math.abs(c.close-c.open),fmt=n=>Number.isFinite(n)?n.toFixed(2):'—';
 if(!Number.isFinite(s)||!Number.isFinite(r)||!Number.isFinite(v)||v<=0)return {ready:false,s,r};
const fast=ema(b.slice(-100),20),slow=ema(b.slice(-100),50),oldFast=ema(b.slice(-100,-1),20),trend=fast>slow&&fast>oldFast?'UP':fast<slow&&fast<oldFast?'DOWN':'FLAT';const z=.2*v;
const m15Ema=ema(a.slice(-60),20);
const buyChecks=[
 [trend==='UP','4H trend points upward (EMA 20/50 and slope).'],
 [c.close>m15Ema,'M15 close is above EMA 20.'],
 [range>=.5*v&&range<=2*v,'Candle size is between 0.5 and 2 ATR.'],
 [body>=.1*v,'Candle body is at least 0.1 ATR.'],
 [Math.min(c.open,c.close)-c.low>=body,'Lower rejection wick is at least the body size.'],
 [c.close>=c.low+.65*range,'Candle closes in the upper 35% of its range.'],
 [c.low<=s+z&&c.low>=s-v,'Candle tests support '+fmt(s)+' within the allowed zone.'],
 [c.close>s+z,'Candle closes back above the support zone.'],
 [c.close>c.open&&c.close>prev.close,'Bullish close exceeds the previous candle close.']
];
const sellChecks=[
 [trend==='DOWN','4H trend points downward (EMA 20/50 and slope).'],
 [c.close<m15Ema,'M15 close is below EMA 20.'],
 [range>=.5*v&&range<=2*v,'Candle size is between 0.5 and 2 ATR.'],
 [body>=.1*v,'Candle body is at least 0.1 ATR.'],
 [c.high-Math.max(c.open,c.close)>=body,'Upper rejection wick is at least the body size.'],
 [c.close<=c.low+.35*range,'Candle closes in the lower 35% of its range.'],
 [c.high>=r-z&&c.high<=r+v,'Candle tests resistance '+fmt(r)+' within the allowed zone.'],
 [c.close<r-z,'Candle closes back below the resistance zone.'],
 [c.close<c.open&&c.close<prev.close,'Bearish close is below the previous candle close.']
];

 const buy=buyChecks.every(([ok])=>ok),sell=sellChecks.every(([ok])=>ok);
 const side=trend==='DOWN'?'SELL':trend==='UP'?'BUY':'WAIT';
 const selected=side==='SELL'?sellChecks:buyChecks;
 const stopLoss=buy?Math.min(c.low,s-z)-.25*v:Math.max(c.high,r+z)+.25*v;
 const risk=buy?entry-stopLoss:stopLoss-entry,takeProfit=buy?entry+2*risk:entry-2*risk;
 const targetOk=Number.isFinite(entry)&&Number.isFinite(risk)&&risk>0&&(buy?takeProfit<=r-z:takeProfit>=s+z);
 return {ready:true,s,r,v,trend,side,buy,sell,selected,buyChecks,sellChecks,targetOk,direction:buy?'BUY':sell?'SELL':'WAIT',entry,stopLoss,takeProfit,candleClose:c.epoch+900,expiresAt:c.epoch+1080};
}
root.GoldSignal={evaluate,levels,atr,ema};
})(globalThis);
