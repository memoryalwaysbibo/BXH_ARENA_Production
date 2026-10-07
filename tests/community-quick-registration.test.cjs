'use strict';

// Local VM regressions for COMMUNITY quick registration. No network or Firebase writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const core = read('modules/main-app/core.js');
const domain = read('modules/main-app/domain-utils.js');
const registration = read('modules/main-app/registration-utils.js');
const host = read('modules/main-app/community-host.js');
const input = read('modules/main-app/input-utils.js');
const NOW = Date.parse('2026-10-06T12:00:00+08:00');
const clone = value => JSON.parse(JSON.stringify(value));
const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : [NOW])); }
  static now() { return NOW; }
}

function extractFunction(source, name) {
  const match = new RegExp('^(?:async )?function ' + name + '\\(', 'm').exec(source);
  assert(match, 'Missing production function ' + name);
  const start = match.index;
  const firstLineEnd = source.indexOf('\n', start);
  const firstLine = source.slice(start, firstLineEnd);
  if (/\}\s*$/.test(firstLine)) return firstLine;
  const end = source.indexOf('\n}', start);
  assert(end >= start, 'Missing production function boundary for ' + name);
  return source.slice(start, end + 2);
}

function context(extra = {}) {
  const ctx = vm.createContext({ console, Date: FixedDate, window: {}, esc, communitySettingsSaving: false, communityCreateSaving: false, communitySettingsWriteGate: null, ...extra });
  for (const [name, source] of [['domain', domain], ['registration', registration], ['input', input]]) {
    vm.runInContext(source, ctx, { filename: name + '-utils.js' });
  }
  Object.assign(ctx, ctx.window.BXHDomainUtils, ctx.window.BXHRegistrationUtils, ctx.window.BXHInputUtils);
  for (const name of [
    'computeRegistrationStatus', 'getEffectiveRegistrationStatus', 'lobbyEventStartMs',
    'lobbyMyRegistration', 'lobbySummary', 'lobbyNewestFirst', 'lobbyLists',
    'lobbyRegistrationButtons', 'publicEventLifecycleStatus',
  ]) vm.runInContext(extractFunction(core, name), ctx, { filename: name + '.js' });
  return ctx;
}

function quick(overrides = {}) {
  return {
    code: 'COMMUNITY-QUICK', name: 'Local test room', eventAuthority: 'community',
    communityQuickRegistration: true, registrationEnabled: true, registrationStatus: 'open',
    capacity: null, confirmedCount: 150, waitlistEnabled: false, waitlistCount: 0,
    waitlistCapacity: 0, tournamentPhase: 'waiting', visibility: 'public', publishedAt: NOW - 1000,
    registrationOpenAt: null, registrationCloseAt: null, cancellationDeadline: null,
    eventDate: '2026-10-05', startAt: '12:00', targetGroup: 'open', ...overrides,
  };
}

function renderDetail(t, registrations = [], overrides = {}) {
  const ctx = context({
    tournamentDetailCode: t.code, tournamentDetailData: t, tournamentDetailLoading: false,
    tournamentDetailError: null, tournamentDetailMyRegs: registrations, tournamentDetailMyReg: null,
    tournamentDetailBusy: false, tournamentDetailChildConfirmed: false,
    userProfile: { realName: 'Local Tester', displayName: 'Tester' },
    firebaseUser: { uid: 'local-test-user', email: 'test@example.invalid' },
    isGuestReadOnlyContext: () => false, publicVenueFromTournament: () => ({}),
    renderVenueNavigationMenu: () => '', authShellOpen: () => '', authBrandHeader: () => '',
    renderTournamentStandardTemplate: () => '', renderModal: () => '',
    renderRegistrationCountdown: () => '<span>COUNTDOWN</span>',
    TARGET_GROUP_LABELS: { open: '公開組', children: '兒童' },
    TARGET_GROUP_DESCRIPTIONS: { open: '公開組', children: '兒童' },
    FORMAT_LABELS: { single: '單淘汰賽' },
    REGISTRATION_STATUS_LABELS: { open: '報名中', closed: '報名截止', full: '已額滿', scheduled: '尚未開放' },
    ...overrides,
  });
  vm.runInContext(extractFunction(core, 'renderTournamentDetailScreen'), ctx);
  return ctx.renderTournamentDetailScreen();
}

const activeButtons = (html, mode) => [...html.matchAll(/<button\b[^>]*>/g)].map(match => match[0])
  .filter(tag => tag.includes('data-action="submit-tournament-registration"') && (!mode || tag.includes('data-participant-mode="' + mode + '"')) && !/\bdisabled\b/.test(tag));

function saveHarness({ capacity = '', enabled = true, saveResult = true, meta = {}, fields = {}, save } = {}) {
  const elements = {
    'cset-name': { value: 'Updated room' }, 'cset-date': { value: '2026-10-05' },
    'cset-location': { value: 'Local venue' }, 'cset-start': { value: '11:00' },
    'cset-format': { value: 'single' }, 'cset-stations': { value: '2' },
    'cset-registration-enabled': { checked: enabled }, 'cset-capacity': { value: capacity, validity: { badInput: false } },
    'cset-waitlist': { value: '3' }, 'cset-reg-open': { value: '' }, 'cset-reg-close': { value: '' }, 'cset-reg-cancel': { value: '' }, 'cset-access-mode': { value: 'public' },
    'cset-access-password': { value: '' }, ...fields,
  };
  for(const [id,input]of Object.entries(elements)){input.id=id;input.dataset={};input.type=id==='cset-registration-enabled'?'checkbox':id==='cset-access-password'?'password':'text';input.disabled=false;}
  const original = {
    id: 'local-room', cloudCode: 'COMMUNITY-QUICK', startedAt: null, matches: [], players: [],
    meta: { name: 'Original room', date: '2026-10-05', location: 'Original venue',
      startTime: '10:00', formatType: 'single', stations: 1, eventAuthority: 'community',
      roomAccessMode: 'public', registrationEnabled: false, registrationStatus: 'closed',
      registrationCapacity: 16, waitlistCapacity: 0, registrationOpenAt: NOW - 20000,
      registrationCloseAt: NOW - 10000, cancellationDeadline: NOW - 10000, ...meta },
  };
  const saves = [], toasts = [], accessCalls = [];
  let renderCount = 0;
  const ctx = context({
    state: clone(original), document: { getElementById: id => elements[id] || null, querySelectorAll: () => Object.values(elements) },
    appPhase:'community-room',communityRoomActiveTab:'settings',communityRoomSnapshotGeneration:0,communitySettingsRenderedContext:null,canManageRegistrationRoster:()=>true,
    FORMAT_LABELS: { single: '單淘汰賽' }, crypto: { randomUUID: () => 'local-operation' },
    publicTournamentsCache: [{ code: 'stale' }], communityEventsCache: [{ code: 'stale' }],
    isCommunityRoomOwner: () => true, touchCommunityActivity: () => {},
    currentAuthUid: () => 'local-test-user', cloudAvailable: () => true, flushCloudStateWrites: async () => {},
    cloudSyncPending: false, cloudSyncQueueTimer: null, clearInterval, saveRecord: async () => {},
    cloneStateForSave: clone,
    render: () => { renderCount++; }, showToast: (message, error) => toasts.push({ message, error: !!error }),
  });
  for(const name of ['communitySettingsDraftContext','communitySettingsInputs','communitySettingBadInput','setCommunitySettingsInputsSaving','captureCommunitySettingsInputs','restoreCommunitySettingsInputs','renderCommunityRoomPreservingSettings'])vm.runInContext(extractFunction(core,name),ctx);
  ctx.saveState = async (options = {}) => {
    const snapshot = options.snapshot || ctx.state;
    if (snapshot.meta.registrationEnabled) snapshot.meta.registrationStatus = ctx.computeRegistrationStatus(snapshot.meta, snapshot);
    saves.push(clone(snapshot));
    if (save) return save();
    if (saveResult instanceof Error) throw saveResult;
    return saveResult;
  };
  ctx.window.cloudSync = { connect: async () => {}, joinRoom: async () => ({ ok: false }) };
  ctx.window.engagementService = { roomAccess: async payload => { accessCalls.push(payload); return { ok: true }; } };
  const start = core.indexOf('  if(action==="community-save-settings"){');
  const end = core.indexOf('\n  if(action==="toggle-lobby-section")', start);
  assert(start >= 0 && end > start, 'Community save action source seam exists');
  vm.runInContext('function runSave(){ const action="community-save-settings"; const target={};\n' + core.slice(start, end) + '\n}', ctx);
  return { ctx, original, elements, saves, toasts, accessCalls, renderCount: () => renderCount,
    async run() { ctx.runSave(); await new Promise(resolve => setImmediate(resolve)); } };
}

test('quick registration opt-in requires a literal true marker and COMMUNITY authority', () => {
  const { isCommunityQuickRegistration: isQuick } = context();
  assert.equal(typeof isQuick, 'function');
  assert.equal(isQuick(quick()), true);
  assert.equal(isQuick({ meta: { eventAuthority: 'community', communityQuickRegistration: true } }), true);
  assert.equal(isQuick({ parsedData: { meta: { eventAuthority: 'community', communityQuickRegistration: true } } }), true);
  for (const marker of [undefined, null, false, 'true', 1]) assert.equal(isQuick(quick({ communityQuickRegistration: marker })), false);
  assert.equal(isQuick(quick({ eventAuthority: 'official' })), false);
  assert.equal(isQuick({ communityQuickRegistration: true }), false);
  assert.equal(isQuick({ eventAuthority: 'official', parsedData: { meta: { eventAuthority: 'community', communityQuickRegistration: true } } }), false);
});

test('only explicit null capacity on an opted-in COMMUNITY room means unlimited', () => {
  const { isUnlimitedCommunityRegistration: unlimited } = context();
  assert.equal(typeof unlimited, 'function');
  assert.equal(unlimited(quick()), true);
  assert.equal(unlimited({ meta: { eventAuthority: 'community', communityQuickRegistration: true, registrationCapacity: null } }), true);
  for (const capacity of [undefined, '', 0, -1, 1, 16, Infinity, NaN]) assert.equal(unlimited(quick({ capacity })), false, 'Capacity ' + String(capacity));
  assert.equal(unlimited(quick({ eventAuthority: 'official' })), false);
  assert.equal(unlimited(quick({ communityQuickRegistration: false })), false);
  assert.equal(unlimited({ eventAuthority: 'community', communityQuickRegistration: true }), false);
});

