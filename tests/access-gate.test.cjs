const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync('components/custom/access-gate.tsx','utf8');
const compiled = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function render(authState, wsUrl, error='', pathname='/smart-ai') {
  let index=0;const state=[false,false,error,0];
  const auth={authState,wsUrl,accounts:[],activeAccount:null};
  const context={exports:{},require(name){
    if(name==='react') return {useEffect(){},useState(){return [state[index++],()=>{}]}};
    if(name==='react/jsx-runtime')return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'fragment'};
    if(name==='next/navigation')return {usePathname:()=>pathname,useRouter:()=>({replace(){}})};
    if(name.includes('deriv-ws-provider'))return {useDerivWSContext:()=>({auth})};
    if(name.includes('logo-src-provider'))return {useLogoSrc:()=>''};
    return new Proxy({},{get:(_,key)=>key});
  }};
  vm.runInNewContext(compiled,context);
  return JSON.stringify(context.exports.AccessGate({children:'TRADING_CONTENT'}));
}
test('authenticated users see content despite failed server verification',()=>{
 const html=render('authenticated','wss://example','Temporary verification failure');
 assert.match(html,/TRADING_CONTENT/);assert.doesNotMatch(html,/Restricted access|Log in to continue/);
});
test('authenticated users reconnecting their socket remain unlocked',()=>{
 const html=render('authenticated',undefined);assert.match(html,/TRADING_CONTENT/);assert.doesNotMatch(html,/Restricted access/);
});
test('session restoration shows a loading state, not a login restriction',()=>{
 const html=render('authenticating',undefined);assert.match(html,/Restoring your session/);assert.doesNotMatch(html,/Restricted access|TRADING_CONTENT/);
});
test('signed-out users and failed logins cannot see protected content',()=>{
 for(const status of ['unauthenticated','error']) {const html=render(status,undefined);assert.match(html,/Restricted access/);assert.doesNotMatch(html,/TRADING_CONTENT/);}
});
test('authenticated login route shows transition without a restricted notice',()=>{
 const html=render('authenticated','wss://example','','/login');assert.doesNotMatch(html,/Restricted access|TRADING_CONTENT/);
});
