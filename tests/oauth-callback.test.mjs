import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
const source=await readFile(new URL('../packages/core/src/auth/oauth.ts',import.meta.url),'utf8');
const code=stripTypeScriptTypes(source.slice(source.indexOf('/**')).replaceAll('export ',''));
function setup(){
 const calls=[];let saved=null;let cleared=false;
 const context={URL,URLSearchParams,AbortSignal,Date,window:{location:{href:'https://www.circletool.pro/?code=valid-code&state=expected'},history:{state:null,replaceState(){}}},
 getCSRFToken:()=> 'expected',clearCSRFToken(){},getCodeVerifier:()=> 'v'.repeat(43),clearCodeVerifier(){cleared=true;},
 clearAllAuthData(){},storeAuthInfo:info=>{saved=info;},getAuthBaseUrl:()=>{throw new Error('Browser must not exchange tokens directly with Deriv');},
 fetch:async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({access_token:'verified-token',refresh_token:'refresh',expires_in:3600,token_type:'Bearer',scope:'trade'})};}};
 vm.createContext(context);vm.runInContext(code+';globalThis.api={handleOAuthCallback,refreshAccessToken};',context);
 return {context,calls,saved:()=>saved,cleared:()=>cleared};
}
test('return to Circletool exchanges the original callback through its server and stores the session',async()=>{
 const f=setup();const result=await f.context.api.handleOAuthCallback(f.context.window.location.href,{clientId:'app',redirectUri:'https://circletool.pro'});
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].url,'/api/deriv-token');
 const body=new URLSearchParams(f.calls[0].options.body);assert.equal(body.get('code'),'valid-code');assert.equal(body.get('code_verifier'),'v'.repeat(43));assert.equal(body.get('redirect_uri'),'https://circletool.pro');
 assert.equal(result.access_token,'verified-token');assert.equal(f.saved().access_token,'verified-token');assert.equal(f.cleared(),true);
});
test('wrong callback state cannot contact the token endpoint',async()=>{
 const f=setup();await assert.rejects(f.context.api.handleOAuthCallback('https://circletool.pro/?code=valid-code&state=wrong',{clientId:'app',redirectUri:'https://circletool.pro'}),/CSRF token mismatch/);assert.equal(f.calls.length,0);assert.equal(f.saved(),null);
});
test('expired-session refresh also uses the Circletool server',async()=>{
 const f=setup();await f.context.api.refreshAccessToken('refresh','app');assert.equal(f.calls[0].url,'/api/deriv-token');assert.equal(new URLSearchParams(f.calls[0].options.body).get('grant_type'),'refresh_token');
});