test('quick registration opens immediately without dates, even after the event scheduled time', () => {
  const ctx = context({ state: { startedAt: null, matches: [] } });
  const t = quick();
  assert.equal(ctx.getEffectiveRegistrationStatus(t, NOW), 'open');
  assert.equal(ctx.getEffectiveRegistrationStatus(quick({ registrationOpenAt: NOW + 10000 }), NOW), 'scheduled', 'Optional explicit opening dates remain respected');
  assert.equal(ctx.getEffectiveRegistrationStatus(quick({ registrationCloseAt: NOW - 10000 }), NOW), 'closed', 'Optional explicit closing dates remain respected');
  assert.equal(ctx.computeRegistrationStatus({ ...t, registrationCapacity: null }), 'open');
  assert.equal(ctx.getEffectiveRegistrationStatus(quick({ capacity: 3, confirmedCount: 2 }), NOW), 'open');
  assert.equal(ctx.getEffectiveRegistrationStatus(quick({ capacity: 3, confirmedCount: 3 }), NOW), 'full');
});

test('disabled and explicitly closed quick rooms never reopen from stale dates', () => {
  const ctx = context({ state: { startedAt: null, matches: [] } });
  assert.equal(ctx.getEffectiveRegistrationStatus(quick({ registrationEnabled: false }), NOW), 'closed');
  assert.equal(ctx.getEffectiveRegistrationStatus(quick({ registrationStatus: 'closed', registrationOpenAt: NOW - 1000 }), NOW), 'closed');
  assert.equal(ctx.computeRegistrationStatus({ ...quick(), registrationEnabled: false }), null);
});

test('actual lifecycle locks quick registration and cancellation while clock time alone does not', () => {
  const ctx = context();
  assert.equal(ctx.communityRegistrationLocked(quick()), false);
  assert.equal(ctx.canCancelCommunityRegistration(quick(), NOW), true);
  const lockedVariants = [
    { startedAt: NOW - 1 }, { parsedData: { startedAt: NOW - 1 } },
    { tournamentPhase: 'live' }, { tournamentPhase: 'settling' }, { tournamentPhase: 'done' },
    { tournamentPhase: 'cancelled' }, { eventCancelled: true }, { archiveStatus: 'completed' },
    { parsedData: { archiveStatus: 'completed' } },
  ];
  for (const variant of lockedVariants) {
    const t = quick(variant);
    assert.equal(ctx.communityRegistrationLocked(t), true, JSON.stringify(variant));
    assert.equal(ctx.canCancelCommunityRegistration(t, NOW), false, JSON.stringify(variant));
    assert(['started', 'cancelled', 'closed'].includes(ctx.getEffectiveRegistrationStatus(t, NOW)), JSON.stringify(variant));
  }
});

test('legacy COMMUNITY and official status and cancellation deadlines stay scheduled', () => {
  const ctx = context();
  for (const t of [quick({ communityQuickRegistration: undefined }), quick({ eventAuthority: 'official' })]) {
    assert.equal(ctx.getEffectiveRegistrationStatus({ ...t, capacity: 10, confirmedCount: 0, registrationOpenAt: NOW + 1000, registrationCloseAt: NOW + 2000 }, NOW), 'scheduled');
    assert.equal(ctx.getEffectiveRegistrationStatus({ ...t, registrationOpenAt: NOW - 2000, registrationCloseAt: NOW - 1000 }, NOW), 'closed');
    assert.equal(ctx.canCancelCommunityRegistration({ ...t, cancellationDeadline: NOW + 1000 }, NOW), false, 'The quick-only helper must not opt in legacy or official rooms');
    const registered = [{ status: 'confirmed', uid: 'local-test-user' }];
    assert.match(renderDetail({ ...t, cancellationDeadline: NOW + 1000 }, registered), /data-action="cancel-my-registration"/);
    assert.doesNotMatch(renderDetail({ ...t, cancellationDeadline: null }, registered), /data-action="cancel-my-registration"/);
    assert.doesNotMatch(renderDetail({ ...t, cancellationDeadline: NOW }, registered), /data-action="cancel-my-registration"/);
  }
});

test('unlimited detail offers self and child confirmed registration without showing infinity', () => {
  const html = renderDetail(quick());
  assert.equal(activeButtons(html, 'self').length, 1);
  assert.equal(activeButtons(html, 'children').length, 1);
  assert.match(html, /不限|無上限/);
  assert.doesNotMatch(html, /Infinity|NaN|本人加入備取|兒童加入備取/);
});

test('already registered self can add a child and cancel in unlimited quick rooms', () => {
  const html = renderDetail(quick(), [{ status: 'confirmed', uid: 'local-test-user', displayName: 'Self' }]);
  assert.equal(activeButtons(html, 'self').length, 0);
  assert.equal(activeButtons(html, 'children').length, 1);
  assert.match(html, /data-action="cancel-my-registration"/);
  assert.doesNotMatch(html, /Infinity|NaN|替兒童報名｜正取與備取名額已滿/);
});

test('a registered child does not consume the remaining self or sibling options in unlimited rooms', () => {
  const html = renderDetail(quick(), [{ status: 'confirmed', familyPlayerId: 'local-child', displayName: 'Child' }]);
  assert.equal(activeButtons(html, 'self').length, 1);
  assert.equal(activeButtons(html, 'children').length, 1);
});

test('finite full quick rooms retain waitlist behavior and disable additional child when exhausted', () => {
  const full = quick({ capacity: 1, confirmedCount: 1 });
  assert.equal(activeButtons(renderDetail(full)).length, 0);
  assert.equal(activeButtons(renderDetail(full, [{ status: 'confirmed', uid: 'local-test-user' }]), 'children').length, 0);
  const html = renderDetail({ ...full, waitlistEnabled: true, waitlistCapacity: 2 });
  assert.match(html, /本人加入備取/);
  assert.match(html, /兒童加入備取/);
});

test('closed, started, archived and cancelled quick detail never offers registration actions', () => {
  for (const variant of [
    { registrationEnabled: false, registrationStatus: 'closed' },
    { startedAt: NOW }, { tournamentPhase: 'live' }, { archiveStatus: 'completed' }, { eventCancelled: true },
  ]) {
    assert.equal(activeButtons(renderDetail(quick(variant))).length, 0, JSON.stringify(variant));
    const registered = renderDetail(quick(variant), [{ status: 'confirmed', uid: 'local-test-user' }]);
    assert.equal(activeButtons(registered).length, 0, JSON.stringify(variant));
    if (variant.registrationEnabled !== false) assert.doesNotMatch(registered, /data-action="cancel-my-registration"/, JSON.stringify(variant));
  }
});

test('official and legacy null-capacity detail does not gain unlimited child slots', () => {
  for (const variant of [{ eventAuthority: 'official' }, { communityQuickRegistration: undefined }]) {
    const t = quick({ ...variant, registrationOpenAt: NOW - 1000, registrationCloseAt: NOW + 1000 });
    const registered = renderDetail(t, [{ status: 'confirmed', uid: 'local-test-user' }]);
    assert.equal(activeButtons(registered, 'children').length, 0);
    assert.doesNotMatch(registered, /data-action="cancel-my-registration"/);
    assert.doesNotMatch(registered, /不限|無上限/);
  }
});

test('quick rooms enter the lobby registration section and show registration lifecycle', () => {
  const ctx = context({ lobbyMatchesActiveFilters: () => true, myRegistrationsCache: [] });
  const t = quick();
  const lists = ctx.lobbyLists([t, { ...t, code: 'CLOSED', registrationEnabled: false, registrationStatus: 'closed' }]);
  assert.deepEqual(Array.from(lists.registration, row => row.code), [t.code]);
  assert.deepEqual(Array.from(lists.waiting, row => row.code), ['CLOSED']);
  assert.equal(ctx.publicEventLifecycleStatus(t).key, 'registration');
  assert.match(ctx.lobbyRegistrationButtons(ctx.lobbySummary(t), true), /報名/);
});

test('host settings render blank unlimited capacity with no required registration dates', () => {
  const ctx = context({ state: { meta: { ...quick(), registrationCapacity: null }, matches: [] } });
  vm.runInContext(host, ctx);
  const html = ctx.window.BXHCommunityHostFeature.renderCommunitySettings();
  const capacityTag = html.match(/<input\b[^>]*id="cset-capacity"[^>]*>/)?.[0];
  assert(capacityTag, 'Capacity input exists');
  assert.match(capacityTag, /value=""/);
  assert.doesNotMatch(capacityTag, /\bmax="256"|\brequired\b/);
  assert.match(html, /不限|無上限/);
  for (const tag of html.match(/<input\b[^>]*id="cset-reg-(?:open|close|cancel)"[^>]*>/g) || []) {
    assert.doesNotMatch(tag, /\brequired\b/);
    assert.match(tag, /value=""/);
  }
});

test('blank capacity saves immediately open with null capacity and survives JSON reload', async () => {
  const h = saveHarness();
  await h.run();
  assert.equal(h.saves.length, 1);
  const saved = h.saves[0].meta;
  assert.equal(saved.registrationEnabled, true);
  assert.equal(saved.communityQuickRegistration, true);
  assert.equal(saved.registrationStatus, 'open');
  assert.equal(saved.registrationCapacity, null);
  assert.equal(saved.registrationCloseAt, null);
  assert.equal(saved.cancellationDeadline, null);
  assert(saved.registrationOpenAt == null || saved.registrationOpenAt <= NOW);
  assert.equal(h.ctx.publicTournamentsCache, null);
  assert(h.toasts.some(t => !t.error && /已儲存/.test(t.message)), JSON.stringify(h.toasts));
  const reloaded = clone(h.saves[0]);
  const ctx = context({ state: reloaded });
  assert.equal(ctx.computeRegistrationStatus(reloaded.meta), 'open');
  const projected = { ...reloaded.meta, capacity: reloaded.meta.registrationCapacity, tournamentPhase: 'waiting' };
  assert.equal(ctx.getEffectiveRegistrationStatus(projected, NOW + 86400000), 'open');
  assert.equal(ctx.isUnlimitedCommunityRegistration(projected), true);
});

for (const capacity of ['1', '17', '257', String(Number.MAX_SAFE_INTEGER)]) {
  test('positive safe integer capacity survives save without clamping: ' + capacity, async () => {
    const h = saveHarness({ capacity });
    await h.run();
    assert.equal(h.saves.length, 1);
    assert.equal(h.saves[0].meta.registrationCapacity, Number(capacity));
  });
}

