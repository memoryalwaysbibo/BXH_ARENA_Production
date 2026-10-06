'use strict';
// Production management-list functions in a network-free VM. Every cloud call
// is an in-memory mock; these tests never sign in, read real rooms, or write data.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'modules/main-app/core.js'), 'utf8');
const cloud = fs.readFileSync(path.join(root, 'modules/cloud/cloud-runtime.js'), 'utf8');
function between(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'Production integration seam missing: ' + start);
  return source.slice(a, b);
}
const declarations = between(core, 'let adminTournamentListOpen = false;', 'let refereeDirectoryUsers = null;');
const renderer = between(core, 'function renderTournamentManagementTab(){', '\nfunction renderAdminTournamentListModal(){');
const loading = between(core, 'function adminTournamentListIdentityKey()', '\nfunction renderAdminNoTournamentScreen(){');
const modalRenderer = between(core, 'function renderAdminTournamentListModal(){', '\nfunction adminTournamentListIdentityKey()');
const cloudMethods = between(cloud, '    async queryAdminTournaments(){', '\n    // v13.13.4：玩家');
const cloudDeadline = between(cloud, '  function withTimeout(promise, ms, fallbackValue){', '\n  async function tryInitFirebase(){');
const clone = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function row(name = 'Fixture room', extra = {}) {
  return { code: 'BXH-MOCK01', name, createdBy: 'fixture-owner', createdByName: 'Fixture creator',
    eventAuthority: 'official', tournamentPhase: 'waiting', archiveStatus: 'ongoing', ...extra };
}
function clock() {
  let now = 0, id = 0;
  const timers = new Map();
  return {
    setTimeout(fn, delay = 0) { const key = ++id; timers.set(key, { at: now + Number(delay), fn }); return key; },
    clearTimeout(key) { timers.delete(key); },
    async advance(ms) {
      const end = now + ms;
      await tick();
      for (;;) {
        const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; timers.delete(next[0]); next[1].fn(); await tick();
      }
      now = end; await tick();
    }
  };
}
function setup(query = async () => [row()]) {
  const timer = clock(), calls = [], renders = [];
  const sandbox = {
    console: { warn() {}, error() {}, log() {} }, setTimeout: timer.setTimeout, clearTimeout: timer.clearTimeout,
    firebaseUser: { uid: 'fixture-owner' }, userProfile: { role: 'admin', active: true }, currentRole: 'admin', activeMode: 'admin',
    pendingModal: null, state: { cloudCode: null }, activeTab: 'management', appPhase: 'app', publicTournamentsCache: {}, myRegistrationsCache: {},
    currentAuthUid: () => sandbox.firebaseUser?.uid || '',
    hasAdminAccess: () => ['admin', 'tester'].includes(sandbox.currentRole),
    isTester: () => sandbox.userProfile?.role === 'tester',
    isAdminTierOrAbove: () => ['admin', 'super_admin'].includes(sandbox.userProfile?.role),
    isPartnerOrganizerMode: () => sandbox.activeMode === 'partner_organizer',
    isEventStaffMode: () => sandbox.activeMode === 'event_staff',
    partnerOrganizerGrant: () => sandbox.userProfile?.partnerOrganizer || {},
    cloudAvailable: () => true, canCreateOfficialTournament: () => false,
    registrationStatusLabel: () => '', esc: value => String(value ?? ''),
    window: { cloudSync: { connect: async () => true, queryAdminTournaments: () => { calls.push('query'); return query(); } } },
    render() { sandbox.reconcileAdminTournamentListContext(); renders.push(sandbox.renderTournamentManagementTab()); }
  };
  vm.createContext(sandbox);
  vm.runInContext(declarations + '\n' + renderer + '\n' + modalRenderer + '\n' + loading, sandbox, { filename: 'management-core.js' });
  const evaluate = source => vm.runInContext(source, sandbox);
  return { sandbox, calls, renders, timer, evaluate,
    state: () => clone(evaluate('({ busy: adminTournamentListBusy, loaded: adminTournamentListLoaded, error: adminTournamentListError, items: adminTournamentListItems })')),
    view: () => sandbox.renderTournamentManagementTab(),
    load: () => sandbox.loadAdminTournamentList(),
    query: fn => { query = fn; }
  };
}
function installCloud(t, docs, getDoc = async () => ({ exists: () => false })) {
  const reads = [];
  Object.assign(t.sandbox, {
    cloudEnabled: true, dbHandle: {}, currentUserUidForWrites: () => t.sandbox.firebaseUser?.uid || '',
    computeTournamentPhase: () => 'waiting',
    fx: {
      collection: (_, kind) => kind, query: (...parts) => parts, where: (...parts) => parts,
      getDocs: async () => ({ docs: docs.map(item => ({ id: item.code, data: () => clone(item) })) }),
      doc: (_, kind, id) => ({ kind, id }), getDoc: ref => { reads.push(ref); return getDoc(ref); }
    }
  });
  t.evaluate(cloudDeadline + '\nObject.assign(window.cloudSync, {' + cloudMethods + '});');
  return reads;
}

