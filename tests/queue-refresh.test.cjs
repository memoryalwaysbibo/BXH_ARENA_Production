'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const core = fs.readFileSync(path.join(__dirname, '../modules/main-app/core.js'), 'utf8');
const source = core.slice(core.indexOf('function scheduleSmartCallAutoRefresh(){'), core.indexOf('\nfunction renderPlayerRegisteredTab(){'));
function harness() {
  let id = 0; const timers = new Map(), reads = [], context = {
    smartCallAutoRefreshTimer: null, smartCallAutoRefreshKey: '', smartCallRefreshBusy: false,
    appPhase: 'player-center', playerActiveTab: 'registered', myRegistrationsRequest: 1,
    myRegistrationsCache: [{ tournamentCode: 'BXH-ONE', status: 'confirmed' }, { tournamentCode: 'BXH-ONE', status: 'confirmed', familyPlayerId: 'child' }],
    myRegistrationsTournamentInfo: { 'BXH-ONE': { tournamentPhase: 'live', parsedData: {} } },
    owner: 'first-account', enabled: true, renders: 0,
    document: { hidden: false }, schedulePhase: () => 'live', smartCallModel: () => ({ kind: 'pending' }),
    setTimeout: (fn, ms) => { const handle = ++id; timers.set(handle, { fn, ms }); return handle; },
    clearTimeout: handle => timers.delete(handle),
  };
  context.smartCallEnabled = () => context.enabled;
  context.lobbyAuthKey = () => context.owner;
  context.renderPreservingScroll = () => { context.renders++; };
  context.window = { addEventListener() {}, cloudSync: { getPublicTournamentSummary: async code => { reads.push(code); return { tournamentPhase: 'live', parsedData: { updated: true } }; } } };
  vm.createContext(context); vm.runInContext(source, context);
  return { context, timers, reads, schedule: () => context.scheduleSmartCallAutoRefresh(), fire: async () => { const [handle, item] = timers.entries().next().value; timers.delete(handle); await item.fn(); } };
}
test('retains one existing 20-second timer and deduplicates a family event read', async () => {
  const h = harness(); h.schedule(); const handle = h.context.smartCallAutoRefreshTimer;
  for (let i = 0; i < 20; i++) h.schedule();
  assert.equal(h.timers.size, 1); assert.equal(h.context.smartCallAutoRefreshTimer, handle);
  assert.equal(h.timers.get(handle).ms, 20000);
  await h.fire(); assert.deepEqual(h.reads, ['BXH-ONE']); assert.equal(h.context.renders, 1);
});
test('hidden or disabled reminders add no queue reads and clear pending timer', () => {
  for (const apply of [c => { c.document.hidden = true; }, c => { c.enabled = false; }, c => { c.playerActiveTab = 'home'; }]) {
    const h = harness(); h.schedule(); apply(h.context); h.schedule();
    assert.equal(h.timers.size, 0); assert.deepEqual(h.reads, []);
  }
});
test('new account or manual refresh replaces a stale scheduled callback', () => {
  for (const apply of [c => { c.owner = 'second-account'; }, c => { c.myRegistrationsRequest++; }]) {
    const h = harness(); h.schedule(); const handle = h.context.smartCallAutoRefreshTimer;
    apply(h.context); h.schedule();
    assert.equal(h.timers.size, 1); assert.notEqual(h.context.smartCallAutoRefreshTimer, handle);
  }
});
test('late summary cannot repopulate data or render after account change', async () => {
  const h = harness(); let resolve;
  h.context.window.cloudSync.getPublicTournamentSummary = () => new Promise(r => { resolve = r; });
  h.schedule(); const pending = h.fire();
  h.context.owner = 'second-account'; h.context.myRegistrationsTournamentInfo = {};
  resolve({ parsedData: { previousAccount: true } }); await pending;
  assert.deepEqual(h.context.myRegistrationsTournamentInfo, {}); assert.equal(h.context.renders, 0);
  assert.equal(h.timers.size, 1, 'current account may resume its own cadence after old request settles');
});
test('navigation during a summary read cannot replace cache or render old screen', async () => {
  const h = harness(); let resolve;
  const previous = h.context.myRegistrationsTournamentInfo['BXH-ONE'];
  h.context.window.cloudSync.getPublicTournamentSummary = () => new Promise(r => { resolve = r; });
  h.schedule(); const pending = h.fire(); h.context.playerActiveTab = 'home';
  resolve({ parsedData: { oldScreen: true } }); await pending;
  assert.equal(h.context.myRegistrationsTournamentInfo['BXH-ONE'], previous); assert.equal(h.context.renders, 0); assert.equal(h.timers.size, 0);
});
test('failed/null summaries preserve last content with explicit stale flag', async () => {
  for (const fetch of [async () => null, async () => { throw Error('offline'); }]) {
    const h = harness(); h.context.window.cloudSync.getPublicTournamentSummary = fetch;
    h.schedule(); await h.fire();
    assert.equal(h.context.myRegistrationsTournamentInfo['BXH-ONE'].queueSyncFailed, true);
    assert.equal(h.context.renders, 1);
  }
});
test('UID-index flag stops the legacy registered queue timer without reads',()=>{
 const h=harness();h.schedule();assert.equal(h.timers.size,1);
 h.context.window.BXH_FEATURE_FLAGS={uidActiveEvents:true};h.context.window.BXHActiveEvents={};
 h.schedule();assert.equal(h.timers.size,0);assert.deepEqual(h.reads,[]);
});