for (const capacity of ['0', '-1', '1.5', 'Infinity', '-Infinity', 'NaN', 'invalid', '9007199254740992', '1e309']) {
  test('invalid nonblank capacity is rejected before state mutation: ' + capacity, async () => {
    const h = saveHarness({ capacity });
    await h.run();
    assert.equal(h.saves.length, 0);
    assert.equal(h.accessCalls.length, 0);
    assert.deepEqual(clone(h.ctx.state), h.original);
    assert(h.toasts.some(t => t.error), 'Invalid capacity must show an error');
  });
}

test('browser badInput cannot be mistaken for intentional blank unlimited capacity', async () => {
  const h = saveHarness({ fields: { 'cset-capacity': { value: '', validity: { badInput: true } } } });
  await h.run();
  assert.equal(h.saves.length, 0);
  assert.deepEqual(clone(h.ctx.state), h.original);
  assert(h.toasts.some(t => t.error));
});

test('turning registration off saves closed and stays closed after reload', async () => {
  const h = saveHarness({ enabled: false, meta: { registrationEnabled: true, communityQuickRegistration: true, registrationStatus: 'open', registrationCapacity: null } });
  await h.run();
  assert.equal(h.saves.length, 1);
  const saved = h.saves[0].meta;
  assert.equal(saved.registrationEnabled, false);
  assert.equal(saved.registrationStatus, 'closed');
  assert.equal(context().getEffectiveRegistrationStatus({ ...saved, capacity: saved.registrationCapacity }, NOW), 'closed');
});

for (const saveResult of [false, new Error('local-save-failed')]) {
  test('failed persistence rolls back changed metadata and never reports success: ' + String(saveResult), async () => {
    const h = saveHarness({ saveResult });
    await h.run();
    assert.equal(h.saves.length, 1);
    assert.deepEqual(clone(h.ctx.state.meta), h.original.meta);
    assert(!h.toasts.some(t => !t.error && /已儲存/.test(t.message)));
    assert(h.toasts.some(t => t.error));
  });
}

test('save success is not announced before persistence resolves', async () => {
  let finish;
  const h = saveHarness({ save: () => new Promise(resolve => { finish = resolve; }) });
  await h.run();
  assert.equal(h.saves.length, 1);
  assert(!h.toasts.some(t => !t.error && /已儲存/.test(t.message)));
  finish(true);
  await new Promise(resolve => setImmediate(resolve));
  assert(h.toasts.some(t => !t.error && /已儲存/.test(t.message)));
});

test('a normal public settings save does not reference an undefined metadata variable', async () => {
  const h = saveHarness();
  await assert.doesNotReject(h.run());
  assert.equal(h.accessCalls.length, 0);
  assert.equal(h.saves.length, 1);
});

test('capacity parser distinguishes blank from zero, malformed and unsafe values', () => {
  const { parseCommunityRegistrationCapacity: parse } = context();
  for (const blank of ['', '   ', null, undefined]) assert.equal(parse(blank), null);
  for (const value of [1, ' 42 ', 257, Number.MAX_SAFE_INTEGER]) assert.equal(parse(value), Number(value));
  for (const value of [0, -1, 0.5, '3people', Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => parse(value), /invalid-registration-capacity/, String(value));
  }
});

test('quick cancellation remains allowed when host disables new registration, but respects explicit deadlines', () => {
  const ctx = context();
  const t = quick({ registrationEnabled: false, registrationStatus: 'closed' });
  assert.equal(ctx.canCancelCommunityRegistration(t, NOW), true);
  assert.equal(ctx.canCancelCommunityRegistration({ ...t, cancellationDeadline: NOW + 1 }, NOW), true);
  assert.equal(ctx.canCancelCommunityRegistration({ ...t, cancellationDeadline: NOW }, NOW), false);
  assert.equal(ctx.canCancelCommunityRegistration({ ...t, cancellationDeadline: NOW - 1 }, NOW), false);
  const registered = [{ status: 'confirmed', uid: 'local-test-user' }];
  const html = renderDetail(t, registered);
  assert.equal(activeButtons(html).length, 0);
  assert.match(html, /data-action="cancel-my-registration"/);
  assert.doesNotMatch(renderDetail({ ...t, cancellationDeadline: NOW }, registered), /data-action="cancel-my-registration"/);
});

test('quick room malformed non-null capacities fail closed rather than silently becoming unlimited', () => {
  const ctx = context();
  for (const capacity of [undefined, '', 0, -1, 1.5, Infinity, NaN, '16']) {
    assert.equal(ctx.getEffectiveRegistrationStatus(quick({ capacity }), NOW), 'closed', String(capacity));
    assert.equal(activeButtons(renderDetail(quick({ capacity }))).length, 0, String(capacity));
  }
});

test('guest, logged-out and incomplete-profile readers never get quick registration submit actions', () => {
  for (const overrides of [
    { isGuestReadOnlyContext: () => true },
    { firebaseUser: null, userProfile: null },
    { userProfile: { displayName: 'Incomplete' } },
  ]) assert.equal(activeButtons(renderDetail(quick(), [], overrides)).length, 0);
});

test('optional explicit registration windows are saved and preserved after reload', async () => {
  const open = '2026-10-07T12:00:00Z', close = '2026-10-08T12:00:00Z', cancel = '2026-10-08T13:00:00Z';
  const h = saveHarness({ fields: {
    'cset-reg-open': { value: open }, 'cset-reg-close': { value: close }, 'cset-reg-cancel': { value: cancel },
  } });
  await h.run();
  assert.equal(h.saves.length, 1);
  const m = h.saves[0].meta;
  assert.equal(m.registrationOpenAt, Date.parse(open));
  assert.equal(m.registrationCloseAt, Date.parse(close));
  assert.equal(m.cancellationDeadline, Date.parse(cancel));
  const ctx = context();
  const projected = { ...clone(m), capacity: m.registrationCapacity };
  assert.equal(ctx.getEffectiveRegistrationStatus(projected, NOW), 'scheduled');
  assert.equal(ctx.getEffectiveRegistrationStatus(projected, Date.parse(open)), 'open');
  assert.equal(ctx.getEffectiveRegistrationStatus(projected, Date.parse(close)), 'closed');
});

for (const fields of [
  { 'cset-reg-open': { value: 'invalid' } },
  { 'cset-reg-close': { value: 'invalid' } },
  { 'cset-reg-cancel': { value: 'invalid' } },
  { 'cset-reg-open': { value: '2026-10-07T12:00:00Z' }, 'cset-reg-close': { value: '2026-10-07T12:00:00Z' } },
  { 'cset-waitlist': { value: '1.5' } },
  { 'cset-access-mode': { value: 'password' }, 'cset-access-password': { value: 'ab' } },
]) {
  test('other invalid settings are rejected before metadata mutation: ' + Object.keys(fields).join(', '), async () => {
    const h = saveHarness({ fields });
    await h.run();
    assert.equal(h.saves.length, 0);
    assert.equal(h.accessCalls.length, 0);
    assert.deepEqual(clone(h.ctx.state), h.original);
    assert(h.toasts.some(t => t.error));
  });
}

test('double-clicking save while persistence is pending performs only one write', async () => {
  let finish;
  const h = saveHarness({ save: () => new Promise(resolve => { finish = resolve; }) });
  await h.run();
  await h.run();
  assert.equal(h.saves.length, 1);
  assert.equal(h.ctx.communitySettingsSaving, true);
  finish(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.ctx.communitySettingsSaving, false);
  assert.equal(h.toasts.filter(t => !t.error && /已儲存/.test(t.message)).length, 1);
});

test('navigation to a different room during flush does not mutate or save that room', async () => {
  let finish;
  const h = saveHarness();
  h.ctx.flushCloudStateWrites = () => new Promise(resolve => { finish = resolve; });
  await h.run();
  h.ctx.state = { id: 'other-room', cloudCode: 'OTHER', meta: { name: 'Other room' }, matches: [] };
  finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.saves.length, 0);
  assert.equal(h.ctx.state.meta.name, 'Other room');
  assert.equal(h.ctx.communitySettingsSaving, false);
  assert(!h.toasts.some(t => !t.error && /已儲存/.test(t.message)));
});

test('new room creation UI leaves registration unchecked and capacity blank', () => {
  const ctx = context({ userProfile: { displayName: 'Local Host' }, firebaseUser: { uid: 'host' },
    authShellOpen: () => '', authShellClose: () => '', authBrandHeader: () => '' });
  vm.runInContext(host, ctx);
  const html = ctx.window.BXHCommunityHostFeature.renderCommunityCreateScreen();
  const checkbox = html.match(/<input\b[^>]*id="community-registration-enabled"[^>]*>/)?.[0];
  const capacity = html.match(/<input\b[^>]*id="community-capacity"[^>]*>/)?.[0];
  assert(checkbox);
  assert.doesNotMatch(checkbox, /\bchecked\b/);
  assert(capacity);
  assert.doesNotMatch(capacity, /\bvalue="[^\"]+"|\brequired\b|\bmax=/);
});

function createHarness({ enabled = false, capacity = '', fields = {} } = {}) {
  const creates = [], toasts = [];
  const elements = { 'community-format': { value: 'single' },
    'community-registration-enabled': { checked: enabled },
    'community-capacity': { value: capacity, validity: { badInput: false } }, ...fields };
  const ctx = context({
    userProfile: { displayName: 'Local Host' }, firebaseUser: { uid: 'local-host' }, appPhase: 'community-create',
    document: { getElementById: id => elements[id] || null }, FORMAT_LABELS: { single: '單淘汰賽' },
    cloudAvailable: () => true, defaultState: () => ({ id: 'new-local-room', meta: {}, matches: [] }),
    uid: () => 'local-player', communityRoomExpiryMs: () => NOW + 3600000,
    saveRecord: async () => {}, setCurrentId: async () => {}, cloudUnsub: null,
    applyRemoteState: () => {}, render: () => {}, showToast: (message, error) => toasts.push({ message, error: !!error }),
  });
  ctx.currentAuthUid = () => ctx.firebaseUser?.uid || '';
  vm.runInContext('let communityRoomSnapshotGeneration=0;\n'+extractFunction(core,'invalidateCommunityRoomSnapshotContext')+'\n'+extractFunction(core,'subscribeCommunityRoomState'),ctx);
  ctx.window.cloudSync = { connect: async () => {}, subscribe: () => () => {},
    createCommunityRoom: async state => { creates.push(clone(state)); return 'LOCAL-CREATED'; } };
  const start = core.indexOf('  if(action==="community-create-submit"){');
  const end = core.indexOf('\n  if(action==="community-open-room")', start);
  assert(start >= 0 && end > start);
  vm.runInContext('function runCreate(){const action="community-create-submit";const target={};\n' + core.slice(start, end) + '\n}', ctx);
  return { ctx, creates, toasts, async run() { ctx.runCreate(); await new Promise(resolve => setImmediate(resolve)); } };
}