test('base query publishes room cards without reading optional creator profiles', async () => {
  const t = setup(), pending = deferred();
  const reads = installCloud(t, [row('Named'), row('Missing name', { code: 'BXH-MOCK02', createdByName: '' })], () => pending.promise);
  const result = await t.sandbox.window.cloudSync.queryAdminTournaments();
  assert.equal(result.length, 2); assert.equal(reads.length, 0);
  assert.equal(result[0].createdByName, 'Fixture creator'); assert.equal(result[1].createdByName, '');
});

test('name enrichment reads only missing distinct creators, preserves names, and leaves source rows unchanged', async () => {
  const t = setup(), rows = [row('Named'), row('Missing', { createdBy: 'missing', createdByName: '' }), row('Same creator', { createdBy: 'missing', createdByName: '' })];
  const reads = installCloud(t, [], async () => ({ exists: () => true, data: () => ({ displayName: 'Resolved creator' }) }));
  const result = await t.sandbox.window.cloudSync.enrichAdminTournamentCreatorNames(rows);
  assert.deepEqual(reads, [{ kind: 'users', id: 'missing' }]);
  assert.equal(result[0].createdByName, 'Fixture creator'); assert.equal(result[1].createdByName, 'Resolved creator');
  assert.equal(result[2].createdByName, 'Resolved creator'); assert.equal(rows[1].createdByName, '');
});

test('hung or denied creator reads settle with UID fallback and never fail the list', async () => {
  const t = setup(), pending = deferred(), rows = [row('Missing', { createdByName: '' })];
  installCloud(t, [], () => pending.promise);
  const result = t.sandbox.window.cloudSync.enrichAdminTournamentCreatorNames(rows);
  await t.timer.advance(3000);
  assert.equal((await result)[0].createdByName, '');
  pending.resolve({ exists: () => true, data: () => ({ displayName: 'Too late' }) }); await tick();
  assert.equal(rows[0].createdByName, '');
  installCloud(t, [], async () => { throw { code: 'permission-denied' }; });
  assert.equal((await t.sandbox.window.cloudSync.enrichAdminTournamentCreatorNames(rows))[0].createdByName, '');
});

test('repeated renders and explicit refreshes share one active request', async () => {
  const pending = deferred(), t = setup(() => pending.promise);
  t.sandbox.render(); t.sandbox.render(); t.sandbox.render(); await t.timer.advance(0);
  const first = t.load(), second = t.load(); await tick();
  assert.equal(first, second); assert.equal(t.calls.length, 1);
  pending.resolve([row()]); await first;
  assert.equal(t.state().loaded, true); assert.equal(t.state().busy, false);
  assert.match(t.view(), /Fixture room/);
});

test('pending creator names cannot hide ready room cards or require a tab switch', async () => {
  const pending = deferred(), t = setup(async () => [row('Ready immediately', { createdByName: '' })]);
  t.sandbox.window.cloudSync.enrichAdminTournamentCreatorNames = () => pending.promise;
  const request = t.load(); await tick();
  assert.equal(t.state().loaded, true); assert.match(t.view(), /Ready immediately/);
  assert.doesNotMatch(t.view(), /正在讀取雲端賽事/); assert.equal(t.sandbox.activeTab, 'management');
  pending.resolve([row('Ready immediately', { createdByName: 'Enriched' })]); await request;
  assert.match(t.view(), /Enriched/);
});

test('pending lifecycle repair cannot hide cards and settles after its bounded deadline', async () => {
  const pending = deferred(), t = setup(async () => [row('Archived room', { archiveStatus: 'completed' })]);
  const repairs = [];
  t.sandbox.window.cloudSync.repairTournamentLifecycle = code => { repairs.push(code); return pending.promise; };
  const request = t.load(); await tick();
  assert.match(t.view(), /Archived room/); assert.equal(t.state().loaded, true);
  assert.doesNotMatch(t.view(), /正在讀取雲端賽事/); assert.deepEqual(repairs, ['BXH-MOCK01']);
  await t.timer.advance(10000); await request;
  assert.equal(t.state().busy, false); assert.match(t.view(), /Archived room/);
});

