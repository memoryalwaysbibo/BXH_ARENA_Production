'use strict';

// Isolated cloud-runtime method tests. Every Firestore operation is an in-memory stub.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const root = path.join(__dirname, '..');
const cloud = fs.readFileSync(path.join(root, 'modules/cloud/cloud-runtime.js'), 'utf8');
const domain = fs.readFileSync(path.join(root, 'modules/main-app/domain-utils.js'), 'utf8');
const registration = fs.readFileSync(path.join(root, 'modules/main-app/registration-utils.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const firestoreData = value => {
  if (value instanceof Date) return { $timestamp: value.toISOString() };
  if (Array.isArray(value)) return value.map(firestoreData);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, firestoreData(child)]));
  return value;
};
const NOW = Date.parse('2026-10-06T12:00:00+08:00');
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [NOW])); }
  static now() { return NOW; }
}
function cloudFunction(name) {
  const start = cloud.indexOf('  function ' + name + '(');
  const end = cloud.indexOf('\n  }', start);
  assert(start >= 0 && end > start, 'Cloud helper ' + name + ' exists');
  return cloud.slice(start, end + 4);
}
function method(name) {
  const start = cloud.indexOf('    async ' + name + '(');
  const end = cloud.indexOf('\n    },', start);
  assert(start >= 0 && end > start, 'Cloud method ' + name + ' exists');
  return cloud.slice(start, end + 6);
}
function state(overrides = {}) {
  return { id: 'LOCAL', ownerUid: 'local-host', createdBy: 'local-host', players: [], matches: [],
    waitlistPlayers: [], archiveStatus: 'ongoing', communityQuickRegistration: true,
    meta: { name: 'Local room', date: '2026-10-05', startTime: '11:00', location: 'Local venue',
      eventAuthority: 'community', communityQuickRegistration: true, registrationEnabled: true,
      registrationStatus: 'open', registrationCapacity: null, registrationOpenAt: null,
      registrationCloseAt: null, cancellationDeadline: null, waitlistCapacity: 0, ...overrides },
  };
}
function harness() {
  const docs = new Map(), writes = [], logs = [], summaryCalls = [];
  const stats = { transactions: 0 };
  const snap = key => ({ id: key.split('/').at(-1), exists: () => docs.has(key), data: () => clone(docs.get(key)) });
  const apply = pending => {
    for (const [key, patch, merge] of pending) {
      const next = merge ? { ...(docs.get(key) || {}), ...clone(patch) } : clone(patch);
      docs.set(key, next); writes.push({ key, patch: clone(patch), firestoreData: firestoreData(patch), merge });
    }
  };
  const fx = {
    doc: (_db, ...parts) => parts.join('/'), collection: (_db, ...parts) => parts.join('/'),
    query: collection => collection, where: () => ({}), serverTimestamp: () => NOW,
    getDoc: async key => snap(key),
    getDocs: async collection => {
      const rows = [...docs.keys()].filter(key => key.startsWith(collection + '/') && key.split('/').length === collection.split('/').length + 1).map(snap);
      return { docs: rows, size: rows.length, forEach: fn => rows.forEach(fn) };
    },
    writeBatch: () => {
      const pending = [];
      return { set: (key, patch, options) => pending.push([key, patch, !!options?.merge]), commit: async () => apply(pending) };
    },
    runTransaction: async (_db, fn) => {
      stats.transactions++;
      const pending = [];
      const result = await fn({ get: async key => snap(key),
        set: (key, patch, options) => pending.push([key, patch, !!options?.merge]),
        update: (key, patch) => pending.push([key, patch, true]) });
      apply(pending); return result;
    },
  };
  const ctx = vm.createContext({ window: {}, console: { warn: (...args) => logs.push(args), log: () => {} },
    Date: FixedDate, fx, dbHandle: {}, cloudEnabled: true, authReady: true, crypto: { randomUUID: () => 'local-summary-operation' },
    authHandle: { currentUser: { uid: 'local-host' } },
    userProfile: { role: 'player', active: true, displayName: 'Local Host' },
    currentUserUidForWrites: () => 'local-host', currentUserDisplayNameForWrites: () => 'Local Host',
    generateRoomCode: () => 'LOCAL', isPartnerOrganizerMode: () => false, isEventStaffMode: () => false,
    buildPublicEventInfo: () => ({}), communityRoomExpiryMs: () => NOW + 3600000,
  });
  vm.runInContext(domain + '\n' + registration, ctx);
  Object.assign(ctx, ctx.window.BXHDomainUtils, ctx.window.BXHRegistrationUtils);
  for (const name of ['buildPublicMirrorFields', 'computeTournamentPhase', 'reconstructPublicStateFromDoc']) vm.runInContext(cloudFunction(name), ctx);
  const names = ['createCommunityRoom', 'createRoom', 'pushUpdate', 'syncCommunityRegistrationSummary', 'joinRoom', 'joinRoomPublic', 'getPublicTournamentFull', 'getPublicTournamentSummary', 'queryPublicTournaments', 'queryAdminTournaments', 'promoteLocalWaitlistRoster', 'mutateRegistrationRoster'];
  vm.runInContext('api={' + names.map(method).join(',\n') + '}', ctx);
  ctx.window.engagementService = { familyRegistration: async payload => {
    summaryCalls.push(clone(payload));
    const saved = docs.get('tournaments/' + payload.code);
    return { ok: true, communityParticipantCount: ctx.communityLocalParticipantCount(saved?.data ? JSON.parse(saved.data) : {}) };
  } };
  return { ctx, api: ctx.api, docs, writes, logs, summaryCalls, stats };
}