test('new default room keeps online registration closed with a null optional capacity', async () => {
  const h = createHarness();
  await h.run();
  assert.equal(h.creates.length, 1);
  const saved = h.creates[0];
  assert.equal(saved.meta.registrationEnabled, false);
  assert.equal(saved.meta.registrationStatus, 'closed');
  assert.equal(saved.meta.registrationCapacity, null);
  assert.equal(saved.players.length, 1);
  assert.equal(saved.players[0].isRoomOwner, true);
  assert.equal(saved.ownerUid, 'local-host');
  assert.equal(h.ctx.communityCreateSaving, false);
});

test('explicit registration checkbox opens newly created room without scheduled dates', async () => {
  const h = createHarness({ enabled: true });
  await h.run();
  assert.equal(h.creates.length, 1);
  const m = h.creates[0].meta;
  assert.equal(m.communityQuickRegistration, true);
  assert.equal(m.registrationEnabled, true);
  assert.equal(m.registrationStatus, 'open');
  assert.equal(m.registrationCapacity, null);
  assert.equal(m.registrationOpenAt, null);
  assert.equal(m.registrationCloseAt, null);
  assert.equal(m.cancellationDeadline, null);
});

for (const capacity of ['0', '-1', '1.5', 'Infinity', '9007199254740992']) {
  test('new room rejects invalid capacity before creating anything: ' + capacity, async () => {
    const h = createHarness({ enabled: true, capacity });
    await h.run();
    assert.equal(h.creates.length, 0);
    assert(h.toasts.some(t => t.error));
    assert.equal(h.ctx.communityCreateSaving, false);
  });
}

test('finite create keeps the exact host capacity with registration enabled', async () => {
  const h = createHarness({ enabled: true, capacity: '257' });
  await h.run();
  assert.equal(h.creates.length, 1);
  assert.equal(h.creates[0].meta.registrationCapacity, 257);
  assert.equal(h.creates[0].meta.registrationStatus, 'open');
});

test('failed access change leaves settings and registration untouched', async () => {
  const h = saveHarness({ fields: { 'cset-access-mode': { value: 'password' }, 'cset-access-password': { value: 'local-password' } } });
  let calls = 0;
  h.ctx.window.engagementService.roomAccess = async () => { calls++; throw new Error('room-access-config-failed'); };
  await h.run();
  assert.equal(calls, 1);
  assert.equal(h.saves.length, 0);
  assert.deepEqual(clone(h.ctx.state), h.original);
  assert(h.toasts.some(t => t.error));
  assert.equal(h.ctx.communitySettingsSaving, false);
});

test('successful access change plus settings save failure retains access and discloses partial success', async () => {
  const h = saveHarness({ saveResult: false, fields: { 'cset-access-mode': { value: 'password' }, 'cset-access-password': { value: 'local-password' } } });
  await h.run();
  assert.equal(h.accessCalls.length, 1);
  assert.equal(h.saves.length, 1);
  assert.deepEqual(clone(h.ctx.state.meta), { ...h.original.meta, roomAccessMode: 'password' });
  assert(h.toasts.some(t => t.error && /房間存取已更新/.test(t.message)));
  assert(!h.toasts.some(t => !t.error && /已儲存/.test(t.message)));
});

for (const result of [true, false]) {
  test('navigation during pending save never clobbers the new room or announces stale success: ' + result, async () => {
    let finish;
    const h = saveHarness({ save: () => new Promise(resolve => { finish = resolve; }) });
    await h.run();
    assert.equal(h.saves.length, 1);
    const other = { id: 'other-room', cloudCode: 'OTHER', meta: { name: 'Other room' }, matches: [] };
    h.ctx.state = clone(other);
    finish(result);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(clone(h.ctx.state), other);
    assert.equal(h.ctx.communitySettingsSaving, false);
    assert.equal(h.toasts.length, 0);
  });
}

test('new room creation rejects browser invalid-number state before any cloud write', async () => {
  const h = createHarness({ enabled: true, fields: { 'community-capacity': { value: '', validity: { badInput: true } } } });
  await h.run();
  assert.equal(h.creates.length, 0);
  assert(h.toasts.some(t => t.error));
});

test('double-clicking create only creates one room', async () => {
  const h = createHarness({ enabled: true });
  let finish;
  h.ctx.window.cloudSync.createCommunityRoom = state => { h.creates.push(clone(state)); return new Promise(resolve => { finish = resolve; }); };
  await h.run();
  await h.run();
  assert.equal(h.creates.length, 1);
  assert.equal(h.ctx.communityCreateSaving, true);
  finish('LOCAL-CREATED');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.ctx.communityCreateSaving, false);
});

for (const saveResult of [true, false]) {
  test('rendered settings save button unlocks after completion and accepts another save: ' + saveResult, async () => {
    const h = saveHarness({ saveResult });
    vm.runInContext(host, h.ctx);
    let renderedButton = null;
    h.ctx.render = () => {
      const html = h.ctx.window.BXHCommunityHostFeature.renderCommunitySettings();
      const tag = html.match(/<button\b[^>]*data-action="community-save-settings"[^>]*>/)?.[0];
      assert(tag, 'Rendered settings still include the save button');
      renderedButton = { disabled: /\bdisabled\b/.test(tag), textContent: /\bdisabled\b/.test(tag) ? '儲存中…' : '儲存一般賽事設定' };
    };
    h.ctx.document.querySelector = selector => selector.includes('community-save-settings') ? renderedButton : null;
    await h.run();
    assert(renderedButton);
    assert.equal(renderedButton.disabled, false, 'The replacement DOM button must not retain its saving state');
    assert.doesNotMatch(renderedButton.textContent, /儲存中/);
    await h.run();
    assert.equal(h.saves.length, 2);
    assert.equal(renderedButton.disabled, false);
  });
}

test('Core imports every quick-registration helper from the actual domain module', () => {
  const binding = core.match(/const \{([^}]+)\}=window\.BXHDomainUtils;/)?.[1];
  assert(binding, 'Domain helper import binding exists');
  const imported = new Set(binding.split(',').map(name => name.trim()));
  for (const name of ['isCommunityQuickRegistration', 'isUnlimitedCommunityRegistration',
    'parseCommunityRegistrationCapacity', 'communityRegistrationCapacity', 'communityRegistrationParticipantCount', 'communityLocalParticipantCount',
    'communityRegistrationLocked', 'canCancelCommunityRegistration']) {
    assert(imported.has(name), 'Core imports ' + name);
    assert.equal(typeof context().window.BXHDomainUtils[name], 'function');
  }
});

test('an explicit top-level false marker overrides stale nested quick-registration opt-in', () => {
  const ctx = context();
  const nested = { eventAuthority: 'community', communityQuickRegistration: true, registrationCapacity: null };
  for (const shape of [
    { meta: nested }, { parsedData: { meta: nested } },
  ]) {
    const t = { eventAuthority: 'community', communityQuickRegistration: false, capacity: null, ...shape };
    assert.equal(ctx.isCommunityQuickRegistration(t), false);
    assert.equal(ctx.isUnlimitedCommunityRegistration(t), false);
    assert.equal(ctx.canCancelCommunityRegistration(t, NOW), false);
    assert.equal(ctx.isCommunityQuickRegistration({ raw: t }), false);
  }
  assert.equal(ctx.isCommunityQuickRegistration({ meta: nested }), true);
  assert.equal(ctx.isUnlimitedCommunityRegistration({ meta: nested }), true);
});

for (const field of ['cset-reg-open', 'cset-reg-close', 'cset-reg-cancel']) {
  test('datetime badInput is rejected before writes rather than treated as blank: ' + field, async () => {
    const h = saveHarness({ fields: { [field]: { value: '', validity: { badInput: true } } } });
    await h.run();
    assert.equal(h.saves.length, 0);
    assert.equal(h.accessCalls.length, 0);
    assert.deepEqual(clone(h.ctx.state), h.original);
    assert(h.toasts.some(t => t.error));
  });

  for (const value of ['1970-01-01T00:00:00.000Z', '1969-12-31T23:59:59.999Z', 'not-a-date']) {
    test('datetime invalid/nonpositive epoch rejects before writes: ' + field + ' ' + value, async () => {
      const h = saveHarness({ fields: { [field]: { value, validity: { badInput: false } } } });
      await h.run();
      assert.equal(h.saves.length, 0);
      assert.equal(h.accessCalls.length, 0);
      assert.deepEqual(clone(h.ctx.state), h.original);
      assert(h.toasts.some(t => t.error));
    });
  }
}

test('valid positive past timestamps remain legal optional deadlines', async () => {
  const h = saveHarness({ fields: {
    'cset-reg-open': { value: '2026-10-04T12:00:00Z' },
    'cset-reg-close': { value: '2026-10-05T12:00:00Z' },
    'cset-reg-cancel': { value: '2026-10-05T13:00:00Z' },
  } });
  await h.run();
  assert.equal(h.saves.length, 1);
  const m = h.saves[0].meta;
  assert.equal(m.registrationOpenAt, Date.parse('2026-10-04T12:00:00Z'));
  assert.equal(m.registrationCloseAt, Date.parse('2026-10-05T12:00:00Z'));
  assert.equal(context().getEffectiveRegistrationStatus({ ...m, capacity: m.registrationCapacity }, NOW), 'closed');
});

test('a finite quick-room capacity includes the host and onsite participants in its canonical total', () => {
  const ctx = context();
  for (const [capacity, confirmedCount, communityParticipantCount] of [[1, 0, 1], [8, 7, 8]]) {
    const t = quick({ capacity, confirmedCount, communityParticipantCount });
    assert.equal(ctx.getEffectiveRegistrationStatus(t, NOW), 'full');
    assert.equal(activeButtons(renderDetail(t)).length, 0);
    const registered = renderDetail(t, [{ status: 'confirmed', uid: 'local-test-user' }]);
    assert.equal(activeButtons(registered, 'children').length, 0);
  }
});