for (const stage of ['connect', 'cleanup', 'query']) {
  test(stage + ' timeout ends the spinner and offers a working same-page retry', async () => {
    const pending = deferred(), t = setup(stage === 'query' ? () => pending.promise : async () => [row()]);
    if (stage === 'connect') t.sandbox.window.cloudSync.connect = () => pending.promise;
    if (stage === 'cleanup') {
      t.sandbox.userProfile.role = 'tester'; t.sandbox.currentRole = 'tester';
      t.sandbox.window.cloudSync.cleanupMyExpiredTestRooms = () => pending.promise;
    }
    const request = t.load(); await t.timer.advance(10000); await request;
    assert.equal(t.state().busy, false); assert.equal(t.state().loaded, true); assert.ok(t.state().error);
    assert.doesNotMatch(t.view(), /正在讀取雲端賽事/); assert.match(t.view(), /cloud-refresh-admin-list/);
    t.sandbox.window.cloudSync.connect = async () => true;
    t.sandbox.window.cloudSync.cleanupMyExpiredTestRooms = async () => true;
    t.query(async () => [row('Retried room', stage === 'cleanup' ? { testMode: true, eventAuthority: 'test' } : {})]);
    await t.load(); assert.equal(t.state().error, ''); assert.match(t.view(), /Retried room/);
    pending.resolve([row('Late old room')]); await tick();
    assert.match(t.view(), /Retried room/); assert.doesNotMatch(t.view(), /Late old room/);
  });
}

test('refresh and refresh failure retain the last known cards; retry replaces them', async () => {
  const t = setup(); await t.load(); const pending = deferred(); t.query(() => pending.promise);
  const request = t.load(); await tick();
  assert.match(t.view(), /Fixture room/); assert.doesNotMatch(t.view(), /正在讀取雲端賽事/);
  pending.reject(Error('fixture offline')); await request;
  assert.ok(t.state().error); assert.match(t.view(), /Fixture room/);
  t.query(async () => [row('Fresh room')]); await t.load();
  assert.equal(t.state().error, ''); assert.match(t.view(), /Fresh room/); assert.doesNotMatch(t.view(), /Fixture room/);
});

test('empty success is distinct from a failed request and does not refetch on render', async () => {
  const t = setup(async () => []); await t.load();
  assert.equal(t.state().error, ''); assert.match(t.view(), /目前沒有可管理的賽事/);
  t.sandbox.render(); await t.timer.advance(0); assert.equal(t.calls.length, 1);
});

test('permission failure has a clear error and allows a subsequent successful refresh', async () => {
  const t = setup(async () => { throw { code: 'permission-denied' }; }); await t.load();
  assert.match(t.state().error, /權限/); assert.equal(t.state().busy, false);
  t.query(async () => [row()]); await t.load(); assert.match(t.view(), /Fixture room/);
});

for (const change of ['logout', 'account', 'role', 'mode', 'grant']) {
  test(change + ' change invalidates a pending response before it can repopulate the list', async () => {
    const pending = deferred(), t = setup(() => pending.promise), request = t.load(); await tick();
    if (change === 'logout') { t.sandbox.firebaseUser = null; t.sandbox.userProfile = null; t.sandbox.currentRole = null; }
    if (change === 'account') t.sandbox.firebaseUser = { uid: 'different-owner' };
    if (change === 'role') t.sandbox.userProfile.role = 'staff';
    if (change === 'mode') t.sandbox.activeMode = 'event_staff';
    if (change === 'grant') { t.sandbox.activeMode = 'partner_organizer'; t.sandbox.userProfile.partnerOrganizer = { organizationId: 'different-org' }; }
    t.sandbox.reconcileAdminTournamentListContext();
    assert.equal(t.state().items.length, 0); assert.equal(t.state().busy, false);
    pending.resolve([row('Old private room')]); await request; await tick();
    assert.equal(t.state().items.length, 0); assert.doesNotMatch(t.renders.at(-1) || '', /Old private room/);
  });
}

test('an older identity response cannot overwrite a newer completed request', async () => {
  const pending = deferred(), t = setup(() => pending.promise), old = t.load(); await tick();
  t.sandbox.firebaseUser = { uid: 'new-owner' }; t.query(async () => [row('New owner room', { createdBy: 'new-owner' })]);
  await t.load(); pending.resolve([row('Old owner room')]); await old;
  assert.match(t.view(), /New owner room/); assert.doesNotMatch(t.view(), /Old owner room/);
});

