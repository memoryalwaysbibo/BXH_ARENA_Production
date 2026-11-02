'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../modules/cloud/cloud-runtime.js'), 'utf8');

function harness(overrides = {}) {
  const storage = new Map();
  const user = { uid: 'new-google', email: 'new@example.invalid', providerData: [{ providerId: 'google.com' }] };
  const calls = { popup: 0, redirect: 0, callable: 0, read: 0 };
  const context = {
    window: {}, authReady: true, authHandle: { currentUser: user }, functionsHandle: {}, dbHandle: {},
    sessionStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    ax: {
      GoogleAuthProvider: class { setCustomParameters() {} }, browserPopupRedirectResolver: {},
      signInWithPopup() { calls.popup++; return Promise.resolve({ user }); },
      signInWithRedirect() { calls.redirect++; return Promise.resolve(); },
    },
    fx: { doc: (_db, _collection, uid) => uid, getDocFromServer: async () => { calls.read++; return { exists: () => true, data: () => ({ uid: user.uid, role: 'player', active: true, gameId: '', phone: '' }) }; } },
    fnx: { httpsCallable: (_handle, name) => async data => { assert.equal(name, 'ensureGooglePlayerProfile'); assert.equal(Object.keys(data).length, 0); calls.callable++; return { data: { ok: true, uid: user.uid, created: true } }; } },
    console, ...overrides,
  };
  vm.createContext(context);
  const start = source.indexOf('  const USERS_COLLECTION =');
  const end = source.indexOf('\n  // v13.29.3', start);
  assert.ok(start >= 0 && end > start, 'shipped cloudAuth source is available');
  vm.runInContext(source.slice(start, end), context);
  return { context, api: context.window.cloudAuth, calls, storage, user };
}

test('Google popup starts synchronously in the tap and returns the same Firebase UID', async () => {
  const { api, calls } = harness();
  const promise = api.signInWithGoogle();
  assert.equal(calls.popup, 1);
  assert.equal((await promise).uid, 'new-google');
  assert.equal(calls.callable, 0, 'auth callback owns profile creation');
});

test('manual session recovery keeps the login identity used by reminder deferral', () => {
  const { api, user } = harness();
  user.metadata = { lastSignInTime: 'fixed-login-time' };
  assert.equal(api.getCurrentUser().metadata.lastSignInTime, 'fixed-login-time');
});

test('blocked popup uses the separate player redirect marker', async () => {
  const { api, context, calls, storage } = harness();
  storage.set('bxh_google_link_redirect_v1', JSON.stringify({ uid: 'old-user', email: 'old@example.invalid' }));
  context.ax.signInWithPopup = async () => { throw { code: 'auth/popup-blocked' }; };
  assert.equal((await api.signInWithGoogle()).redirecting, true);
  assert.equal(calls.redirect, 1);
  assert.equal(storage.get('bxh_google_signin_redirect_v1'), 'player');
  assert.equal(storage.has('bxh_google_link_redirect_v1'), false);
});

test('cancel and existing-provider conflict do not start a redirect or create a profile', async () => {
  for (const code of ['auth/popup-closed-by-user', 'auth/account-exists-with-different-credential']) {
    const { api, context, calls } = harness();
    context.ax.signInWithPopup = async () => { throw { code }; };
    const result = await api.signInWithGoogle();
    assert.equal(result.ok, false);
    assert.match(result.error, code.includes('popup') ? /已取消/ : /原帳密登入/);
    assert.equal(calls.redirect, 0);
    assert.equal(calls.callable, 0);
  }
});

test('concurrent auth callbacks share one server operation and confirm the profile from the server', async () => {
  const { api, calls } = harness();
  const results = await Promise.all([api.ensureGooglePlayerProfile('new-google'), api.ensureGooglePlayerProfile('new-google')]);
  assert.equal(calls.callable, 1);
  assert.equal(calls.read, 1);
  assert.ok(results.every(result => result.ok && result.created));
  assert.equal(results[0].profile.gameId, '');
});

test('a changed Firebase session cannot use a late creation result or read the old profile', async () => {
  const { api, context, calls } = harness();
  let resolve;
  context.fnx.httpsCallable = () => () => new Promise(done => { resolve = done; });
  const pending = api.ensureGooglePlayerProfile('new-google');
  context.authHandle.currentUser = { uid: 'other', providerData: [{ providerId: 'google.com' }] };
  resolve({ data: { ok: true, uid: 'new-google', created: true } });
  assert.equal((await pending).ok, false);
  assert.equal(calls.read, 0);
  assert.equal((await api.ensureGooglePlayerProfile('new-google')).ok, false);
});

test('failed server confirmation stays an error and the next explicit retry can succeed', async () => {
  const { api, context, calls } = harness();
  const original = context.fx.getDocFromServer;
  context.fx.getDocFromServer = async () => { throw Error('unavailable'); };
  assert.equal((await api.ensureGooglePlayerProfile('new-google')).ok, false);
  context.fx.getDocFromServer = original;
  assert.equal((await api.ensureGooglePlayerProfile('new-google')).ok, true);
  assert.equal(calls.callable, 2);
});

test('sign-in redirect returns once and clears only its own marker', async () => {
  const { context, storage } = harness();
  storage.set('bxh_google_signin_redirect_v1', 'player');
  storage.set('bxh_google_link_redirect_v1', 'keep');
  context.ax.getRedirectResult = async () => ({ user: { uid: 'redirect-google' } });
  const start = source.indexOf('        let signInRedirect = false;');
  const end = source.indexOf('        return true;', start);
  assert.ok(start >= 0 && end > start);
  await vm.runInContext('(async () => {' + source.slice(start, end) + '})()', context);
  assert.equal(context.window.cloudAuth.consumeGoogleSignInRedirectOutcome().ok, true);
  assert.equal(context.window.cloudAuth.consumeGoogleSignInRedirectOutcome(), null);
  assert.equal(storage.has('bxh_google_signin_redirect_v1'), false);
  assert.equal(storage.get('bxh_google_link_redirect_v1'), 'keep');
});

test('a returned signup redirect cannot be consumed as an abandoned Google link attempt', async () => {
  const { context, storage } = harness();
  storage.set('bxh_google_signin_redirect_v1', 'player');
  storage.set('bxh_google_link_redirect_v1', JSON.stringify({ uid: 'old-user', email: 'old@example.invalid' }));
  let reads = 0;
  context.ax.getRedirectResult = async () => { reads++; return { user: { uid: 'new-google' } }; };
  const start = source.indexOf('        let redirectContext = null;');
  const end = source.indexOf('        return true;', start);
  assert.ok(start >= 0 && end > start);
  await vm.runInContext('(async () => {' + source.slice(start, end) + '})()', context);
  assert.equal(reads, 1);
  assert.equal(context.window.cloudAuth.consumeGoogleSignInRedirectOutcome().ok, true);
  assert.equal(storage.has('bxh_google_link_redirect_v1'), false);
  assert.equal(storage.has('bxh_google_signin_redirect_v1'), false);
});
