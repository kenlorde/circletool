import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
const source = await readFile(new URL('../hooks/use-auth.ts', import.meta.url), 'utf8');
const loginStart = source.indexOf('  const login = useCallback(async () => {');
const loginEnd = source.indexOf('  // Invalidate unfinished',loginStart);
const loginCode = stripTypeScriptTypes(source.slice(loginStart,loginEnd));
test('original login and signup redirect without clearing an existing session',async()=>{
  const calls=[];
  const context={useCallback:fn=>fn,currentLang:'en',getAuthConfigWithReferral:async lang=>({clientId:'test',lang}),
    initiateLogin:async config=>calls.push(['login',config.lang]),initiateSignUp:async config=>calls.push(['signup',config.lang]),
    coreLogout:()=>{throw new Error('Login must not clear the session');},fetch:()=>{throw new Error('Login must not add a cookie deletion request');}};
  vm.createContext(context);vm.runInContext(loginCode+';globalThis.login=login;globalThis.signup=signUp;',context);
  await context.login();await context.signup();assert.deepEqual(calls,[['login','en'],['signup','en']]);
});
const storageSource = await readFile(new URL('../packages/core/src/auth/storage.ts', import.meta.url), 'utf8');
const storageCode = stripTypeScriptTypes(storageSource.replace(/^import .*;\n/m,'').replaceAll('export ',''));
test('expired tokens remain available only for the explicit refresh path', () => {
  const stored = new Map([['auth_info',JSON.stringify({access_token:'test', refresh_token:'refresh', expires_at:1})]]);
  const context = {localStorage:{getItem:k=>stored.get(k), removeItem:k=>stored.delete(k)},Date};
  vm.createContext(context); vm.runInContext(storageCode + ';globalThis.read=getAuthInfo;',context);
  assert.equal(context.read(),null); assert.equal(context.read(true).refresh_token,'refresh');
  stored.set('auth_info','bad json'); assert.equal(context.read(),null);
});
const logoutStart = source.indexOf('  const logout = useCallback(() => {');
const logoutCode = stripTypeScriptTypes('const logout = () => {' + source.slice(logoutStart + '  const logout = useCallback(() => {'.length, source.indexOf('\n  }, []);', logoutStart)) + '\n}; globalThis.logout = logout;');
test('logout clears local session immediately and waits for cookie removal before navigation', async () => {
  const events = []; let finish;
  const context = { loginRedirectPending:{current:false}, sessionVersion: {current:0}, authActionPending:{current:false}, activeAccountIdRef:{current:'real'},
    coreLogout:()=>events.push('clear'), cleanupUrl(){}, getAuthConfig:()=>({redirectUri:'https://circletool.pro'}),
    setAccounts(){},setActiveAccountId(){},setWsUrl(){},setAuthState(){},setError(){},
    AbortSignal, fetch:()=>new Promise(resolve=>{finish=resolve;}),window:{location:{replace:path=>events.push(path)}} };
  vm.createContext(context); vm.runInContext(logoutCode,context); context.logout();
  assert.deepEqual(events,['clear']); assert.equal(context.sessionVersion.current,1); assert.equal(context.activeAccountIdRef.current,null);
  finish({ok:true}); await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(events,['clear','/login']);
});
const recoveryStart=source.indexOf('    const recoverInterruptedLogin = () => {');
const recoveryEnd=source.indexOf('\n    const onVisibility',recoveryStart);
const recoveryCode=stripTypeScriptTypes(source.slice(recoveryStart,recoveryEnd)+';globalThis.recover=recoverInterruptedLogin;');
for(const callback of [false,true]) test(callback ? 'an incoming callback is not interrupted by recovery' : 'returning without a callback releases the login button',()=>{
  const states=[],errors=[];
  const context={loginRedirectPending:{current:true},authActionPending:{current:true},URL,
    window:{location:{href:callback?'https://circletool.pro/?code=test&state=test':'https://circletool.pro/login'}},
    setAuthState:v=>states.push(v),setError:v=>errors.push(v)};
  vm.createContext(context);vm.runInContext(recoveryCode,context);context.recover();
  assert.equal(context.authActionPending.current,callback);
  assert.equal(states.length,callback?0:1);assert.equal(errors.length,callback?0:1);
});

const watchdogStart = source.indexOf('  // Bound session restoration');
const watchdogEnd = source.indexOf('  // Keep ref in sync', watchdogStart);
const watchdogCode = stripTypeScriptTypes(source.slice(watchdogStart, watchdogEnd));
for (const pending of [false, true]) test(pending ? 'restoration watchdog leaves an explicit OAuth redirect alone' : 'restoration timeout releases login and invalidates late responses', () => {
  const events = []; let callback; let delay;
  const context = { useEffect: fn => fn(), authState:'authenticating', authActionPending:{current:pending},
    sessionVersion:{current:3}, setTimeout:(fn,ms)=>{callback=fn;delay=ms;return 1;},clearTimeout(){},
    clearAllAuthData:()=>events.push('clear'),setAccounts(){},setActiveAccountId(){},setWsUrl(){},
    cleanupUrl(){},getAuthConfig:()=>({redirectUri:'https://circletool.pro'}),
    setError:message=>events.push(message),setAuthState:state=>events.push(state) };
  vm.createContext(context);vm.runInContext(watchdogCode,context);
  if (pending) { assert.equal(callback,undefined);assert.equal(context.sessionVersion.current,3); }
  else { assert.equal(delay,25000);callback();assert.equal(context.sessionVersion.current,4);assert.equal(events.at(-1),'unauthenticated'); }
});

const completeStart = source.indexOf('    async (authInfo: AuthInfo, preferredAccountId?');
const completeEnd = source.indexOf('\n    },\n    [fetchOTPUrl]', completeStart);
const completeCode = stripTypeScriptTypes('const complete = '+source.slice(completeStart,completeEnd)+'};globalThis.complete=complete;');
test('an old account request cannot erase a newer OAuth transaction',async()=>{
  let finish; const events=[];
  const context={sessionVersion:{current:0},fetchAccounts:()=>new Promise(resolve=>{finish=resolve;}),getAuthConfig:()=>({clientId:'test'}),
    clearAllAuthData:()=>events.push('erased'),setAccounts:()=>events.push('accounts'),setActiveLoginId(){},setAccountType(){},setActiveAccountId(){},
    fetchOTPUrl:async()=> 'ws',setWsUrl(){},setAuthState(){}};
  vm.createContext(context);vm.runInContext(completeCode,context);
  const pending=context.complete({access_token:'old'});
  context.sessionVersion.current++;
  finish([{account_id:'old-account',account_type:'real'}]);await pending;
  assert.deepEqual(events,[]);
});
