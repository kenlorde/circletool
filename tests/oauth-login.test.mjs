import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
const source = await readFile(new URL('../packages/core/src/auth/oauth.ts',import.meta.url),'utf8');
const functions = source.slice(source.indexOf('async function buildPkceParams'), source.indexOf('/**\n * Initiate login'));
const code = stripTypeScriptTypes(functions.replaceAll('export ',''));
test('login uses documented OAuth parameters with new PKCE state; signup keeps registration',async()=>{
  let counter=0; const states=[],verifiers=[];
  const context={URLSearchParams,generateRandomBase64url:()=>`random-${++counter}`,sha256Base64url:async v=>`hash-${v}`,
    storeCSRFToken:v=>states.push(v),storeCodeVerifier:v=>verifiers.push(v),getAuthBaseUrl:()=> 'https://auth.deriv.com/oauth2'};
  vm.createContext(context);vm.runInContext(code+';globalThis.login=buildAuthorizationUrl;globalThis.signup=buildSignUpUrl;',context);
  const config={clientId:'34sx1mCIH1fzAzMm8Ou9Q',redirectUri:'https://circletool.pro',affiliateToken:'referral',utmSource:'partner',lang:'en'};
  const first=new URL(await context.login(config)),second=new URL(await context.login(config)),signup=new URL(await context.signup(config));
  assert.equal(first.searchParams.get('client_id'),config.clientId);
  assert.equal(first.searchParams.get('redirect_uri'),'https://circletool.pro');
  assert.equal(first.searchParams.get('lang'),'EN');
  assert.equal(first.searchParams.get('t'),'referral');
  assert.equal(first.searchParams.get('utm_source'),'partner');
  assert.equal(signup.searchParams.get('t'),'referral');
  assert.equal(first.searchParams.has('prompt'),false);assert.equal(first.searchParams.has('max_age'),false);
  assert.notEqual(first.searchParams.get('state'),second.searchParams.get('state'));
  assert.equal(first.searchParams.get('code_challenge_method'),'S256');
  assert.equal(signup.searchParams.get('prompt'),'registration');assert.equal(signup.searchParams.has('max_age'),false);
  assert.equal(states.length,3);assert.equal(verifiers.length,3);
});

const hookSource = await readFile(new URL('../hooks/use-auth.ts',import.meta.url),'utf8');
const configCode = stripTypeScriptTypes(hookSource.slice(hookSource.indexOf('function getAuthConfig('),hookSource.indexOf('// Start the Scaleo')));
test('callback configuration keeps registered casing and trailing slash exactly',()=>{
  for (const redirectUri of ['https://Circletool.pro','https://circletool.pro/','https://www.circletool.pro/']) {
    const context={process:{env:{NEXT_PUBLIC_DERIV_APP_ID:'app',NEXT_PUBLIC_DERIV_REDIRECT_URI:redirectUri}},readStoredLanguage:()=>null,parseLandingParams:()=>null};
    vm.createContext(context);vm.runInContext(configCode+';globalThis.config=getAuthConfig;',context);
    assert.equal(context.config().redirectUri,redirectUri);
  }
});
const storageSource=await readFile(new URL('../packages/core/src/auth/storage.ts',import.meta.url),'utf8');
const storageCode=stripTypeScriptTypes(storageSource.replace(/^import .*;\n/m,'').replaceAll('export ',''));
function storage(map){return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};}
test('new-tab callback restores PKCE, then removes it from both storage locations',()=>{
  const session=new Map(),shared=new Map();
  const context={sessionStorage:storage(session),localStorage:storage(shared),Date};
  vm.createContext(context);vm.runInContext(storageCode+';globalThis.api={storeCSRFToken,storeCodeVerifier,getCSRFToken,getCodeVerifier,clearCSRFToken,clearCodeVerifier};',context);
  context.api.storeCSRFToken('state');context.api.storeCodeVerifier('verifier');session.clear();
  assert.equal(context.api.getCSRFToken(),'state');assert.equal(context.api.getCodeVerifier(),'verifier');
  context.api.clearCSRFToken();context.api.clearCodeVerifier();assert.equal(shared.size,0);
});
test('expired PKCE fallback cannot complete a new-tab callback',()=>{
  const session=new Map(),shared=new Map([['oauth_csrf_token',JSON.stringify({value:'old',createdAt:Date.now()-600001})],['oauth_code_verifier',JSON.stringify({value:'old',createdAt:Date.now()-600001})]]);
  const context={sessionStorage:storage(session),localStorage:storage(shared),Date};
  vm.createContext(context);vm.runInContext(storageCode+';globalThis.api={getCSRFToken,getCodeVerifier};',context);
  assert.equal(context.api.getCSRFToken(),null);assert.equal(context.api.getCodeVerifier(),null);assert.equal(shared.size,0);
});
