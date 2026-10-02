'use strict';
// Exercise the shipped inline handlers and reward client without Firebase or
// production accounts. Deferred responses make stale-read races deterministic.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'modules/main-app/core.js'), 'utf8');\nconst mailbox = fs.readFileSync(path.join(root, 'modules/main-app/mailbox.js'), 'utf8');\nconst albumFeature = fs.readFileSync(path.join(root, 'modules/main-app/card-album.js'), 'utf8');\nconst html = core;
function section(start, end) {
  const at = html.indexOf(start), until = html.indexOf(end, at);
  assert.ok(at >= 0 && until > at, `missing source section: ${start}`);
  return html.slice(at, until);
}
const source = [
  section('let mailboxState=null;', 'function mailboxButtonHtml()'),
  section('async function handleMailbox(action,target)', '// 卡冊的畫面只相信'),
  section('const CARD_ALBUM_CARDS=', 'function renderPlayerCenterLoggedIn()')
].join('\n');
const rewardSource = fs.readFileSync(path.join(root, 'card-reward-mail.js'), 'utf8');
const album = quantity => ({ ok: true, sets: { basic: { seal: 1 }, gods: { seal: quantity } }, octoberCompleted: 2 });
const trades = () => ({ ok: true, incoming: [], outgoing: [] });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function tick() { await new Promise(resolve => setImmediate(resolve)); }
function setup({ installBridge = true } = {}) {
  const calls = [], toasts = [], listeners = {}, scheduled = [];
  let quantity = 1, get = async () => album(quantity), list = async () => trades();
  let claim = async () => { quantity = 2; return { ok: true, card: { id: 'seal', setId: 'gods' } }; };
  const sandbox = {
    firebaseUser: { uid: 'player-a' }, engagementSessionEpoch: 1,
    currentAuthUid: () => sandbox.firebaseUser?.uid || '', playerActiveTab: 'cards', accountMenuOpen: false,
    render() {}, renderPreservingScroll() {}, showToast: (...args) => toasts.push(args),
    setTimeout: fn => { scheduled.push(fn); },
    esc: value => String(value ?? ''),
    document: { addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); }, getElementById: () => null },
    window: { engagementService: {
      cardAlbum: payload => { calls.push(payload.action); return payload.action === 'get' ? get() : list(); },
      claimCardReward: payload => { calls.push('claim'); return claim(payload); },
      mailbox: async () => { calls.push('mailbox'); return { ok: true, messages: [], unreadCount: 0 }; }
    } }
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'card-album-inline.js' });
  const install = () => vm.runInContext(rewardSource, sandbox, { filename: 'card-reward-mail.js' });
  if (installBridge) install();
  const target = { getAttribute: name => name === 'data-message-id' ? 'mail-1' : null };
  return {
    sandbox, calls, toasts, listeners, scheduled, install,
    state: () => sandbox.cardAlbumContext(), mail: () => sandbox.mailboxContext(),
    load: refresh => sandbox.loadCardAlbum(refresh),
    claim: () => sandbox.handleMailbox('mailbox-card-reward', target),
    view: () => sandbox.renderCardAlbumPage(),
    get: fn => { get = fn; }, list: fn => { list = fn; }, onClaim: fn => { claim = fn; },
    switchUser(uid) { sandbox.firebaseUser = uid ? { uid } : null; sandbox.engagementSessionEpoch++; }
  };
}

