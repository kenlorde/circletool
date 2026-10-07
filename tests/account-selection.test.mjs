import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
const source = await readFile(new URL('../hooks/use-auth.ts', import.meta.url), 'utf8');
const start = source.indexOf('async (authInfo: AuthInfo, preferredAccountId?');
const completion = stripTypeScriptTypes('const completeAuth = ' + source.slice(start, source.indexOf('\n    },\n    [fetchOTPUrl]', start) + 6) + ';');
const real = { account_id: 'real-1', account_type: 'real' };
const demo = { account_id: 'demo-1', account_type: 'demo' };
for (const [name, accounts, preferred, expected] of [
  ['fresh login prefers real even when demo is listed first', [demo, real], undefined, real],
  ['restoring a session preserves an explicitly selected demo', [demo, real], demo.account_id, demo],
  ['stale stored selection falls back to real', [demo, real], 'removed', real],
  ['demo-only login retains an honestly labeled demo', [demo], undefined, demo],
]) {
  test(name, async () => {
    const selected = {};
    const context = { fetchAccounts: async () => accounts, getAuthConfig: () => ({clientId: 'test'}),
      setAccounts() {}, setActiveLoginId: id => selected.storedId = id,
      setAccountType: type => selected.type = type, setActiveAccountId: id => selected.id = id,
      fetchOTPUrl: async id => { selected.otpAccount = id; return 'wss://test'; }, setWsUrl() {}, setAuthState() {} };
    vm.createContext(context); vm.runInContext(completion + '\nglobalThis.completeAuth = completeAuth;', context);
    await context.completeAuth({}, preferred);
    assert.equal(selected.id, expected.account_id); assert.equal(selected.type, expected.account_type);
    assert.equal(selected.otpAccount, expected.account_id); assert.equal(selected.storedId, expected.account_id);
  });
}