test('canonical participant total is not added again to registrations or projected player rows', () => {
  const t = quick({ capacity: 2, confirmedCount: 1, communityParticipantCount: 1,
    parsedData: { players: [{ id: 'same-participant', name: 'Participant' }] } });
  assert.equal(context().getEffectiveRegistrationStatus(t, NOW), 'open');
  const html = renderDetail(t);
  assert.equal(activeButtons(html, 'self').length, 1);
  assert.equal(activeButtons(html, 'children').length, 1);
  assert.match(html, /剩餘 1/);
});

test('detail and lobby use the canonical occupied count instead of online-only confirmed count', () => {
  const t = quick({ capacity: 8, confirmedCount: 5, communityParticipantCount: 7 });
  const html = renderDetail(t);
  assert.match(html, /7\s*\/\s*8/);
  assert.match(html, /剩餘 1/);
  assert.doesNotMatch(html, /剩餘 3/);
  const ctx = context({ lobbyMatchesActiveFilters: () => true, myRegistrationsCache: [] });
  const summary = ctx.lobbySummary(t);
  assert.equal(ctx.getEffectiveRegistrationStatus(t, NOW), 'open');
  assert.equal(ctx.lobbyLists([t]).registration.length, 1);
  assert.match(ctx.lobbyRegistrationButtons(summary, true), /報名/);
});

test('participant totals are scoped to explicit quick COMMUNITY and do not alter official capacity semantics', () => {
  const ctx = context();
  for (const extra of [{ eventAuthority: 'official' }, { communityQuickRegistration: false }]) {
    const t = quick({ ...extra, capacity: 8, confirmedCount: 1, communityParticipantCount: 8 });
    assert.equal(ctx.getEffectiveRegistrationStatus(t, NOW), 'open');
    assert.equal(activeButtons(renderDetail(t), 'self').length, 1);
  }
});

test('cancelled status alone removes additional self and child actions for already registered participants', () => {
  for (const registration of [
    { status: 'confirmed', uid: 'local-test-user' },
    { status: 'confirmed', familyPlayerId: 'local-child' },
  ]) {
    const html = renderDetail(quick({ registrationStatus: 'cancelled', eventCancelled: false }), [registration]);
    assert.equal(activeButtons(html).length, 0);
    assert.doesNotMatch(html, /data-action="cancel-my-registration"/);
  }
});

test('quick participant-count helper uses valid scalar and safely deduplicated public fallback', () => {
  const ctx = context();
  const count = ctx.communityRegistrationParticipantCount;
  assert.equal(typeof count, 'function');
  assert.equal(count(quick({ confirmedCount: 3, communityParticipantCount: 8 })), 8);
  assert.equal(count(quick({ confirmedCount: 0, communityParticipantCount: 0 })), 0);
  const players = [{ id: 'host' }, { id: 'host' }, { id: 'onsite' }];
  for (const invalid of [undefined, null, -1, 1.5, Infinity, NaN, '8']) {
    assert.equal(count(quick({ confirmedCount: 1, communityParticipantCount: invalid, parsedData: { players } })), 2, String(invalid));
  }
  assert.equal(count(quick({ confirmedCount: 4, parsedData: { players } })), 4);
  assert.equal(count(quick({ confirmedCount: 1, communityParticipantCount: 8, eventAuthority: 'official' })), 1);
  assert.equal(count(quick({ confirmedCount: 1, communityParticipantCount: 8, communityQuickRegistration: false })), 1);
});

for (const settingsResult of [false, true]) {
  test('real save queue isolates concurrent roster edits from pending settings: ' + settingsResult, async () => {
    const h = saveHarness();
    const cloudWrites = [], localWrites = [], retries = [];
    let finishSettings;
    h.ctx.currentRole = 'player';
    h.ctx.syncEventInfoV2FromLegacy = () => {};
    h.ctx.cloudWriteChain = Promise.resolve();
    h.ctx.saveRecord = async snapshot => { localWrites.push(clone(snapshot)); return true; };
    h.ctx.queueCloudSyncRetry = (...args) => retries.push(args);
    h.ctx.window.cloudSync.pushUpdate = async (code, snapshot) => {
      cloudWrites.push({ code, snapshot: clone(snapshot) });
      if (cloudWrites.length === 1) return new Promise(resolve => { finishSettings = resolve; });
      return true;
    };
    for (const name of ['cloneStateForSave', 'enqueueCloudStateWrite', 'flushCloudStateWrites', 'saveState']) {
      vm.runInContext(extractFunction(core, name), h.ctx, { filename: name + '-race-regression.js' });
    }
    await h.run();
    assert.equal(cloudWrites.length, 1);
    assert.equal(cloudWrites[0].snapshot.meta.registrationEnabled, true);
    assert.equal(cloudWrites[0].snapshot.meta.registrationCapacity, null);
    assert.deepEqual(clone(h.ctx.state.meta), h.original.meta, 'Pending settings never mutate shared state');
    assert.equal(localWrites.length, 0, 'Pending settings never become an optimistic local snapshot');

    h.ctx.state.players.push({ id: 'concurrent-onsite', name: 'Onsite', source: 'manual' });
    const rosterSave = h.ctx.saveState();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(cloudWrites.length, 1, 'Ordinary save waits for the settings result');
    assert.equal(localWrites.length, 0, 'Deferred ordinary save has not snapshotted settings yet');

    finishSettings(settingsResult);
    assert.equal(await rosterSave, true);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(cloudWrites.length, 2);
    const second = cloudWrites[1].snapshot;
    assert.equal(second.players.length, 1);
    assert.equal(second.players[0].id, 'concurrent-onsite');
    assert.equal(second.meta.registrationEnabled, settingsResult);
    assert.equal(second.meta.registrationCapacity, settingsResult ? null : h.original.meta.registrationCapacity);
    assert.equal(second.meta.name, settingsResult ? 'Updated room' : h.original.meta.name);
    assert.equal(h.ctx.state.players[0].id, 'concurrent-onsite');
    assert.equal(h.ctx.state.meta.registrationEnabled, settingsResult);
    assert.equal(h.ctx.communitySettingsWriteGate, null);
    assert.equal(h.ctx.communitySettingsSaving, false);
    assert.equal(retries.length, 0, 'Rejected explicit settings never enter automatic retries');
    if (!settingsResult) assert(localWrites.every(snapshot => snapshot.meta.registrationEnabled === false));
  });
}

test('private local participant counting uses strong identity aliases and never display names', () => {
  const count = context().communityLocalParticipantCount;
  assert.equal(typeof count, 'function');
  assert.equal(count({ players: [
    { id: 'first', accountUid: 'host' }, { id: 'second', playerUid: 'host' },
    { id: 'third', uid: 'host' }, { id: 'fourth', registrationUid: 'host' },
  ] }), 1);
  assert.equal(count({ players: [{ id: 'same' }, { id: 'same' }] }), 1);
  assert.equal(count({ players: [{ id: 'one', name: 'Same Name' }, { id: 'two', name: 'Same Name' }] }), 2);
  assert.equal(count({ players: [{ name: 'Unlinked' }, { name: 'Unlinked' }] }), 2);
  assert.equal(count({ players: [
    { familyPlayerId: 'child-a', uid: 'guardian' }, { familyPlayerId: 'child-b', uid: 'guardian' },
    { familyPlayerId: 'child-a', uid: 'guardian' }, { uid: 'guardian' },
  ] }), 3);
  assert.equal(count({ players: [
    { id: 'online-stale', source: 'online', uid: 'account' },
    { id: 'registered-stale', registrationId: 'REG', source: 'manual', uid: 'account' },
    { id: 'host', source: 'host', uid: 'host' },
  ] }), 1);
});

test('frontend creation with capacity one includes the host and starts full', async () => {
  const h = createHarness({ enabled: true, capacity: '1' });
  await h.run();
  assert.equal(h.creates.length, 1);
  assert.equal(h.creates[0].communityParticipantCount, 1);
  assert.equal(h.creates[0].meta.registrationStatus, 'full');
});

test('settings projection failure reports saved settings plus a summary retry affordance', async () => {
  const h = saveHarness();
  h.ctx.window.__BXH_COMMUNITY_SUMMARY_STATUS = { 'COMMUNITY-QUICK': { ok: false } };
  await h.run();
  assert.equal(h.ctx.state.meta.registrationEnabled, true);
  assert.equal(h.ctx.state.meta.registrationCapacity, null);
  assert(h.toasts.some(t => t.error && /設定已儲存/.test(t.message) && /人數摘要尚未同步/.test(t.message)));
  vm.runInContext(host, h.ctx);
  const html = h.ctx.window.BXHCommunityHostFeature.renderCommunitySettings();
  assert.match(html, /data-action="community-sync-summary"/);
});

test('accepted settings apply the refreshed server participant scalar without replacing concurrent roster edits', async () => {
  let finish;
  const h = saveHarness({ save: () => new Promise(resolve => { finish = resolve; }) });
  await h.run();
  h.ctx.state.players.push({ id: 'new-onsite', name: 'Onsite' });
  h.ctx.window.__BXH_COMMUNITY_SUMMARY_STATUS = { 'COMMUNITY-QUICK': { ok: true, communityParticipantCount: 7 } };
  finish(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.ctx.state.communityParticipantCount, 7);
  assert.equal(h.ctx.state.players[0].id, 'new-onsite');
  assert.equal(h.ctx.state.meta.registrationEnabled, true);
});

test('cloud-accepted settings remain committed when only local cache persistence fails', async () => {
  const h = saveHarness();
  h.ctx.currentRole = 'player';
  h.ctx.syncEventInfoV2FromLegacy = () => {};
  h.ctx.cloudWriteChain = Promise.resolve();
  h.ctx.saveRecord = async () => false;
  h.ctx.queueCloudSyncRetry = () => { throw new Error('Accepted settings must not retry automatically'); };
  let writes = 0;
  h.ctx.window.cloudSync.pushUpdate = async (_code, _snapshot, options) => {
    writes++;
    assert.equal(options.syncCommunitySummary, true);
    return true;
  };
  for (const name of ['cloneStateForSave', 'enqueueCloudStateWrite', 'flushCloudStateWrites', 'saveState']) vm.runInContext(extractFunction(core, name), h.ctx);
  await h.run();
  assert.equal(writes, 1);
  assert.equal(h.ctx.state.meta.registrationEnabled, true);
  assert.equal(h.ctx.state.meta.registrationCapacity, null);
  assert(h.toasts.some(t => t.error && /已儲存到雲端/.test(t.message) && /本機快取未完成/.test(t.message)));
  assert.equal(h.ctx.communitySettingsWriteGate, null);
});