for (const capacity of [null, 1, 257, Number.MAX_SAFE_INTEGER]) {
  test('community creation serializes opt-in and exact capacity in both mirrors: ' + capacity, async () => {
    const h = harness();
    const data = state({ registrationCapacity: capacity });
    assert.equal(await h.api.createCommunityRoom(data), 'LOCAL');
    assert.equal(h.writes.length, 2);
    for (const key of ['tournaments/LOCAL', 'publicTournaments/LOCAL']) {
      const doc = h.docs.get(key);
      assert.equal(doc.communityQuickRegistration, true);
      assert.equal(doc.eventAuthority, 'community');
      assert.equal(doc.capacity, capacity);
      assert.equal(doc.registrationEnabled, true);
      assert.equal(doc.registrationStatus, 'open');
      assert.equal(doc.registrationOpenAt, null);
      assert.equal(doc.registrationCloseAt, null);
      assert.equal(doc.cancellationDeadline, null);
    }
    const stored = JSON.parse(h.docs.get('tournaments/LOCAL').data);
    assert.equal(stored.meta.registrationCapacity, capacity);
    assert.equal(stored.meta.communityQuickRegistration, true);
    assert.equal(JSON.parse(h.docs.get('publicTournaments/LOCAL').bracketView).meta.communityQuickRegistration, true);
  });
}

test('community cloud creation preserves explicit disabled registration and optional dates', async () => {
  const h = harness();
  await h.api.createCommunityRoom(state({ registrationEnabled: false, registrationOpenAt: NOW + 1000, registrationCloseAt: NOW + 2000, cancellationDeadline: NOW + 3000 }));
  for (const doc of h.docs.values()) {
    assert.equal(doc.registrationStatus, 'closed');
    assert.equal(doc.registrationOpenAt, NOW + 1000);
    assert.equal(doc.registrationCloseAt, NOW + 2000);
    assert.equal(doc.cancellationDeadline, NOW + 3000);
  }
});