test('claim refreshes a cached duplicate from the server and exposes the new quantity', async () => {
  const t = setup(); await t.load();
  assert.match(t.view(), /諸神戰場 附魔封印，持有 1 張/);
  await t.claim();
  assert.deepEqual(t.calls, ['get', 'list', 'claim', 'get', 'list', 'mailbox']);
  assert.equal(t.state().data.sets.gods.seal, 2);
  assert.match(t.view(), /諸神戰場 附魔封印，持有 2 張/);
  assert.match(t.view(), /card-album-count">×2/);
  assert.match(t.view(), /已擁有 1\/12/);
  assert.equal(t.state().data.sets.basic.seal, 1);
  assert.equal(t.toasts.length, 1);
});

test('replayed claims reread authoritative quantity without incrementing twice', async () => {
  const t = setup(); t.get(async () => album(2));
  t.onClaim(async () => ({ ok: true, alreadyClaimed: true, card: { id: 'seal', setId: 'gods' } }));
  await t.load(); await t.claim(); await t.claim();
  assert.equal(t.state().data.sets.gods.seal, 2);
  assert.equal(t.calls.filter(action => action === 'get').length, 3);
});

test('claim discards cached data before refresh resolves and never uses claimed card quantity', async () => {
  const t = setup(); await t.load(); const next = deferred(); t.get(() => next.promise);
  t.onClaim(async () => ({ ok: true, card: { id: 'seal', setId: 'gods', quantity: 99 } }));
  const pending = t.claim(); await tick();
  assert.equal(t.state().data, null);
  assert.equal(t.state().trades, null);
  assert.doesNotMatch(t.view(), /card-album-count/);
  assert.match(t.view(), /讀取收藏中/);
  next.resolve(album(2)); await pending; await tick();
  assert.equal(t.state().data.sets.gods.seal, 2);
});

test('claim starts a new read during an older in-flight read; late old success cannot restore stale counts', async () => {
  const t = setup(), old = deferred(); t.get(() => old.promise);
  const first = t.load(); t.get(async () => album(2));
  await t.claim(); old.resolve(album(1)); await first;
  assert.equal(t.state().data.sets.gods.seal, 2);
  assert.equal(t.state().loading, false);
  assert.equal(t.calls.filter(action => action === 'get').length, 2);
});

test('late obsolete failure cannot clear the newer request loading flag or show an error', async () => {
  const t = setup(), old = deferred(), next = deferred(); t.get(() => old.promise);
  const first = t.load(); t.get(() => next.promise); const second = t.load(true);
  old.reject(Error('old failure')); await first;
  assert.equal(t.state().loading, true); assert.equal(t.state().error, '');
  next.resolve(album(2)); await second;
  assert.equal(t.state().data.sets.gods.seal, 2);
});

test('latest forced refresh wins when reads finish out of order', async () => {
  const t = setup(), first = deferred(), second = deferred();
  t.get(() => first.promise); const a = t.load(true);
  t.get(() => second.promise); const b = t.load(true);
  second.resolve(album(3)); await b; first.resolve(album(2)); await a;
  assert.equal(t.state().data.sets.gods.seal, 3);
});

test('non-forced repeated loads share the current request and retain a valid cache', async () => {
  const t = setup(), next = deferred(); t.get(() => next.promise);
  const pending = t.load(); await t.load(); await t.load();
  assert.deepEqual(t.calls, ['get', 'list']);
  next.resolve(album(2)); await pending; await t.load();
  assert.deepEqual(t.calls, ['get', 'list']);
});

test('failed refresh leaves no stale counts, releases loading, and supports explicit retry', async () => {
  const t = setup(); await t.load(); t.get(async () => { throw Error('network timeout'); });
  await t.claim();
  assert.equal(t.state().data, null); assert.equal(t.state().loading, false);
  assert.match(t.view(), /卡冊讀取失敗/);
  assert.doesNotMatch(t.view(), /card-album-count/);
  t.get(async () => album(2)); await t.load(true);
  assert.equal(t.state().error, ''); assert.equal(t.state().data.sets.gods.seal, 2);
});

test('failed or malformed server reads are not cached as authoritative inventory', async () => {
  for (const invalid of [{ ok: false }, { ok: true }]) {
    const t = setup(); t.get(async () => invalid); await t.load();
    assert.equal(t.state().data, null); assert.match(t.state().error, /卡冊/);
  }
  const t = setup(); t.list(async () => ({ ok: false })); await t.load();
  assert.equal(t.state().data, null); assert.match(t.state().error, /卡冊/);
});

test('changing UID while claiming cannot reload or toast in another account', async () => {
  const t = setup(), reward = deferred(); await t.load(); t.onClaim(() => reward.promise);
  const pending = t.claim(); t.switchUser('player-b');
  reward.resolve({ ok: true, card: { id: 'seal', setId: 'gods' } }); await pending;
  assert.deepEqual(t.calls, ['get', 'list', 'claim']); assert.equal(t.toasts.length, 0);
  assert.equal(t.state().uid, 'player-b'); assert.equal(t.state().data, null);
  assert.equal(t.mail().busy, false); assert.equal(t.mail().error, '');
});

test('logout and same-UID login invalidate old album and claim responses even without intervening render', async () => {
  const t = setup(), old = deferred(), reward = deferred();
  t.get(() => old.promise); const load = t.load();
  t.onClaim(() => reward.promise); const claim = t.claim();
  t.switchUser(null); t.switchUser('player-a');
  old.resolve(album(99)); reward.resolve({ ok: true, card: { id: 'seal' } });
  await Promise.all([load, claim]);
  assert.equal(t.state().data, null); assert.equal(t.toasts.length, 0);
  assert.equal(t.calls.filter(action => action === 'get').length, 1);
});

test('obsolete account failures cannot change a new account read or mailbox error', async () => {
  const t = setup(), old = deferred(), reward = deferred(), next = deferred();
  t.get(() => old.promise); const load = t.load(); t.onClaim(() => reward.promise); const claim = t.claim();
  t.switchUser('player-b'); t.get(() => next.promise); const latest = t.load();
  old.reject(Error('old album failure')); reward.reject(Error('old claim failure'));
  await Promise.all([load, claim]);
  assert.equal(t.state().loading, true); assert.equal(t.state().error, ''); assert.equal(t.mail().error, '');
  next.resolve(album(4)); await latest;
  assert.equal(t.state().data.sets.gods.seal, 4);
});

test('claim refresh preserves newer navigation and reopening the album shows fresh quantity', async () => {
  const t = setup(), reward = deferred(); await t.load(); t.mail().open = true;
  t.onClaim(() => reward.promise); const pending = t.claim();
  t.sandbox.playerActiveTab = 'home'; t.mail().open = false;
  t.get(async () => album(2)); reward.resolve({ ok: true, card: { id: 'seal' } }); await pending;
  assert.equal(t.sandbox.playerActiveTab, 'home'); assert.equal(t.mail().open, false);
  t.sandbox.playerActiveTab = 'cards';
  assert.match(t.view(), /諸神戰場 附魔封印，持有 2 張/);
});

test('double click does not send two claim calls, and rejected claims remain retryable', async () => {
  const t = setup(), reward = deferred(); await t.load(); t.onClaim(() => reward.promise);
  const first = t.claim(); await t.claim(); assert.equal(t.calls.filter(x => x === 'claim').length, 1);
  reward.reject(Error('network timeout')); await first;
  assert.equal(t.mail().busy, false); assert.notEqual(t.mail().error, '');
  t.onClaim(async () => ({ ok: true, alreadyClaimed: true, card: { id: 'seal' } }));
  t.get(async () => album(2)); await t.claim();
  assert.equal(t.state().data.sets.gods.seal, 2); assert.equal(t.mail().error, '');
});

test('logout does not fetch an album and resets any previous account preview', async () => {
  const t = setup(); await t.load();
  vm.runInContext('cardAlbumPreview={set:"gods",card:"seal"}', t.sandbox);
  assert.match(t.view(), /role="dialog"/);
  t.switchUser(null); await t.load(true);
  assert.deepEqual(t.calls, ['get', 'list']); assert.doesNotMatch(t.view(), /role="dialog"/);
});

// A slow album read must not retain the first claim handler after its mailbox
// reload, then accidentally unlock a later claim when that old read completes.
test('slow album refresh cannot clear a newer claim busy state', async () => {
  const t = setup(), oldAlbum = deferred(), secondClaim = deferred();
  t.get(() => oldAlbum.promise);
  const first = t.claim(); await tick();
  assert.equal(t.mail().busy, false);
  t.onClaim(() => secondClaim.promise); const second = t.claim();
  assert.equal(t.mail().busy, true);
  oldAlbum.resolve(album(2)); await first; await tick();
  assert.equal(t.mail().busy, true, 'the old refresh does not own the new claim');
  await t.claim();
  assert.equal(t.calls.filter(action => action === 'claim').length, 2);
  t.get(async () => album(3));
  secondClaim.resolve({ ok: true, card: { id: 'seal' } }); await second;
  assert.equal(t.state().data.sets.gods.seal, 3);
  assert.equal(t.mail().busy, false);
});

test('reward bridge loads as a classic script after the inline application', () => {
  const handlerAt=html.indexOf('async function handleMailbox(action,target)');
  const bridgeAt=html.indexOf('<script src="card-reward-mail.js?');
  assert.ok(handlerAt>0 && bridgeAt>handlerAt);
  assert.ok(html.lastIndexOf('</script>', bridgeAt)>handlerAt);
});

test('the bridge preserves unrelated mailbox actions', async () => {
  const t=setup(); t.mail().open=true;
  await t.sandbox.handleMailbox('mailbox-close', {});
  assert.equal(t.mail().open, false);
  assert.deepEqual(t.calls, []);
});

test('a pre-install inline request cannot overwrite the bridge cache', async () => {
  const t=setup({ installBridge:false }), old=deferred();
  t.get(() => old.promise); const original=t.load(); const oldState=t.state();
  t.install(); t.get(async () => album(2)); await t.load();
  assert.notEqual(t.state(), oldState);
  old.resolve(album(99)); await original;
  assert.equal(t.state().data.sets.gods.seal, 2);
  assert.equal(t.state().loading, false);
});