for (const succeeds of [true, false]) {
  test('explicit summary retry only updates the scalar and preserves saved settings: ' + succeeds, async () => {
    const h = saveHarness({ meta: { communityQuickRegistration: true } });
    const before = clone(h.ctx.state.meta);
    let calls = 0;
    h.ctx.window.cloudSync.syncCommunityRegistrationSummary = async code => {
      calls++;
      assert.equal(code, 'COMMUNITY-QUICK');
      if (!succeeds) throw new Error('local-summary-failed');
      return { ok: true, communityParticipantCount: 7 };
    };
    const start = core.indexOf('  if(action==="community-sync-summary"){');
    const end = core.indexOf('\n  if(action==="community-save-settings")', start);
    assert(start >= 0 && end > start);
    vm.runInContext('function runSummary(){const action="community-sync-summary";const target={};\n' + core.slice(start, end) + '\n}', h.ctx);
    h.ctx.runSummary();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1);
    assert.equal(h.saves.length, 0);
    assert.deepEqual(clone(h.ctx.state.meta), before);
    if (succeeds) assert.equal(h.ctx.state.communityParticipantCount, 7);
    else assert(h.toasts.some(t => t.error && /已儲存的設定仍保留/.test(t.message)));
  });
}

test('scalar-only remote projection refresh preserves newer local roster edits', () => {
  const h = saveHarness({ meta: { communityQuickRegistration: true } });
  h.ctx.state.updatedAt = NOW;
  h.ctx.state.communityParticipantCount = 1;
  h.ctx.state.players = [{ id: 'local-unsaved', name: 'Local edit' }];
  h.ctx.remoteAppliedRoomId = h.ctx.state.id;
  h.ctx.remoteAppliedAt = 0;
  h.ctx.renderPreservingScroll = () => {};
  vm.runInContext(extractFunction(core, 'applyRemoteState'), h.ctx);
  const remote = clone(h.ctx.state);
  remote.updatedAt = NOW - 1000;
  remote.communityParticipantCount = 7;
  remote.players = [];
  h.ctx.applyRemoteState(remote);
  assert.equal(h.ctx.state.communityParticipantCount, 7);
  assert.equal(h.ctx.state.updatedAt, NOW);
  assert.equal(h.ctx.state.players.length, 1);
  assert.equal(h.ctx.state.players[0].id, 'local-unsaved');
});

test('team tournaments cannot opt into individual quick registration at any metadata shape', () => {
  const ctx = context();
  for (const t of [
    quick({ battleMode: 'team' }),
    quick({ parsedData: { meta: { battleMode: 'team', communityQuickRegistration: true } } }),
    { meta: { eventAuthority: 'community', battleMode: 'team', communityQuickRegistration: true, registrationCapacity: null } },
  ]) {
    assert.equal(ctx.isCommunityQuickRegistration(t), false);
    assert.equal(ctx.isUnlimitedCommunityRegistration(t), false);
    assert.equal(ctx.canCancelCommunityRegistration(t, NOW), false);
  }
});

const legacyTeamFields = {
  'cset-reg-open': { value: '2026-10-07T12:00:00Z' },
  'cset-reg-close': { value: '2026-10-08T12:00:00Z' },
};

test('legacy team host save preserves scheduled team semantics and never adopts the quick marker', async () => {
  const h = saveHarness({ capacity: '8', meta: { battleMode: 'team', teamSize: 3 }, fields: legacyTeamFields });
  await h.run();
  assert.equal(h.saves.length, 1);
  for (const st of [h.saves[0], h.ctx.state]) {
    assert.equal(st.meta.name, 'Updated room');
    assert.equal(st.meta.location, 'Local venue');
    assert.equal(st.meta.battleMode, 'team');
    assert.equal(st.meta.teamSize, 3);
    assert.equal(st.meta.registrationCapacity, 8);
    assert.equal(st.meta.registrationStatus, 'scheduled');
    assert.equal(st.meta.registrationOpenAt, Date.parse('2026-10-07T12:00:00Z'));
    assert.equal(st.meta.registrationCloseAt, Date.parse('2026-10-08T12:00:00Z'));
    assert.equal(st.meta.cancellationDeadline, st.meta.registrationCloseAt);
    assert.equal(Object.hasOwn(st, 'communityQuickRegistration'), false);
    assert.equal(Object.hasOwn(st.meta, 'communityQuickRegistration'), false);
  }
});

for (const invalid of [
  { capacity: '' },
  { fields: { 'cset-reg-open': { value: '' } } },
  { fields: { 'cset-reg-close': { value: '' } } },
  { capacity: '0' },
]) {
  test('legacy team enabled registration rejects blank/invalid capacity or dates before mutation: ' + JSON.stringify(invalid), async () => {
    const h = saveHarness({ capacity: invalid.capacity ?? '8', meta: { battleMode: 'team' },
      fields: { ...legacyTeamFields, ...invalid.fields } });
    await h.run();
    assert.equal(h.saves.length, 0);
    assert.equal(h.accessCalls.length, 0);
    assert.deepEqual(clone(h.ctx.state), h.original);
    assert(h.toasts.some(t => t.error));
  });
}

test('legacy team registration can stay disabled while other settings change', async () => {
  const h = saveHarness({ enabled: false, meta: { battleMode: 'team', registrationCapacity: 16 } });
  await h.run();
  assert.equal(h.saves.length, 1);
  assert.equal(h.ctx.state.meta.name, 'Updated room');
  assert.equal(h.ctx.state.meta.registrationEnabled, false);
  assert.equal(h.ctx.state.meta.registrationStatus, 'closed');
  assert.equal(h.ctx.state.meta.registrationCapacity, 16);
  assert.equal(Object.hasOwn(h.ctx.state.meta, 'communityQuickRegistration'), false);
  assert.equal(Object.hasOwn(h.ctx.state, 'communityQuickRegistration'), false);
});

test('team host settings explain required schedule and team capacity without promising unlimited registration', () => {
  const h = saveHarness({ meta: { battleMode: 'team' } });
  vm.runInContext(host, h.ctx);
  const html = h.ctx.window.BXHCommunityHostFeature.renderCommunitySettings();
  assert.match(html, /團體賽沿用排程報名/);
  assert.match(html, /正取隊伍上限/);
  assert.match(html, /開放報名時必填/);
  assert.doesNotMatch(html, /留空不限人數|沒填就沒上限/);
});

test('family hotfix wrapper forwards cloud options unchanged for owned community and other events', async () => {
  const family = read('family-ui.js');
  const wrapper = family.match(/^\s*api\.pushUpdate=async\(code,data,options\)=>.*$/m)?.[0];
  assert(wrapper, 'Family wrapper accepts the new options argument');
  const calls = [];
  const ctx = vm.createContext({ api: {}, ownCommunity: data => data.owned === true,
    push: async (...args) => { calls.push(args); return true; }, asCommunityOwner: fn => fn(),
    communityDiagnostic: () => { throw Error('Unexpected diagnostic'); } });
  vm.runInContext(wrapper, ctx);
  const options = { syncCommunitySummary: true, additionalOption: 'preserved' };
  for (const owned of [false, true]) {
    assert.equal(await ctx.api.pushUpdate('LOCAL', { owned }, options), true);
    assert.equal(calls.at(-1)[2], options);
  }
});

test('a formerly full quick room reopens everywhere when authoritative participant count releases a slot', () => {
  const ctx = context({ lobbyMatchesActiveFilters: () => true, myRegistrationsCache: [] });
  const t = quick({ capacity: 8, confirmedCount: 7, communityParticipantCount: 8, registrationStatus: 'full' });
  assert.equal(ctx.getEffectiveRegistrationStatus(t, NOW), 'full');
  assert.equal(activeButtons(renderDetail(t)).length, 0);
  t.communityParticipantCount = 7;
  assert.equal(ctx.getEffectiveRegistrationStatus(t, NOW), 'open');
  const html = renderDetail(t);
  assert.equal(activeButtons(html, 'self').length, 1);
  assert.equal(activeButtons(html, 'children').length, 1);
  assert.match(html, /剩餘 1/);
  const summary = ctx.lobbySummary(t);
  assert.equal(summary.regStatus, 'open');
  assert.equal(ctx.lobbyLists([t]).registration[0].regStatus, 'open');
  assert.equal(ctx.publicEventLifecycleStatus(t).key, 'registration');
  assert.match(ctx.lobbyRegistrationButtons(summary, true), /報名/);
  assert.equal(activeButtons(renderDetail(t, [{ status: 'confirmed', uid: 'local-test-user' }]), 'children').length, 1);
});

test('legacy and official stored-full fallback is unchanged by quick-room slot release', () => {
  const ctx = context();
  for (const extra of [{ eventAuthority: 'official' }, { communityQuickRegistration: false }]) {
    const t = quick({ ...extra, capacity: 8, confirmedCount: 7, communityParticipantCount: 7, registrationStatus: 'full' });
    assert.equal(ctx.getEffectiveRegistrationStatus(t, NOW), 'full');
    assert.equal(activeButtons(renderDetail(t)).length, 0);
  }
});

for (const revision of ['callRevision', 'entrySelectionRevision']) {
  for (const timestamp of [NOW - 1000, NOW]) {
    test('newer ' + revision + ' is fully applied despite scalar change and older/equal clock: ' + timestamp, () => {
      const h = saveHarness({ meta: { communityQuickRegistration: true } });
      h.ctx.state.updatedAt = NOW;
      h.ctx.state.communityParticipantCount = 1;
      h.ctx.state[revision] = 3;
      h.ctx.state.players = [{ id: 'local-old', name: 'Old roster' }];
      h.ctx.remoteAppliedRoomId = h.ctx.state.id;
      h.ctx.remoteAppliedAt = 0;
      h.ctx.defaultState = id => ({ id });
      h.ctx.courtSwapDraft = null;
      h.ctx.refereeAssignmentDraftEnabled = true;
      h.ctx.getMatch = () => null;
      h.ctx.window.scrollTo = () => {};
      h.ctx.renderPreservingScroll = () => {};
      vm.runInContext(extractFunction(core, 'applyRemoteState'), h.ctx);
      const remote = clone(h.ctx.state);
      remote.updatedAt = timestamp;
      remote[revision] = 4;
      remote.communityParticipantCount = 7;
      remote.players = [{ id: 'authoritative-new', name: 'New roster' }];
      remote.meta.name = 'Authoritative changed room';
      remote.cloudCode = 'SHOULD-NOT-REPLACE-CODE';
      h.ctx.applyRemoteState(remote);
      assert.equal(h.ctx.state[revision], 4);
      assert.equal(h.ctx.state.communityParticipantCount, 7);
      assert.equal(h.ctx.state.updatedAt, timestamp);
      assert.equal(h.ctx.state.players[0].id, 'authoritative-new');
      assert.equal(h.ctx.state.meta.name, 'Authoritative changed room');
      assert.equal(h.ctx.state.cloudCode, 'COMMUNITY-QUICK');
      assert.equal(h.ctx.refereeAssignmentDraftEnabled, null);
      assert.equal(h.ctx.remoteAppliedAt, timestamp);
    });
  }
}