for (const capacity of [0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
  test('invalid creation capacity never commits cloud documents: ' + capacity, async () => {
    const h = harness();
    await assert.rejects(h.api.createCommunityRoom(state({ registrationCapacity: capacity })), /invalid-registration-capacity/);
    assert.equal(h.writes.length, 0);
    assert.equal(h.docs.size, 0);
  });
}

test('create, settings push and every public/private read path preserve unlimited null on reload', async () => {
  const h = harness();
  const data = state();
  await h.api.createCommunityRoom(data);
  data.meta.name = 'Updated local room';
  assert.equal(await h.api.pushUpdate('LOCAL', data), true);
  for (const key of ['tournaments/LOCAL', 'publicTournaments/LOCAL']) {
    assert.equal(h.docs.get(key).capacity, null);
    assert.equal(h.docs.get(key).communityQuickRegistration, true);
  }
  assert.equal(JSON.parse(h.docs.get('tournaments/LOCAL').data).meta.registrationCapacity, null);
  assert.equal((await h.api.joinRoom('LOCAL')).data.meta.registrationCapacity, null);
  assert.equal((await h.api.joinRoomPublic('LOCAL')).data.meta.registrationCapacity, null);
  const full = await h.api.getPublicTournamentFull('LOCAL');
  assert.equal(full.capacity, null);
  assert.equal(full.communityQuickRegistration, true);
  assert.equal(h.ctx.isUnlimitedCommunityRegistration(full), true);
  const summary = await h.api.getPublicTournamentSummary('LOCAL');
  assert.equal(summary.parsedData.meta.registrationCapacity, null);
  assert.equal(h.ctx.isUnlimitedCommunityRegistration(summary), true);
  const lobby = await h.api.queryPublicTournaments();
  assert.equal(lobby.ok, true);
  assert.equal(lobby.items.length, 1);
  assert.equal(lobby.items[0].capacity, null);
  assert.equal(lobby.items[0].parsedData.meta.registrationCapacity, null);
  const admin = await h.api.queryAdminTournaments();
  assert.equal(admin[0].capacity, null);
  assert.equal(admin[0].communityQuickRegistration, true);
});

test('ordinary settings push keeps existing registration counters and excludes community staff fields', async () => {
  const h = harness(), data = state();
  await h.api.createCommunityRoom(data);
  for (const doc of h.docs.values()) { doc.confirmedCount = 19; doc.waitlistCount = 3; }
  assert.equal(await h.api.pushUpdate('LOCAL', data), true);
  for (const key of ['tournaments/LOCAL', 'publicTournaments/LOCAL']) {
    const doc = h.docs.get(key);
    assert.equal(doc.confirmedCount, 19);
    assert.equal(doc.waitlistCount, 3);
    assert.equal(doc.capacity, null);
    for (const field of ['assignedStaffUids', 'refereeStationAssignments', 'refereeStationUids']) assert.equal(Object.hasOwn(doc, field), false, field);
  }
});

test('finite to unlimited and unlimited to finite persist in both mirrored documents', async () => {
  const h = harness(), data = state({ registrationCapacity: 8 });
  await h.api.createCommunityRoom(data);
  for (const capacity of [null, 17]) {
    data.meta.registrationCapacity = capacity;
    assert.equal(await h.api.pushUpdate('LOCAL', data), true);
    for (const doc of h.docs.values()) assert.equal(doc.capacity, capacity);
    assert.equal((await h.api.joinRoom('LOCAL')).data.meta.registrationCapacity, capacity);
  }
});

test('push rejects malformed quick capacities without writing either mirror', async () => {
  const h = harness(), data = state();
  await h.api.createCommunityRoom(data);
  const before = clone([...h.docs]);
  const count = h.writes.length;
  for (const capacity of [undefined, 0, -1, 1.5, Infinity, '16']) {
    data.meta.registrationCapacity = capacity;
    assert.equal(await h.api.pushUpdate('LOCAL', data), false, String(capacity));
    assert.equal(h.writes.length, count);
    assert.deepEqual(clone([...h.docs]), before);
  }
});

for (const meta of [
  { eventAuthority: 'official', communityQuickRegistration: true, registrationCapacity: 16 },
  { eventAuthority: 'community', communityQuickRegistration: undefined, registrationCapacity: 0 },
]) {
  test('generic push does not opt in official or legacy rooms: ' + meta.eventAuthority, async () => {
    const h = harness(), data = state(meta);
    delete data.communityQuickRegistration;
    assert.equal(await h.api.pushUpdate('LOCAL', data), true);
    for (const doc of h.docs.values()) assert.equal(Object.hasOwn(doc, 'communityQuickRegistration'), false);
    const full = await h.api.getPublicTournamentFull('LOCAL');
    assert.equal(h.ctx.isCommunityQuickRegistration(full), false);
    assert.equal(h.ctx.isUnlimitedCommunityRegistration(full), false);
  });
}

function rosterHarness({ local = false, status = 'waitlist', capacity = null } = {}) {
  const h = harness();
  const data = state({ registrationCapacity: capacity });
  const candidate = local ? { id: 'local-wait', name: 'Local Wait', source: 'manual' }
    : { id: 'online-player', name: 'Online Player', source: 'online', registrationId: 'REG', registrationUid: 'guardian' };
  data.players = status === 'confirmed' ? [candidate] : [];
  data.waitlistPlayers = status === 'waitlist' ? [candidate] : [];
  const doc = { eventAuthority: 'community', communityQuickRegistration: true, capacity,
    registrationStatus: 'open', tournamentPhase: 'waiting', confirmedCount: status === 'confirmed' ? 1 : 0,
    waitlistCount: status === 'waitlist' ? 1 : 0 };
  h.docs.set('tournaments/LOCAL', { ...doc, data: JSON.stringify(data) });
  h.docs.set('publicTournaments/LOCAL', { ...doc, bracketView: JSON.stringify(h.ctx.buildPublicMirrorFields(data)) });
  if (!local) h.docs.set('tournaments/LOCAL/registrations/REG', { uid: 'guardian', displayName: 'Online Player', status });
  h.trustedCalls = [];
  h.ctx.callEngagementFunction = async (name, payload, timeout) => {
    h.trustedCalls.push({ name, payload: clone(payload), timeout });
    const tour = h.docs.get('tournaments/LOCAL'), pub = h.docs.get('publicTournaments/LOCAL');
    const runtime = JSON.parse(tour.data), reg = h.docs.get('tournaments/LOCAL/registrations/REG');
    const promoted = runtime.waitlistPlayers.find(row => row.registrationId === payload.registrationId);
    assert(promoted, 'Trusted-service fixture has a waiting registration');
    runtime.players.push(promoted);
    runtime.waitlistPlayers = runtime.waitlistPlayers.filter(row => row !== promoted);
    runtime.registrationRosterRevision = Number(runtime.registrationRosterRevision || 0) + 1;
    const common = { capacity: null, confirmedCount: tour.confirmedCount + 1, waitlistCount: tour.waitlistCount - 1, registrationStatus: 'open' };
    Object.assign(tour, common, { data: JSON.stringify(runtime) });
    Object.assign(pub, common, { bracketView: JSON.stringify(h.ctx.buildPublicMirrorFields(runtime)) });
    reg.status = 'confirmed';
    return { ok: true, capacity: null, confirmedCount: common.confirmedCount, waitlistCount: common.waitlistCount, status: 'confirmed', participantRegistrationId: payload.registrationId };
  };
  return h;
}

for (const action of ['promote', 'demote']) {
  test('online waitlist ' + action + ' keeps unlimited null across authoritative state and mirrors', async () => {
    const h = rosterHarness({ status: action === 'promote' ? 'waitlist' : 'confirmed' });
    const result = await h.api.mutateRegistrationRoster('LOCAL', 'REG', action);
    assert.equal(result.verified, true);
    assert.equal(result.capacity, null);
    assert.equal(result.state.meta.registrationCapacity, null);
    assert.equal(h.docs.get('tournaments/LOCAL').capacity, null);
    assert.equal(h.docs.get('publicTournaments/LOCAL').capacity, null);
    assert.equal(JSON.parse(h.docs.get('tournaments/LOCAL').data).meta.registrationCapacity, null);
  });
}

test('local waitlist promotion keeps unlimited null and does not expand capacity', async () => {
  const h = rosterHarness({ local: true });
  const result = await h.api.promoteLocalWaitlistRoster('LOCAL', 'local-wait');
  assert.equal(result.verified, true);
  assert.equal(result.capacity, null);
  assert.equal(result.expanded, false);
  assert.equal(result.state.meta.registrationCapacity, null);
  assert.equal(h.docs.get('tournaments/LOCAL').capacity, null);
  assert.equal(h.docs.get('publicTournaments/LOCAL').capacity, null);
});

const invalidScheduleValues = [0, -1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, '1791259200000'];
for (const apiName of ['createCommunityRoom', 'createRoom', 'pushUpdate']) {
  for (const field of ['registrationOpenAt', 'registrationCloseAt', 'cancellationDeadline']) {
    test(apiName + ' rejects nonpositive, fractional, nonfinite and nonnumeric schedules: ' + field, async () => {
      for (const value of invalidScheduleValues) {
        const h = harness();
        const data = state();
        if (apiName === 'pushUpdate') await h.api.createCommunityRoom(data);
        const before = clone([...h.docs]);
        const writes = h.writes.length;
        data.meta[field] = value;
        if (apiName === 'createCommunityRoom') {
          await assert.rejects(h.api.createCommunityRoom(data), /invalid-registration-schedule/, String(value));
        } else {
          const result = apiName === 'createRoom' ? await h.api.createRoom(data) : await h.api.pushUpdate('LOCAL', data);
          assert.equal(result, apiName === 'createRoom' ? null : false, String(value));
          assert(h.logs.some(args => args.some(error => error?.message === 'invalid-registration-schedule')), 'Exact validation error for ' + String(value));
        }
        assert.equal(h.writes.length, writes, String(value));
        assert.deepEqual(clone([...h.docs]), before, String(value));
      }
    });
  }

  test(apiName + ' rejects equal or reversed opening/closing timestamps atomically', async () => {
    for (const close of [NOW, NOW - 1]) {
      const h = harness();
      const data = state({ registrationOpenAt: NOW, registrationCloseAt: close });
      if (apiName === 'createCommunityRoom') await assert.rejects(h.api.createCommunityRoom(data), /invalid-registration-schedule/);
      else {
        const result = apiName === 'createRoom' ? await h.api.createRoom(data) : await h.api.pushUpdate('LOCAL', data);
        assert.equal(result, apiName === 'createRoom' ? null : false);
        assert(h.logs.some(args => args.some(error => error?.message === 'invalid-registration-schedule')));
      }
      assert.equal(h.writes.length, 0);
      assert.equal(h.docs.size, 0);
    }
  });

  test(apiName + ' accepts null or positive integer timestamps without requiring a future event', async () => {
    for (const schedule of [
      { registrationOpenAt: null, registrationCloseAt: null, cancellationDeadline: null },
      { registrationOpenAt: 1, registrationCloseAt: 2, cancellationDeadline: 3 },
      { registrationOpenAt: NOW + 1000, registrationCloseAt: NOW + 2000, cancellationDeadline: NOW + 3000 },
    ]) {
      const h = harness(), data = state(schedule);
      const result = apiName === 'pushUpdate' ? await h.api.pushUpdate('LOCAL', data) : await h.api[apiName](data);
      assert.equal(result, apiName === 'pushUpdate' ? true : 'LOCAL');
      assert.equal(h.writes.length, 2);
      for (const doc of h.docs.values()) {
        assert.equal(doc.registrationOpenAt, schedule.registrationOpenAt);
        assert.equal(doc.registrationCloseAt, schedule.registrationCloseAt);
        assert.equal(doc.cancellationDeadline, schedule.cancellationDeadline);
      }
    }
  });
}

test('cloud create counts the synthetic host, deduplicates local accounts, and marks capacity one full', async () => {
  const h = harness(), data = state({ registrationCapacity: 1 });
  data.players = [
    { id: 'host', name: 'Host', accountUid: 'local-host', isRoomOwner: true, source: 'host' },
    { id: 'host-duplicate', name: 'Host alias', playerUid: 'local-host', source: 'manual' },
  ];
  await h.api.createCommunityRoom(data);
  for (const doc of h.docs.values()) {
    assert.equal(doc.communityParticipantCount, 1);
    assert.equal(doc.registrationStatus, 'full');
  }
  assert.equal(JSON.parse(h.docs.get('tournaments/LOCAL').data).communityParticipantCount, 1);
  assert.equal((await h.api.joinRoom('LOCAL')).data.communityParticipantCount, 1);
  assert.equal((await h.api.joinRoomPublic('LOCAL')).data.communityParticipantCount, 1);
  assert.equal((await h.api.getPublicTournamentFull('LOCAL')).parsedData.communityParticipantCount, 1);
  assert.equal((await h.api.getPublicTournamentSummary('LOCAL')).parsedData.communityParticipantCount, 1);
  assert.equal((await h.api.queryAdminTournaments())[0].communityParticipantCount, 1);
});

test('public participant count exposes a scalar without leaking private participant aliases', async () => {
  const h = harness(), data = state();
  data.players = [
    { id: 'onsite-1', name: 'Onsite One', accountUid: 'PRIVATE_ACCOUNT_ONE', source: 'manual' },
    { id: 'child-1', name: 'Child One', familyPlayerId: 'PRIVATE_FAMILY_ID', guardianUid: 'PRIVATE_GUARDIAN', uid: 'PRIVATE_GUARDIAN', source: 'manual' },
  ];
  await h.api.createCommunityRoom(data);
  const pub = h.docs.get('publicTournaments/LOCAL');
  assert.equal(pub.communityParticipantCount, 2);
  assert.doesNotMatch(JSON.stringify(pub), /PRIVATE_ACCOUNT_ONE|PRIVATE_FAMILY_ID|PRIVATE_GUARDIAN|participantAliases/);
});

test('settings push asks the server to refresh participants after committing while leaving scalar server-owned', async () => {
  const h = harness(), data = state();
  data.players = [{ id: 'host', name: 'Host', uid: 'local-host', source: 'host' }];
  await h.api.createCommunityRoom(data);
  const start = h.writes.length;
  h.ctx.window.engagementService.familyRegistration = async payload => {
    h.summaryCalls.push(clone(payload));
    assert.equal(h.writes.length, start + 2, 'Both settings mirrors have committed before summary sync');
    assert.equal(h.docs.get('tournaments/LOCAL').capacity, 8);
    return { ok: true, communityParticipantCount: 5 };
  };
  data.meta.registrationCapacity = 8;
  assert.equal(await h.api.pushUpdate('LOCAL', data, { syncCommunitySummary: true }), true);
  assert.equal(h.summaryCalls.length, 1);
  assert.equal(h.summaryCalls[0].action, 'syncSummary');
  assert.equal(h.summaryCalls[0].code, 'LOCAL');
  assert.equal(data.communityParticipantCount, 5);
  assert.equal(h.ctx.window.__BXH_COMMUNITY_SUMMARY_STATUS.LOCAL.ok, true);
  assert.equal(h.ctx.window.__BXH_COMMUNITY_SUMMARY_STATUS.LOCAL.communityParticipantCount, 5);
  for (const write of h.writes.slice(start)) assert.equal(Object.hasOwn(write.patch, 'communityParticipantCount'), false);
});

test('unchanged ordinary push avoids summary calls while roster change and first opt-in refresh it', async () => {
  const h = harness(), data = state();
  await h.api.createCommunityRoom(data);
  assert.equal(await h.api.pushUpdate('LOCAL', data), true);
  assert.equal(h.summaryCalls.length, 0);
  data.players.push({ id: 'onsite', name: 'Onsite', source: 'manual' });
  assert.equal(await h.api.pushUpdate('LOCAL', data), true);
  assert.equal(h.summaryCalls.length, 1);
  assert.equal(data.communityParticipantCount, 1);
  delete h.docs.get('tournaments/LOCAL').communityQuickRegistration;
  assert.equal(await h.api.pushUpdate('LOCAL', data), true);
  assert.equal(h.summaryCalls.length, 2);
});

test('summary projection failure preserves committed settings and offers a later successful retry', async () => {
  const h = harness(), data = state();
  await h.api.createCommunityRoom(data);
  data.meta.registrationCapacity = 8;
  h.ctx.window.engagementService.familyRegistration = async () => { throw new Error('local-summary-failed'); };
  assert.equal(await h.api.pushUpdate('LOCAL', data, { syncCommunitySummary: true }), true);
  assert.equal(h.docs.get('tournaments/LOCAL').capacity, 8);
  assert.equal(h.docs.get('publicTournaments/LOCAL').capacity, 8);
  assert.equal(h.ctx.window.__BXH_COMMUNITY_SUMMARY_STATUS.LOCAL.ok, false);
  const writes = h.writes.length;
  h.ctx.window.engagementService.familyRegistration = async () => ({ ok: true, communityParticipantCount: 3 });
  const retry = await h.api.syncCommunityRegistrationSummary('local');
  assert.equal(retry.ok, true);
  assert.equal(retry.communityParticipantCount, 3);
  assert.equal(h.ctx.window.__BXH_COMMUNITY_SUMMARY_STATUS.LOCAL.ok, true);
  assert.equal(h.writes.length, writes, 'Client retry only calls server summary, never rewrites settings');
});

test('invalid participant-summary responses are rejected without a false successful projection status', async () => {
  for (const value of [undefined, null, -1, 1.5, Infinity, NaN, '2']) {
    const h = harness();
    h.ctx.window.engagementService.familyRegistration = async () => ({ ok: true, communityParticipantCount: value });
    await assert.rejects(h.api.syncCommunityRegistrationSummary('LOCAL'), /invalid-summary-result/);
    assert.equal(h.ctx.window.__BXH_COMMUNITY_SUMMARY_STATUS.LOCAL.ok, false);
  }
});

test('summary refresh is scoped to quick COMMUNITY and post-start saves do not auto-refresh', async () => {
  for (const variant of [
    { eventAuthority: 'official', communityQuickRegistration: true },
    { eventAuthority: 'community', communityQuickRegistration: false },
  ]) {
    const h = harness(), data = state(variant);
    assert.equal(await h.api.pushUpdate('LOCAL', data, { syncCommunitySummary: true }), true);
    assert.equal(h.summaryCalls.length, 0);
  }
  const h = harness(), data = state();
  await h.api.createCommunityRoom(data);
  data.startedAt = NOW;
  data.players.push({ id: 'late-player', name: 'Late Player' });
  assert.equal(await h.api.pushUpdate('LOCAL', data), true);
  assert.equal(h.summaryCalls.length, 0);
  assert.equal(await h.api.pushUpdate('LOCAL', data, { syncCommunitySummary: true }), true);
  assert.equal(h.summaryCalls.length, 1);
});

test('individual community room creation rejects team data before any write', async () => {
  for (const marker of [undefined, false, true]) {
    const h = harness(), data = state({ battleMode: 'team', communityQuickRegistration: marker });
    await assert.rejects(h.api.createCommunityRoom(data), /community-quick-individual-only/);
    assert.equal(h.writes.length, 0);
    assert.equal(h.docs.size, 0);
  }
});

for (const apiName of ['createRoom', 'pushUpdate']) {
  test(apiName + ' preserves legacy team scheduled registration without individual quick opt-in', async () => {
    const h = harness(), data = state({ battleMode: 'team', teamSize: 3, communityQuickRegistration: undefined,
      registrationCapacity: 8, registrationOpenAt: NOW + 1000, registrationCloseAt: NOW + 2000,
      cancellationDeadline: NOW + 2000, registrationStatus: 'scheduled' });
    delete data.communityQuickRegistration;
    const result = apiName === 'createRoom' ? await h.api.createRoom(data) : await h.api.pushUpdate('LOCAL', data, { syncCommunitySummary: true });
    assert.equal(result, apiName === 'createRoom' ? 'LOCAL' : true);
    assert.equal(h.writes.length, 2);
    for (const doc of h.docs.values()) {
      assert.equal(doc.battleMode, 'team');
      assert.equal(doc.capacity, 8);
      assert.equal(doc.registrationStatus, 'scheduled');
      assert.equal(doc.registrationOpenAt, NOW + 1000);
      assert.equal(doc.registrationCloseAt, NOW + 2000);
      assert.equal(doc.cancellationDeadline, NOW + 2000);
      assert.equal(Object.hasOwn(doc, 'communityQuickRegistration'), false);
      assert.equal(Object.hasOwn(doc, 'communityParticipantCount'), false);
    }
    assert.equal(h.summaryCalls.length, 0);
  });

  test(apiName + ' rejects an invalid team quick marker before any document write', async () => {
    const h = harness(), data = state({ battleMode: 'team', communityQuickRegistration: true });
    const result = apiName === 'createRoom' ? await h.api.createRoom(data) : await h.api.pushUpdate('LOCAL', data);
    assert.equal(result, apiName === 'createRoom' ? null : false);
    assert(h.logs.some(args => args.some(error => error?.message === 'community-quick-individual-only')));
    assert.equal(h.writes.length, 0);
    assert.equal(h.docs.size, 0);
  });
}

test('unlimited online promotion uses only the trusted service and retains common read-back verification', async () => {
  const h = rosterHarness();
  const result = await h.api.mutateRegistrationRoster('local', 'REG', 'promote');
  assert.equal(result.verified, true);
  assert.equal(h.stats.transactions, 0);
  assert.equal(h.writes.length, 0);
  assert.equal(h.trustedCalls.length, 1);
  assert.equal(h.trustedCalls[0].name, 'registrationRosterService');
  assert.deepEqual(h.trustedCalls[0].payload, { action: 'promote', code: 'LOCAL', registrationId: 'REG', intent: 'admin', operationId: 'local-summary-operation' });
  assert.equal(h.trustedCalls[0].timeout, 60000);
  assert.equal(result.capacity, null);
});

test('unlimited promotion rejects expansion before either trusted or client mutation', async () => {
  const h = rosterHarness(), before = clone([...h.docs]);
  await assert.rejects(h.api.mutateRegistrationRoster('LOCAL', 'REG', 'promote', { expandBy: 8 }), /invalid-capacity-step/);
  assert.equal(h.trustedCalls.length, 0);
  assert.equal(h.stats.transactions, 0);
  assert.deepEqual(clone([...h.docs]), before);
});

test('trusted unlimited-promotion denial never falls back to a client transaction', async () => {
  const h = rosterHarness(), before = clone([...h.docs]);
  let calls = 0;
  h.ctx.callEngagementFunction = async () => { calls++; throw new Error('permission-denied'); };
  await assert.rejects(h.api.mutateRegistrationRoster('LOCAL', 'REG', 'promote'), /permission-denied/);
  assert.equal(calls, 1);
  assert.equal(h.stats.transactions, 0);
  assert.equal(h.writes.length, 0);
  assert.deepEqual(clone([...h.docs]), before);
});

test('finite and unmarked legacy promotions keep the existing client transaction route', async () => {
  const finite = rosterHarness({ capacity: 8 });
  const finiteResult = await finite.api.mutateRegistrationRoster('LOCAL', 'REG', 'promote');
  assert.equal(finiteResult.verified, true);
  assert.equal(finiteResult.capacity, 8);
  assert.equal(finite.stats.transactions, 1);
  assert.equal(finite.trustedCalls.length, 0);

  const legacy = rosterHarness();
  for (const key of ['tournaments/LOCAL', 'publicTournaments/LOCAL']) delete legacy.docs.get(key).communityQuickRegistration;
  const runtime = JSON.parse(legacy.docs.get('tournaments/LOCAL').data);
  delete runtime.communityQuickRegistration;
  delete runtime.meta.communityQuickRegistration;
  legacy.docs.get('tournaments/LOCAL').data = JSON.stringify(runtime);
  const legacyResult = await legacy.api.mutateRegistrationRoster('LOCAL', 'REG', 'promote');
  assert.equal(legacyResult.verified, true);
  assert.equal(legacyResult.capacity, 0, 'Legacy null retains its existing numeric-zero behavior');
  assert.equal(legacy.stats.transactions, 1);
  assert.equal(legacy.trustedCalls.length, 0);
});
