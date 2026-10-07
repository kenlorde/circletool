import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
const source = await readFile(new URL('../hooks/use-auth.ts', import.meta.url), 'utf8');
const start = source.indexOf('async (signUp = false) =>');
const action = stripTypeScriptTypes('const startAuth = ' + source.slice(start, source.indexOf('}, [currentLang]);', start) + 1) + '; globalThis.startAuth = startAuth;');
function setup(resolveConfig) {
  const states = [], redirects = [];
  const context = { authActionPending: { current: false }, sessionVersion: { current: 0 }, currentLang: 'en',
    setError() {}, setAuthState: value => states.push(value), getAuthConfigWithReferral: resolveConfig,
    initiateLogin: async () => redirects.push('login'), initiateSignUp: async () => redirects.push('signup') };
  vm.createContext(context); vm.runInContext(action, context);
  return { context, states, redirects };
}
test('rapid login taps start one OAuth redirect', async () => {
  let finish;
  const flow = setup(() => new Promise(resolve => { finish = resolve; }));
  const first = flow.context.startAuth(); await flow.context.startAuth();
  finish({clientId:'test'}); await first;
  assert.deepEqual(flow.redirects, ['login']);
});
test('logout cancels a pending login redirect', async () => {
  let finish;
  const flow = setup(() => new Promise(resolve => { finish = resolve; }));
  const first = flow.context.startAuth(); flow.context.sessionVersion.current++;
  finish({clientId:'test'}); await first;
  assert.deepEqual(flow.redirects, []);
});
test('failed login releases the lock and allows retry', async () => {
  let attempt = 0;
  const flow = setup(async () => { if (!attempt++) throw new Error('Network failed'); return {clientId:'test'}; });
  await flow.context.startAuth();
  assert.equal(flow.context.authActionPending.current,false);
  assert.equal(flow.states.at(-1),'unauthenticated');
  await flow.context.startAuth(); assert.deepEqual(flow.redirects,['login']);
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
  const context = { sessionVersion: {current:0}, authActionPending:{current:false}, activeAccountIdRef:{current:'real'},
    coreLogout:()=>events.push('clear'), cleanupUrl(){}, getAuthConfig:()=>({redirectUri:'https://circletool.pro'}),
    setAccounts(){},setActiveAccountId(){},setWsUrl(){},setAuthState(){},setError(){},
    AbortSignal, fetch:()=>new Promise(resolve=>{finish=resolve;}),window:{location:{replace:path=>events.push(path)}} };
  vm.createContext(context); vm.runInContext(logoutCode,context); context.logout();
  assert.deepEqual(events,['clear']); assert.equal(context.sessionVersion.current,1); assert.equal(context.activeAccountIdRef.current,null);
  finish({ok:true}); await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(events,['clear','/login']);
});