test('late metadata from an old identity cannot replace the current list', async () => {
  const metadata = deferred(), t = setup(async () => [row('Old owner room', { createdByName: '' })]);
  t.sandbox.window.cloudSync.enrichAdminTournamentCreatorNames = () => metadata.promise;
  const old = t.load(); await tick();
  t.sandbox.firebaseUser = { uid: 'new-owner' }; delete t.sandbox.window.cloudSync.enrichAdminTournamentCreatorNames;
  t.query(async () => [row('New owner room', { createdBy: 'new-owner' })]); await t.load();
  metadata.resolve([row('Old owner room', { createdByName: 'Late name' })]); await old;
  assert.match(t.view(), /New owner room/); assert.doesNotMatch(t.view(), /Old owner room|Late name/);
});

test('existing blank-room, tester and community permission filters remain enforced', async () => {
  const t = setup(async () => [row('', { code: 'BLANK' }), row('Official'), row('Community', { eventAuthority: 'community', code: 'COMMUNITY' })]);
  await t.load(); assert.deepEqual(t.state().items.map(item => item.name), ['Official', 'Community']);
  t.sandbox.userProfile.role = 'staff'; await t.load(); assert.deepEqual(t.state().items.map(item => item.name), ['Official']);
  t.sandbox.currentRole = 'tester'; t.sandbox.userProfile.role = 'tester';
  t.query(async () => [row('Own test', { eventAuthority: 'test', testMode: true }), row('Other test', { eventAuthority: 'test', testMode: true, createdBy: 'other' }), row('Official')]);
  await t.load(); assert.deepEqual(t.state().items.map(item => item.name), ['Own test']);
});

test('a forced post-mutation load supersedes in-flight metadata without restoring deleted cards', async () => {
  const metadata = deferred(), t = setup(async () => [row('Deleted room', { createdByName: '' }), row('Remaining room', { code: 'BXH-MOCK02' })]);
  t.sandbox.window.cloudSync.enrichAdminTournamentCreatorNames = () => metadata.promise;
  const old = t.load(); await tick();
  t.evaluate('adminTournamentListItems = adminTournamentListItems.filter(item => item.code !== "BXH-MOCK01");');
  t.query(async () => [row('Remaining room', { code: 'BXH-MOCK02' })]);
  delete t.sandbox.window.cloudSync.enrichAdminTournamentCreatorNames;
  const replacement = t.sandbox.loadAdminTournamentList({ force: true });
  assert.notEqual(replacement, old); await replacement;
  metadata.resolve([row('Deleted room', { createdByName: 'Late creator' }), row('Remaining room', { code: 'BXH-MOCK02' })]); await old;
  assert.equal(t.calls.length, 2); assert.deepEqual(t.state().items.map(item => item.name), ['Remaining room']);
  assert.doesNotMatch(t.view(), /Deleted room|Late creator/);
});

test('tester lifecycle repair excludes hidden or foreign records before any mock mutation', async () => {
  const t = setup(async () => [
    row('Missing test marker', { archiveStatus: 'completed', eventAuthority: 'test', code: 'HIDDEN1' }),
    row('Foreign test', { archiveStatus: 'completed', eventAuthority: 'test', testMode: true, createdBy: 'other', code: 'HIDDEN2' }),
    row('Official', { archiveStatus: 'completed', code: 'HIDDEN3' }),
    row('Own valid test', { eventAuthority: 'test', testMode: true, code: 'OWN' })
  ]);
  t.sandbox.userProfile.role = 'tester'; t.sandbox.currentRole = 'tester';
  const repairs = []; t.sandbox.window.cloudSync.repairTournamentLifecycle = async code => { repairs.push(code); return { ok: true }; };
  await t.load(); assert.deepEqual(repairs, []);
  assert.deepEqual(t.state().items.map(item => item.code), ['OWN']);
});

test('the list modal retains cached cards and a visible timeout error with refresh available', async () => {
  const t = setup(); await t.load(); t.evaluate('adminTournamentListOpen = true;');
  const pending = deferred(); t.query(() => pending.promise); const refresh = t.load(); await tick();
  assert.match(t.sandbox.renderAdminTournamentListModal(), /Fixture room/);
  assert.doesNotMatch(t.sandbox.renderAdminTournamentListModal(), /正在讀取雲端賽事/);
  await t.timer.advance(10000); await refresh;
  const html = t.sandbox.renderAdminTournamentListModal();
  assert.match(html, /Fixture room/); assert.match(html, /逾時/); assert.match(html, /cloud-refresh-admin-list/);
});