for (const interruption of ['identity-change', 'auth-lost', 'navigation']) {
  for (const stage of ['connect', 'create-request']) {
    test('create ignores stale completion after ' + interruption + ' during ' + stage, async () => {
      const h = createHarness({ enabled: true });
      const effects = { records: 0, ids: 0, subscriptions: 0, renders: 0 };
      h.ctx.state = { id: 'existing-local-state', meta: { name: 'Before' } };
      h.ctx.saveRecord = async () => { effects.records++; return true; };
      h.ctx.setCurrentId = async () => { effects.ids++; };
      h.ctx.window.cloudSync.subscribe = () => { effects.subscriptions++; return () => {}; };
      h.ctx.render = () => { effects.renders++; };
      let finish;
      if (stage === 'connect') h.ctx.window.cloudSync.connect = () => new Promise(resolve => { finish = resolve; });
      else h.ctx.window.cloudSync.createCommunityRoom = data => {
        h.creates.push(clone(data));
        return new Promise(resolve => { finish = resolve; });
      };
      await h.run();
      assert.equal(typeof finish, 'function');
      assert.equal(h.creates.length, stage === 'connect' ? 0 : 1);
      if (stage === 'create-request') assert.equal(h.creates[0].ownerUid, 'local-host');
      if (interruption === 'identity-change') {
        h.ctx.firebaseUser = { uid: 'different-user' };
        h.ctx.userProfile = { displayName: 'Different User' };
      } else if (interruption === 'auth-lost') h.ctx.firebaseUser = null;
      else h.ctx.appPhase = 'player-center';
      const untouched = { id: 'new-session-state', meta: { name: 'Current session' } };
      h.ctx.state = clone(untouched);
      finish(stage === 'connect' ? true : 'LOCAL-CREATED');
      await new Promise(resolve => setImmediate(resolve));
      assert.deepEqual(clone(h.ctx.state), untouched);
      assert.equal(h.creates.length, stage === 'connect' ? 0 : 1);
      assert.deepEqual(effects, { records: 0, ids: 0, subscriptions: 0, renders: 0 });
      assert.equal(h.toasts.length, 0);
      assert.equal(h.ctx.communityCreateSaving, false);
    });
  }
}

test('waitlist browser badInput is rejected before any settings or access mutation', async () => {
  const h = saveHarness({ fields: { 'cset-waitlist': { value: '', validity: { badInput: true } } } });
  await h.run();
  assert.equal(h.saves.length, 0);
  assert.equal(h.accessCalls.length, 0);
  assert.deepEqual(clone(h.ctx.state), h.original);
  assert(h.toasts.some(t => t.error));
});


function settingsRaceHarness(options = {}) {
  const h = saveHarness({ meta: { communityQuickRegistration: true }, ...options });
  Object.assign(h.ctx.state, { ownerUid: 'local-test-user', createdBy: 'local-test-user', registrationRosterRevision: 1 });
  h.cloudWrites = []; h.localWrites = []; h.retries = []; h.reads = 0;
  h.fresh = clone(h.ctx.state);
  Object.assign(h.fresh, { registrationRosterRevision: 2, players: [{ id: 'server-player', registrationId: 'server-registration', checkedIn: true }], waitlistPlayers: [{ id: 'server-waiting' }] });
  Object.assign(h.ctx, { currentRole: 'player', cloudWriteChain: Promise.resolve(),
    syncEventInfoV2FromLegacy() {}, defaultState: id => ({ id }), remoteAppliedRoomId: h.ctx.state.id, remoteAppliedAt: 0,
    courtSwapDraft: null, getMatch: () => null, renderPreservingScroll() {},
    saveRecord: async snapshot => { h.localWrites.push(clone(snapshot)); return true; },
    queueCloudSyncRetry: (...args) => h.retries.push(args),
  });
  h.ctx.window.cloudSync.joinRoom = async () => { h.reads++; return { ok: true, data: clone(h.fresh) }; };
  h.ctx.window.cloudSync.pushUpdate = async (code, snapshot) => {
    h.cloudWrites.push(clone(snapshot));
    // Enforce the production roster revision guard, not just a stubbed save result.
    if (snapshot.registrationRosterRevision !== h.fresh.registrationRosterRevision) {
      h.ctx.window.__BXH_LAST_CLOUD_ERROR_CODE = 'registration-roster-stale'; return false;
    }
    h.ctx.window.__BXH_LAST_CLOUD_ERROR_CODE = ''; return true;
  };
  for (const name of ['cloneStateForSave', 'enqueueCloudStateWrite', 'flushCloudStateWrites', 'saveState', 'applyRemoteState']) vm.runInContext(extractFunction(core, name), h.ctx);
  return h;
}
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

test('roster-stale settings rebase commits fresh roster, waitlist, results and revision to cloud, active state and cache', async () => {
  const h = settingsRaceHarness();
  const matches = [{ id: 'finished', completed: true, winnerId: 'winner', scoreA: 3, scoreB: 1 }];
  h.ctx.state.matches = clone(matches); h.fresh.matches = clone(matches);
  await h.run();
  assert.equal(h.reads, 1); assert.equal(h.cloudWrites.length, 2);
  for (const saved of [h.cloudWrites[1], h.ctx.state, h.localWrites.at(-1)]) {
    assert.equal(saved.meta.stations, 2); assert.equal(saved.registrationRosterRevision, 2);
    assert.deepEqual(clone(saved.players), h.fresh.players); assert.deepEqual(clone(saved.waitlistPlayers), h.fresh.waitlistPlayers);
    assert.deepEqual(clone(saved.matches), matches);
  }
  assert(h.toasts.some(t => !t.error && /已儲存/.test(t.message))); assert.equal(h.retries.length, 0);
});

test('a second stale rejection stops after one rebase and never queues automatic settings retries', async () => {
  const h = settingsRaceHarness();
  h.ctx.window.cloudSync.pushUpdate = async (code, snapshot) => {
    h.cloudWrites.push(clone(snapshot)); h.ctx.window.__BXH_LAST_CLOUD_ERROR_CODE = 'registration-roster-stale'; return false;
  };
  await h.run();
  assert.equal(h.reads, 1); assert.equal(h.cloudWrites.length, 2); assert.equal(h.retries.length, 0);
  assert.equal(h.ctx.state.meta.stations, 1); assert.equal(h.elements['cset-stations'].value, '2');
  assert(!h.toasts.some(t => !t.error));
});

for (const change of ['code', 'owner', 'creator', 'revision', 'team', 'started', 'bracket', 'roster-lock', 'result', 'result-revision', 'format', 'access', 'settings']) {
  test('settings rebase fails closed on fresh ' + change + ' changes', async () => {
    const h = settingsRaceHarness();
    if (change === 'code') h.fresh.cloudCode = 'OTHER';
    if (change === 'owner') h.fresh.ownerUid = 'other';
    if (change === 'creator') h.fresh.createdBy = 'other';
    if (change === 'revision') h.fresh.registrationRosterRevision = 1;
    if (change === 'team') h.fresh.meta.battleMode = 'team';
    if (change === 'started') h.fresh.startedAt = NOW;
    if (change === 'bracket') h.fresh.bracketSize = 8;
    if (change === 'roster-lock') h.fresh.rosterLocked = true;
    if (change === 'result') h.fresh.matches = [{ id: 'new-match', completed: true, winnerId: 'server-player' }];
    if (change === 'result-revision') h.fresh.teamResultRevision = 2;
    if (change === 'format') h.fresh.meta.formatType = 'double';
    if (change === 'access') h.fresh.meta.roomAccessMode = 'password';
    if (change === 'settings') h.fresh.meta.name = 'Changed on other device';
    h.ctx.window.cloudSync.pushUpdate = async (code, snapshot) => {
      h.cloudWrites.push(clone(snapshot)); h.ctx.window.__BXH_LAST_CLOUD_ERROR_CODE = 'registration-roster-stale'; return false;
    };
    await h.run();
    assert.equal(h.reads, 1); assert.equal(h.cloudWrites.length, 1); assert.equal(h.ctx.state.meta.stations, 1);
    assert(!h.toasts.some(t => !t.error));
  });
}

for (const interruption of ['exit', 'reopen', 'identity', 'permission']) {
  for (const succeeds of [false, true]) test('pending settings ignore ' + (succeeds ? 'success' : 'stale failure') + ' after ' + interruption, async () => {
    const h = settingsRaceHarness(); let finish;
    h.ctx.window.cloudSync.pushUpdate = async (code, snapshot) => {
      h.cloudWrites.push(clone(snapshot)); return new Promise(resolve => { finish = resolve; });
    };
    await h.run();
    if (interruption === 'exit') h.ctx.appPhase = 'player-center';
    if (interruption === 'reopen') h.ctx.communityRoomSnapshotGeneration++;
    if (interruption === 'identity') h.ctx.currentAuthUid = () => 'different-user';
    if (interruption === 'permission') h.ctx.canManageRegistrationRoster = () => false;
    h.ctx.window.__BXH_LAST_CLOUD_ERROR_CODE = 'registration-roster-stale';
    finish(succeeds); await nextTurn();
    assert.equal(h.reads, 0); assert.equal(h.cloudWrites.length, 1); assert.equal(h.localWrites.length, 0);
    assert.equal(h.ctx.state.meta.stations, 1); assert.equal(h.toasts.length, 0); assert.equal(h.ctx.communitySettingsWriteGate, null);
  });
}

