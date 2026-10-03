'use strict';
// Exercise the shipped inline handlers and reward client without Firebase or
// production accounts. Deferred responses make stale-read races deterministic.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'modules/main-app/core.js'), 'utf8');
const mailbox = fs.readFileSync(path.join(root, 'modules/main-app/mailbox.js'), 'utf8');
const albumFeature = fs.readFileSync(path.join(root, 'modules/main-app/card-album.js'), 'utf8');
const html = core;
function sectionFrom(sourceText,start,end) {
  const at=sourceText.indexOf(start),until=sourceText.indexOf(end,at);
  assert.ok(at>=0&&until>at,`missing source section: ${start}`);
  return sourceText.slice(at,until);
}
const source=[
  sectionFrom(mailbox,'let mailboxState=null;','function mailboxButtonHtml()'),
  sectionFrom(mailbox,'async function handleMailbox(action,target)','Object.assign(window.BXHMailbox'),
  sectionFrom(core,'const CARD_ALBUM_CARDS=','const {cardAlbumContext,loadCardAlbum,cardAlbumImage,renderCardAlbumPage,renderCardAlbumTrade}=window.BXHCardAlbumFeature;'),
  albumFeature
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
  vm.runInContext(mailbox, sandbox, { filename: 'mailbox-feature.js' });
  vm.runInContext(albumFeature, sandbox, { filename: 'card-album-feature.js' });
  vm.runInContext(source.replace(albumFeature,''), sandbox, { filename: 'card-album-inline.js' });
  const install = () => vm.runInContext(rewardSource, sandbox, { filename: 'card-reward-mail.js' });
  if (installBridge) install();
  const target = { getAttribute: name => name === 'data-message-id' ? 'mail-1' : null };
  return {
    sandbox, calls, toasts, listeners, scheduled, install,
    state: () => sandbox.window.BXHCardAlbumFeature.cardAlbumContext(), mail: () => sandbox.window.BXHMailbox.mailboxContext(),
    load: refresh => sandbox.window.BXHCardAlbumFeature.loadCardAlbum(refresh),
    claim: () => sandbox.window.BXHMailbox.handleMailbox('mailbox-card-reward', target),
    view: () => sandbox.window.BXHCardAlbumFeature.renderCardAlbumPage(),
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

test('reward bridge loads after the modular mailbox feature', () => {
  const indexHtml=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const mailboxAt=indexHtml.indexOf('modules/main-app/mailbox.js');
  const bridgeAt=indexHtml.indexOf('<script src="card-reward-mail.js?');
  assert.ok(mailboxAt>0 && bridgeAt>mailboxAt);
});

test('the bridge preserves unrelated mailbox actions', async () => {
  const t=setup(); t.mail().open=true;
  await t.sandbox.window.BXHMailbox.handleMailbox('mailbox-close', {});
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

// The original harness uses namespace handlers after initializing context. Real
// first-open rendering instead uses core's pre-bridge const bindings. Keep the
// shipped feature -> core binding -> reward bridge load order for this contract.
function setupProductionAlbumEntry({ installBridge = true } = {}) {
  const calls = [], listeners = {}, scheduled = [];
  let get = async () => album(2), list = async () => trades(), lastHtml = '';
  const sandbox = {
    firebaseUser: { uid: 'entry-player' }, engagementSessionEpoch: 1,
    currentAuthUid: () => sandbox.firebaseUser?.uid || '', playerActiveTab: 'cards',
    setTimeout: fn => { scheduled.push(fn); }, esc: value => String(value ?? ''),
    showToast() {},
    document: {
      addEventListener: (name, fn) => { (listeners[name] ||= []).push(fn); },
      getElementById: () => null,
    },
    window: { engagementService: {
      cardAlbum: payload => { calls.push(payload.action); return payload.action === 'get' ? get() : list(); },
    } },
  };
  vm.createContext(sandbox);
  const run = expression => vm.runInContext(expression, sandbox);
  sandbox.render = sandbox.renderPreservingScroll = () => { lastHtml = run('renderCardAlbumPage()'); };
  vm.runInContext(mailbox, sandbox, { filename: 'modules/main-app/mailbox.js' });
  vm.runInContext(albumFeature, sandbox, { filename: 'modules/main-app/card-album.js' });
  vm.runInContext(sectionFrom(core, 'const CARD_ALBUM_CARDS=', 'function renderPlayerCenterLoggedIn()'), sandbox, { filename: 'production-core-album-bindings.js' });
  const install = () => vm.runInContext(rewardSource, sandbox, { filename: 'card-reward-mail.js' });
  if (installBridge) install();
  return {
    calls, scheduled, run, sandbox, install,
    view: () => run('renderCardAlbumPage()'), html: () => lastHtml,
    state: () => run('cardAlbumState'), load: force => run(`loadCardAlbum(${force === true})`),
    get: fn => { get = fn; }, list: fn => { list = fn; },
    async click(action, data = {}) {
      const target = { dataset: { action, ...data }, classList: { contains: () => false } };
      target.closest = () => target;
      for (const fn of listeners.click || []) await fn({ target });
    },
    change(value) {
      for (const fn of listeners.change || []) fn({ target: { id: 'card-album-set-filter', value } });
    },
  };
}

test('production entry: first render after reward bridge reset opens without preloading context', () => {
  const t = setupProductionAlbumEntry();
  assert.equal(t.state(), null, 'fixture must start at the real bridge reset');
  assert.doesNotThrow(() => t.view());
  assert.match(t.view(), /我的卡冊/);
  assert.equal(t.state().key, 'entry-player:1');
  assert.deepEqual(t.calls, [], 'opening the shell must not require a completed server request');
});

test('production entry: scheduled first load uses the current session-aware handler', async () => {
  const t = setupProductionAlbumEntry(); t.view();
  await t.scheduled.shift()();
  assert.deepEqual(t.calls, ['get', 'list']);
  assert.equal(t.state().revision, 1);
  assert.equal(t.state().loading, false);
  assert.match(t.html(), /諸神戰場 附魔封印，持有 2 張/);
  assert.strictEqual(t.run('cardAlbumContext()'), t.sandbox.window.BXHCardAlbumFeature.cardAlbumContext());
});

test('production entry: refresh button uses authoritative quantities through its original closure', async () => {
  const t = setupProductionAlbumEntry(); await t.load();
  t.get(async () => album(4));
  await t.click('card-album-refresh');
  assert.equal(t.state().data.sets.gods.seal, 4);
  assert.equal(t.state().revision, 2);
  assert.deepEqual(t.calls, ['get', 'list', 'get', 'list']);
  assert.match(t.html(), /持有 4 張/);
});

test('production entry: set filter and owned preview work without changing card counts', async () => {
  const t = setupProductionAlbumEntry(); await t.load();
  const before = JSON.stringify(t.state().data.sets);
  t.change('gods');
  assert.equal(t.run('cardAlbumSetFilter'), 'gods');
  assert.equal((t.html().match(/class="panel card-album-set"/g) || []).length, 1);
  await t.click('card-album-preview', { set: 'gods', card: 'seal' });
  assert.match(t.html(), /role="dialog"/);
  await t.click('card-album-close');
  assert.doesNotMatch(t.html(), /role="dialog"/);
  await t.click('card-album-preview', { set: 'gods', card: 'double_extreme' });
  assert.doesNotMatch(t.html(), /role="dialog"/, 'unowned cards stay locked');
  assert.equal(JSON.stringify(t.state().data.sets), before);
});

test('production entry: stale core load binding still rejects out-of-order forced refreshes', async () => {
  const t = setupProductionAlbumEntry(), old = deferred(), next = deferred();
  t.get(() => old.promise); const first = t.load(true);
  t.get(() => next.promise); const second = t.load(true);
  next.resolve(album(5)); await second;
  old.resolve(album(1)); await first;
  assert.equal(t.state().data.sets.gods.seal, 5);
  assert.equal(t.state().loading, false);
  assert.equal(t.state().revision, 2);
});

test('production entry: same-UID new session cannot retain old quantities or preview', async () => {
  const t = setupProductionAlbumEntry(); await t.load();
  await t.click('card-album-preview', { set: 'gods', card: 'seal' });
  t.sandbox.engagementSessionEpoch++;
  t.view();
  assert.equal(t.state().key, 'entry-player:2');
  assert.equal(t.state().data, null);
  assert.equal(t.run('cardAlbumPreview'), null);
  t.sandbox.firebaseUser = null; t.sandbox.engagementSessionEpoch++;
  const before = t.calls.length; t.view(); await t.load();
  assert.equal(t.state().uid, '');
  assert.equal(t.calls.length, before);
});

test('production entry: failed or malformed reads release loading and an explicit retry recovers', async () => {
  const t = setupProductionAlbumEntry();
  t.get(async () => ({ ok: false, sets: { gods: { seal: 999 } } }));
  await t.load();
  assert.equal(t.state().data, null);
  assert.equal(t.state().loading, false);
  assert.match(t.html(), /卡冊讀取失敗/);
  t.get(async () => album(2)); await t.click('card-album-refresh');
  assert.equal(t.state().error, '');
  assert.equal(t.state().data.sets.gods.seal, 2);
});

test('production entry: base module also tolerates a reset when the optional bridge is absent', async () => {
  const t = setupProductionAlbumEntry({ installBridge: false });
  t.run('cardAlbumState=null');
  assert.doesNotThrow(() => t.view());
  await t.load();
  assert.equal(t.state().data.sets.gods.seal, 2);
  assert.equal(t.state().loading, false);
});


test('legacy gods pack is rendered as a claimable card reward and not a downloadable file', () => {
  const t=setup();
  t.sandbox.isSuperAdmin=()=>false;t.sandbox.mailboxDate=()=> '2026/10/03 14:49';
  const pack={
    id:'gods_pack_BXH-ABC123',type:'card_reward',senderName:'BXH ARENA 系統',createdAt:1,
    reward:{kind:'gods_card_pack',status:'unclaimed',eventCode:'BXH-ABC123'},
    attachments:[{id:'gods_pack',kind:'gods_card_pack',name:'諸神戰場卡包 ×1',mime:'application/x-bxh-card-pack',size:1,eventCode:'BXH-ABC123'}]
  };
  const mail=t.mail();mail.messages=[pack];mail.selectedId=pack.id;mail.open=true;
  const html=t.sandbox.window.BXHMailbox.renderMailboxPage();
  assert.match(html,/諸神戰場卡包 ×1/);
  assert.match(html,/領取卡牌/);
  assert.doesNotMatch(html,/mailbox-download-attachment/);
  assert.doesNotMatch(html,/⬇/);
});

test('legacy gods pack claim routes to cardAlbum claimPack and returns the revealed card', async () => {
  const t=setup(),calls=[];
  const pack={id:'gods_pack_BXH-ABC123',type:'card_reward',reward:{kind:'gods_card_pack',status:'unclaimed',eventCode:'BXH-ABC123'}};
  t.sandbox.window.engagementService.cardAlbum=async payload=>{
    calls.push(payload);return {ok:true,cardId:'seal',bonus:[]};
  };
  const result=await t.sandbox.window.BXHCardRewardUI.claim(pack.id,pack);
  assert.deepEqual(calls,[{action:'claimPack',messageId:'gods_pack_BXH-ABC123'}]);
  assert.equal(result.card.id,'seal');assert.equal(result.card.name,'附魔封印');
  assert.equal(result.card.setId,'gods');
});

test('normal mailbox attachments remain downloadable', () => {
  const t=setup();
  t.sandbox.isSuperAdmin=()=>false;t.sandbox.mailboxDate=()=> '2026/10/03';
  const message={id:'normal-mail',type:'notice',senderName:'BXH ARENA',createdAt:1,
    attachments:[{id:'pdf-1',name:'規章.pdf',mime:'application/pdf',size:1024}]};
  const mail=t.mail();mail.messages=[message];mail.selectedId=message.id;mail.open=true;
  const html=t.sandbox.window.BXHMailbox.renderMailboxPage();
  assert.match(html,/mailbox-download-attachment/);
  assert.match(html,/規章\.pdf/);
});

test('direct October card reward keeps claimCardReward and uses the same 領取卡牌 wording', async () => {
  const t=setup(),calls=[];
  const message={id:'oct26_BXH-ABC123_player-a',type:'card_reward',
    reward:{kind:'card',status:'unclaimed',setId:'gods',cardId:'seal'}};
  t.sandbox.window.engagementService.claimCardReward=async payload=>{
    calls.push(payload);return {ok:true,card:{id:'seal',setId:'gods'}};
  };
  const html=t.sandbox.window.BXHCardRewardUI.card(message,false);
  assert.match(html,/領取卡牌/);assert.doesNotMatch(html,/領取附件/);
  await t.sandbox.window.BXHCardRewardUI.claim(message.id,message);
  assert.deepEqual(calls,[{messageId:message.id,action:'claim'}]);
});

test('claimed legacy pack reveals its card and stays non-downloadable', () => {
  const t=setup();
  const message={id:'gods_pack_BXH-ABC123',type:'card_reward',
    reward:{kind:'gods_card_pack',status:'claimed',claimedAt:1,eventCode:'BXH-ABC123',cardId:'seal',bonus:[]},
    attachments:[{id:'gods_pack',kind:'gods_card_pack',name:'諸神戰場卡包 ×1',mime:'application/x-bxh-card-pack',size:1}]};
  const html=t.sandbox.window.BXHCardRewardUI.card(message,false);
  assert.match(html,/附魔封印/);assert.match(html,/已領取 ✓/);
  assert.match(html,/assets\/enchantment-gods\/seal\.webp/);
  assert.equal(t.sandbox.window.BXHCardRewardUI.isVirtualAttachment(message,message.attachments[0]),true);
});
