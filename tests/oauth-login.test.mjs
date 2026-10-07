import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
const source = await readFile(new URL('../packages/core/src/auth/oauth.ts',import.meta.url),'utf8');
const functions = source.slice(source.indexOf('async function buildPkceParams'), source.indexOf('/**\n * Initiate login'));
const code = stripTypeScriptTypes(functions.replaceAll('export ',''));
test('login requests fresh authentication with new PKCE state; signup keeps registration',async()=>{
  let counter=0; const states=[],verifiers=[];
  const context={URLSearchParams,generateRandomBase64url:()=>`random-${++counter}`,sha256Base64url:async v=>`hash-${v}`,
    storeCSRFToken:v=>states.push(v),storeCodeVerifier:v=>verifiers.push(v),getAuthBaseUrl:()=> 'https://auth.deriv.com/oauth2'};
  vm.createContext(context);vm.runInContext(code+';globalThis.login=buildAuthorizationUrl;globalThis.signup=buildSignUpUrl;',context);
  const config={clientId:'test',redirectUri:'https://circletool.pro'};
  const first=new URL(await context.login(config)),second=new URL(await context.login(config)),signup=new URL(await context.signup(config));
  assert.equal(first.searchParams.get('prompt'),'login');assert.equal(first.searchParams.get('max_age'),'0');
  assert.notEqual(first.searchParams.get('state'),second.searchParams.get('state'));
  assert.equal(first.searchParams.get('code_challenge_method'),'S256');
  assert.equal(signup.searchParams.get('prompt'),'registration');assert.equal(signup.searchParams.has('max_age'),false);
  assert.equal(states.length,3);assert.equal(verifiers.length,3);
});