test('draw creation while draining earlier saves prevents stale format or access changes before first push', async () => {
  const h = settingsRaceHarness({ fields: { 'cset-format': { value: 'double' } } }); let finish;
  h.ctx.flushCloudStateWrites = () => new Promise(resolve => { finish = resolve; });
  await h.run(); h.ctx.state.bracketSize = 8; h.ctx.state.rosterLocked = true;
  h.ctx.state.matches = [{ id: 'newly-drawn', completed: false }];
  finish(true); await nextTurn();
  assert.equal(h.cloudWrites.length, 0); assert.equal(h.accessCalls.length, 0); assert.equal(h.ctx.state.meta.formatType, 'single');
});

for (const duringRetry of [false, true]) {
  test('local roster edits and a private projection remain safe ' + (duringRetry ? 'during retry' : 'before retry'), async () => {
    const h = settingsRaceHarness(); let finish;
    h.ctx.window.cloudSync.pushUpdate = async (code, snapshot) => {
      h.cloudWrites.push(clone(snapshot));
      if (duringRetry && h.cloudWrites.length === 1) { h.ctx.window.__BXH_LAST_CLOUD_ERROR_CODE = 'registration-roster-stale'; return false; }
      return new Promise(resolve => { finish = resolve; });
    };
    await h.run(); assert.equal(h.cloudWrites.length, duringRetry ? 2 : 1);
    h.ctx.state.players.push({ id: 'pending-onsite', name: 'Pending onsite' });
    const localSave = h.ctx.saveState();
    h.ctx.applyRemoteState({ ...clone(h.fresh), updatedAt: NOW + 1 });
    assert.equal(h.ctx.state.players[0].id, 'pending-onsite', 'Listener cannot erase the queued local mutation');
    h.ctx.window.__BXH_LAST_CLOUD_ERROR_CODE = duringRetry ? '' : 'registration-roster-stale'; finish(duringRetry);
    assert.equal(await localSave, false); await nextTurn();
    assert.equal(h.cloudWrites.length, duringRetry ? 2 : 1, 'Conflicted old roster cannot be sent after the gate');
    assert.equal(h.ctx.state.players[0].id, 'pending-onsite');
    assert.equal(h.ctx.state.registrationRosterRevision, 1, 'Never bless old local players with a newer server revision');
    assert.equal(h.ctx.state.meta.stations, duringRetry ? 2 : 1);
    assert(h.toasts.some(t => t.error && /尚未儲存/.test(t.message)));
    if (duringRetry) { assert.deepEqual(h.localWrites.at(-1).players, h.fresh.players); assert.equal(h.localWrites.at(-1).meta.stations, 2); }
    assert.equal(h.retries.length, 0);
  });
}

test('a newer same-revision private result survives the settings retry acknowledgement and cache write', async () => {
  const h = settingsRaceHarness(); let finish;
  h.ctx.window.cloudSync.pushUpdate = async (code, snapshot) => {
    h.cloudWrites.push(clone(snapshot));
    if (h.cloudWrites.length === 1) { h.ctx.window.__BXH_LAST_CLOUD_ERROR_CODE = 'registration-roster-stale'; return false; }
    return new Promise(resolve => { finish = resolve; });
  };
  await h.run(); assert.equal(h.cloudWrites.length, 2);
  const newer = { ...clone(h.fresh), startedAt: NOW, updatedAt: NOW + 1000,
    matches: [{ id: 'fresh-result', completed: true, winnerId: 'server-player' }] };
  h.ctx.applyRemoteState(newer); finish(true); await nextTurn();
  for (const st of [h.ctx.state, h.localWrites.at(-1)]) {
    assert.equal(st.startedAt, NOW); assert.deepEqual(clone(st.matches), newer.matches);
    assert.equal(st.registrationRosterRevision, 2); assert.equal(st.meta.stations, 2);
  }
});

for (const conflict of [false, true]) test('room access config is single-shot and fresh access mode is checked: ' + conflict, async () => {
  const secret = 'ephemeral-secret';
  const h = settingsRaceHarness({ fields: { 'cset-access-mode': { value: 'password' }, 'cset-access-password': { value: secret } } });
  h.ctx.window.engagementService.roomAccess = async payload => {
    h.accessCalls.push(payload); h.fresh.meta.roomAccessMode = conflict ? 'public' : payload.mode; return { ok: true };
  };
  await h.run();
  assert.equal(h.accessCalls.length, 1); assert.equal(h.reads, 1); assert.equal(h.cloudWrites.length, conflict ? 1 : 2);
  assert.equal(h.accessCalls[0].password, secret);
  for (const saved of [...h.cloudWrites, ...h.localWrites, h.ctx.state]) assert(!JSON.stringify(saved).includes(secret));
  if (conflict) assert(h.toasts.some(t => t.error));
  else assert.equal(h.ctx.state.meta.roomAccessMode, 'password');
});

test('an interval retry already running is drained before explicit settings are written', async () => {
  const h = settingsRaceHarness(); h.fresh.registrationRosterRevision = 1;
  let tick, finishOld;
  h.ctx.setInterval = fn => { tick = fn; return 123; };
  vm.runInContext(extractFunction(core, 'queueCloudSyncRetry'), h.ctx);
  h.ctx.window.cloudSync.pushUpdate = async (code, snapshot) => {
    h.cloudWrites.push(clone(snapshot));
    if (h.cloudWrites.length === 1) return new Promise(resolve => { finishOld = resolve; }); return true;
  };
  h.ctx.queueCloudSyncRetry(h.ctx.state.id, h.ctx.state.cloudCode);
  const oldSave = tick(); await nextTurn(); await h.run();
  assert.equal(h.cloudWrites.length, 1, 'Settings waits for the timer write');
  finishOld(true); await oldSave; await nextTurn();
  assert.equal(h.cloudWrites.length, 2); assert.equal(h.cloudWrites[0].meta.stations, 1);
  assert.equal(h.cloudWrites[1].meta.stations, 2); assert.equal(h.ctx.state.meta.stations, 2);
});


test('completing an old settings save unlocks a replacement room without restoring the old draft', async () => {
  const h = settingsRaceHarness(); let finish;
  h.ctx.window.cloudSync.pushUpdate = async () => new Promise(resolve => { finish = resolve; });
  await h.run();
  h.ctx.state = { id: 'other-room', cloudCode: 'OTHER', meta: { name: 'Other room' }, matches: [] };
  h.ctx.communityRoomSnapshotGeneration++;
  const button = { disabled: true, textContent: '儲存中…' };
  h.ctx.document.querySelector = () => button;
  for (const input of Object.values(h.elements)) { input.value = 'New room draft'; input.disabled = false; input.dataset = {}; }
  h.ctx.setCommunitySettingsInputsSaving(true);
  finish(true); await nextTurn();
  assert.equal(button.disabled, false);
  assert.equal(h.elements['cset-name'].disabled, false);
  assert.equal(h.elements['cset-name'].value, 'New room draft');
  assert.equal(h.ctx.state.meta.name, 'Other room');
  assert.equal(h.localWrites.length, 0);
  assert.equal(h.toasts.length, 0);
});

test('an expired settings gate does not swallow the reopened room subscription', () => {
  const h = settingsRaceHarness();
  h.ctx.communitySettingsWriteGate = { roomId: h.ctx.state.id, roomCode: h.ctx.state.cloudCode, hasPendingWrites: true, isCurrent: () => false };
  h.ctx.applyRemoteState({ ...clone(h.fresh), updatedAt: NOW + 1 });
  assert.equal(h.ctx.state.registrationRosterRevision, 2);
  assert.deepEqual(clone(h.ctx.state.players), h.fresh.players);
  assert.equal(h.ctx.communitySettingsWriteGate.remote, undefined);
});

for (const lateRemote of [false, true]) test('local edits during final cache save are sent or explicitly rejected against a newer projection: ' + lateRemote, async () => {
  const h = settingsRaceHarness(); let finishCache;
  h.ctx.saveRecord = async snapshot => {
    h.localWrites.push(clone(snapshot));
    if (h.localWrites.length === 2) return new Promise(resolve => { finishCache = resolve; });
    return true;
  };
  await h.run();
  assert.equal(h.ctx.state.registrationRosterRevision, 2);
  h.ctx.state.players.push({ id: 'late-onsite' });
  const localSave = h.ctx.saveState();
  if (lateRemote) h.ctx.applyRemoteState({ ...clone(h.fresh), registrationRosterRevision: 3, updatedAt: NOW + 1, players: [{ id: 'even-newer-server' }] });
  finishCache(true);
  assert.equal(await localSave, !lateRemote); await nextTurn();
  assert.equal(h.cloudWrites.length, lateRemote ? 2 : 3);
  assert(h.ctx.state.players.some(p => p.id === 'late-onsite'));
  if (lateRemote) assert(h.toasts.some(t => t.error && /尚未儲存/.test(t.message)));
  else {
    assert.deepEqual(h.cloudWrites.at(-1).players.map(p => p.id), ['server-player', 'late-onsite']);
    assert.equal(h.cloudWrites.at(-1).registrationRosterRevision, 2);
  }
});

for (const shape of ['old-revision', 'missing-creator', 'out-of-order']) test('detached cache preserves accepted authority for ' + shape + ' projections', async () => {
  const h = settingsRaceHarness(); let finish;
  h.ctx.window.cloudSync.pushUpdate = async (code, snapshot) => {
    h.cloudWrites.push(clone(snapshot));
    if (h.cloudWrites.length === 1) { h.ctx.window.__BXH_LAST_CLOUD_ERROR_CODE = 'registration-roster-stale'; return false; }
    return new Promise(resolve => { finish = resolve; });
  };
  await h.run();
  h.ctx.state.players.push({ id: 'local-pending' });
  const queued = h.ctx.saveState();
  const remote = { ...clone(h.fresh), updatedAt: NOW + 1 };
  if (shape === 'old-revision') { remote.registrationRosterRevision = 1; remote.players = []; }
  if (shape === 'missing-creator') remote.createdBy = null;
  h.ctx.applyRemoteState(remote);
  if (shape === 'out-of-order') h.ctx.applyRemoteState({ ...remote, registrationRosterRevision: 1, updatedAt: NOW + 100000, players: [] });
  finish(true); assert.equal(await queued, false); await nextTurn();
  const cached = h.localWrites.at(-1);
  assert.equal(cached.registrationRosterRevision, 2); assert.deepEqual(cached.players, h.fresh.players);
  assert.equal(cached.meta.stations, 2); assert.equal(cached.createdBy, 'local-test-user');
  assert.equal(h.ctx.state.registrationRosterRevision, 1); assert.equal(h.ctx.state.players[0].id, 'local-pending');
});
