'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const core = read('modules/main-app/core.js');

function moduleContext(extra = {}) {
  const context = {
    window: {},
    document: { addEventListener() {} },
    esc: value => String(value ?? ''),
    ...extra,
  };
  vm.createContext(context);
  return context;
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function authHarness(getUserProfile) {
  const start = core.indexOf('let authStateGeneration=0;');
  const end = core.indexOf('\n          processAuthStateChange = processAuthStateChangeImpl;', start);
  assert(start >= 0 && end > start, 'auth state implementation source boundary exists');
  const source = core.slice(start, end) + '\nglobalThis.__authChange=processAuthStateChangeImpl;';
  const context = {
    window: {
      storage: { async delete() {}, async set() {} },
      cloudAuth: { getUserProfile, touchLastLogin() {} },
    },
    firebaseUser: null,
    userProfile: null,
    currentRole: 'admin',
    appPhase: 'app',
    activeTab: 'live',
    adminDisplayName: null,
    adminTournamentListLoaded: false,
    guestReadOnlyMode: false,
    pendingLoginIntent: 'admin',
    pendingRememberEmail: null,
    loginAttempts: 0,
    loginLockoutUntil: 0,
    loginError: '',
    playerLoginError: '',
    authVerifying: true,
    loginBusy: true,
    playerLoginBusy: false,
    pendingRegistrationCode: null,
    pendingExistingAccountProfile: null,
    pendingNewPlayerProfile: null,
    syncEngagementIdentity() {},
    captureCommunityRoomStateContext: () => null,
    resumeCommunityRoomStateSubscription() {},
    clearVerifyingTimeout() {},
    render() {},
    showToast() {},
    loadActiveMode: async () => 'admin',
    roleAllowsMode: () => true,
    mapRoleToAppRole: () => 'admin',
    saveActiveMode: async () => {},
    restoreAccountInterfaceTheme() {},
    restoreRaffleIntent: () => false,
    setTimeout: () => 1,
    console,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

test('module exports and script order satisfy Core bindings', () => {
  const html = read('index.html');
  const scriptSources = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/g)].map(m => m[1]);
  const coreIndex = scriptSources.findIndex(src => src.startsWith('modules/main-app/core.js'));
  assert(coreIndex >= 0, 'Core script is present');
  for (const file of [
    'modules/main-app/format-utils.js',
    'modules/main-app/input-utils.js',
    'modules/main-app/account-utils.js',
    'modules/main-app/title-utils.js',
    'modules/main-app/hunter-utils.js',
    'modules/main-app/match-utils.js',
    'modules/main-app/tournament-operations.js',
  ]) {
    const index = scriptSources.findIndex(src => src.startsWith(file));
    assert(index >= 0 && index < coreIndex, `${file} loads before Core`);
  }

  const context = moduleContext();
  for (const file of [
    'modules/main-app/format-utils.js',
    'modules/main-app/input-utils.js',
    'modules/main-app/account-utils.js',
    'modules/main-app/title-utils.js',
    'modules/main-app/hunter-utils.js',
    'modules/main-app/match-utils.js',
    'modules/main-app/tournament-operations.js',
  ]) vm.runInContext(read(file), context, { filename: file });

  for (const [namespace, names] of [
    ['BXHFormatUtils', ['matchSequenceLabel', 'refereeNamesLabel']],
    ['BXHInputUtils', ['smartCallNorm']],
    ['BXHAccountUtils', ['legacyGameIdFromProfile', 'effectiveGameId', 'effectivePlayerNameForMode']],
    ['BXHTitleUtils', ['titleArtworkPath', 'titleClassificationHtml']],
    ['BXHHunterUtils', ['hunterLicenseGrade', 'hunterSeniorityBonus']],
    ['BXHMatchUtils', ['nextPow2', 'seedOrder', 'sameStringSet', 'matchHasDecisionData', 'correctionMatchHasActualPlay', 'correctionParticipantSignature']],
    ['BXHTournamentOperations', ['renderTournamentOperationsPage', 'handleTournamentOperationsAction']],
  ]) for (const name of names) assert.equal(typeof context.window[namespace]?.[name], 'function', `${namespace}.${name} is exported`);

  const titleBinding = core.match(/const \{[^}]*titleArtworkPath[^}]*\}=window\.BXHTitleUtils;/)?.[0];
  assert(titleBinding, 'Core title utility bindings include artwork path and classification helpers');
  vm.runInContext(titleBinding, context);
  assert.equal(vm.runInContext('typeof titleArtworkPath', context), 'function', 'Core binds the exported title artwork path helper');
  assert.equal(vm.runInContext('typeof titleClassificationHtml', context), 'function', 'Core binds the exported title classification helper');
});

test('Core feature bridges do not retain unused legacy aliases', () => {
  for (const name of [
    'cardAlbumImage', 'renderCardAlbumTrade',
    'communityPhaseLabel', 'communityExpiryLabel', 'renderCommunitySettings',
    'openMailboxPartnerContract',
    'moodContext', 'moodLength', 'moodError', 'moodReplyDraft', 'moodMenuHtml',
    'renderMoodReplies', 'renderMoodMessage', 'loadMood', 'setMoodHeld', 'releaseMoodHold',
    'cardContext', 'renderCurrentShareQr',
  ]) assert.doesNotMatch(core, new RegExp('\\b' + name + '\\b'), `${name} remains module-internal`);
});

test('match sequence labels are exported and delegated without changing match numbering', () => {
  const context = moduleContext();
  vm.runInContext(read('modules/main-app/format-utils.js'), context, { filename: 'format-utils.js' });
  const start = core.indexOf('function displayMatchLabel(');
  const end = core.indexOf('\nfunction matchesInRound(', start);
  assert(start >= 0 && end > start, 'Core match label binding exists');
  const binding = core.slice(start, end);
  assert.match(binding, /window\.BXHFormatUtils\.matchSequenceLabel\(displayMatchNumber\(m\)\)/);

  for (const [value, expected] of [
    [12, '第12場'],
    [0, '第0場'],
    ['A', '第A場'],
    [null, ''],
    [undefined, ''],
  ]) assert.equal(context.window.BXHFormatUtils.matchSequenceLabel(value), expected);
});

test('referee station labels are exported and delegated without changing station lookup', () => {
  const context = moduleContext({
    refereeNamesForStation: stationNum => stationNum === 1 ? ['小宇', '黑爸'] : [],
  });
  vm.runInContext(read('modules/main-app/format-utils.js'), context, { filename: 'format-utils.js' });
  const start = core.indexOf('function refereeDisplayForStation(');
  const end = core.indexOf('\nfunction canOperateStation(', start);
  assert(start >= 0 && end > start, 'Core referee label binding exists');
  const binding = core.slice(start, end);
  assert.match(binding, /window\.BXHFormatUtils\.refereeNamesLabel\(refereeNamesForStation\(stationNum,st\)\)/);
  vm.runInContext(binding + '\nglobalThis.__refereeDisplayForStation=refereeDisplayForStation;', context, { filename: 'Core referee label binding' });

  assert.equal(context.window.BXHFormatUtils.refereeNamesLabel([]), '未指定');
  assert.equal(context.window.BXHFormatUtils.refereeNamesLabel(['小宇']), '小宇');
  assert.equal(context.window.BXHFormatUtils.refereeNamesLabel(['小宇', '黑爸']), '小宇、黑爸');
  assert.equal(context.__refereeDisplayForStation(1, {}), '小宇、黑爸');
  assert.equal(context.__refereeDisplayForStation(2, {}), '未指定');
});

test('Smart Call identity normalization is exported and delegated through Core', () => {
  const context = moduleContext();
  vm.runInContext(read('modules/main-app/input-utils.js'), context, { filename: 'input-utils.js' });
  const start = core.indexOf('function smartCallNorm(');
  const end = core.indexOf('\nfunction smartCallFindPlayerId(', start);
  assert(start >= 0 && end > start, 'Core Smart Call normalization binding exists');
  const binding = core.slice(start, end);
  assert.match(binding, /window\.BXHInputUtils\.smartCallNorm/);
  vm.runInContext(binding, context, { filename: 'Core Smart Call binding' });

  for (const [value, expected] of [
    ['  Player Name  ', 'playername'],
    ['ＢＸＨ Test ID', 'ｂｘｈtestid'],
    ['Mixed\n Case\tID', 'mixedcaseid'],
    [null, ''],
  ]) assert.equal(context.smartCallNorm(value), expected);
});

test('account display helpers preserve legacy player-name fallbacks through Core bindings', () => {
  const context = moduleContext();
  vm.runInContext(read('modules/main-app/account-utils.js'), context, { filename: 'account-utils.js' });
  const start = core.indexOf('function legacyGameIdFromProfile(');
  const end = core.indexOf('const TAIWAN_CITY_DISTRICTS=', start);
  assert(start >= 0 && end > start, 'Core account helper compatibility bindings exist');
  vm.runInContext(core.slice(start, end), context, { filename: 'Core account bindings' });

  const profiles = [
    [{ gameId: '  BXH-PLAYER  ', nickname: 'Fallback', realName: 'Real' }, 'gameId', 'BXH-PLAYER'],
    [{ nickname: '  Nickname  ', realName: 'Real' }, 'gameId', 'Nickname'],
    [{ displayName: 'Player Alias', realName: 'Real Name' }, 'gameId', 'Player Alias'],
    [{ displayName: 'Same Name', realName: 'Same Name' }, 'gameId', 'Same Name'],
    [{ gameId: 'BXH-PLAYER', realName: 'Real Name' }, 'realName', 'Real Name'],
  ];
  for (const [profile, mode, expected] of profiles) {
    assert.equal(context.effectivePlayerNameForMode(profile, mode), expected);
  }
  assert.equal(context.legacyGameIdFromProfile({ displayName: 'Same Name', realName: 'Same Name' }), '');
  assert.equal(context.effectiveGameId({ nickname: ' Nick ' }), 'Nick');
});

test('feature modules read the shared Core room state', () => {
  const context = moduleContext({
    state: { cloudCode: '', meta: { name: '' } },
    currentRole: 'admin',
    engagementSessionEpoch: 0,
    cloudStatus: 'connected',
    cloudTestBusy: false,
    currentAuthUid: () => 'seam-test-user',
    hasAdminAccess: () => true,
    isSuperAdmin: () => false,
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  });
  vm.runInContext(read('modules/main-app/tournament-operations.js'), context);
  const render = context.window.BXHTournamentOperations.renderTournamentOperationsPage;
  assert.match(render(), /請先建立或開啟雲端賽事/);
  context.state = { cloudCode: 'ROOM-NEW', meta: { name: '新房間共用狀態' } };
  assert.match(render(), /新房間共用狀態/);
});

test('a delayed login result cannot restore an account after logout', async () => {
  const pendingProfile = deferred();
  const context = authHarness(() => pendingProfile.promise);
  const oldLogin = context.__authChange({ uid: 'stale-user', email: 'stale@example.test' });
  await context.__authChange(null);
  pendingProfile.resolve({ active: true, role: 'admin', displayName: 'Stale Admin' });
  await oldLogin;
  assert.equal(context.firebaseUser, null);
  assert.equal(context.userProfile, null);
  assert.equal(context.currentRole, null);
  assert.equal(context.appPhase, 'landing');
});

test('a late Admin auth callback cannot replace the newer authenticated route', async () => {
  const staleProfile = deferred();
  const context = authHarness(uid => uid === 'stale-admin' ? staleProfile.promise : Promise.resolve({
    active: true, role: 'admin', displayName: 'Current Admin',
  }));
  context.appPhase = 'admin-setup';
  const oldLogin = context.__authChange({ uid: 'stale-admin', email: 'stale@example.test' });
  await context.__authChange({ uid: 'current-admin', email: 'current@example.test' });
  staleProfile.resolve({ active: true, role: 'admin', displayName: 'Stale Admin' });
  await oldLogin;
  assert.equal(context.firebaseUser.uid, 'current-admin');
  assert.equal(context.userProfile.displayName, 'Current Admin');
  assert.equal(context.currentRole, 'admin');
  assert.equal(context.appPhase, 'app');
  assert.equal(context.activeTab, 'management');
});

test('an old Admin room read cannot update state after switching rooms', async () => {
  const delayedRoom = deferred();
  const callbacks = [];
  let publicReads = 0;
  let renders = 0;
  const start = core.indexOf('let adminRosterUnsub=null, adminRosterCode="", adminRosterGeneration=0;');
  const end = core.indexOf('let myRegistrationsError = null;', start);
  assert(start >= 0 && end > start, 'Admin room-watch source boundary exists');
  const managedStart = core.indexOf('function peopleOnsiteWaitlistManaged(){');
  const managedEnd = core.indexOf('function peopleOnsiteWaitlistAvailable(){', managedStart);
  assert(managedStart >= 0 && managedEnd > managedStart, 'Actual onsite ownership guard source boundary exists');
  const source = core.slice(managedStart, managedEnd) + core.slice(start, end) + '\nglobalThis.__startAdminWatch=startAdminRosterWatch;globalThis.__stopAdminWatch=stopAdminRosterWatch;globalThis.__adminChain=()=>adminRosterSyncChain;';
  const context = moduleContext({
    state: { id: 'room-a', cloudCode: 'ROOM-A', meta: { registrationEnabled: true } },
    activeTab: 'people', appPhase: 'app', currentRole: 'admin',
    firebaseUser: { uid: 'admin' }, userProfile: { role: 'admin', active: true },
    currentAuthUid: () => 'admin', isTester: () => false, isCommunityRoom: () => false, isCommunityRoomOwner: () => false,
    isCommunityQuickRegistration: () => false, peopleRosterBusy: false,
    resetAdminRegistrationsCache() {},
    hasAdminAccess: () => true,
    cloudAvailable: () => true,
    renderPreservingScroll: () => { renders++; },
    window: { cloudSync: {
      async connect() {},
      subscribeRegistrationsForAdmin(code, onNext) { callbacks.push({ code, onNext }); return () => {}; },
      getPublicTournamentFull() { publicReads++; return delayedRoom.promise; },
    } },
  });
  vm.runInContext(source, context);
  await context.__startAdminWatch();
  const oldNext = callbacks[0].onNext;
  oldNext([{ id: 'old-room-registration' }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(publicReads, 1, 'old room read is in flight');

  context.state = { id: 'room-b', cloudCode: 'ROOM-B', meta: { registrationEnabled: true } };
  context.__stopAdminWatch();
  delayedRoom.resolve({ registrationRosterSyncBackendEnabled: true });
  await context.__adminChain();
  oldNext([{ id: 'late-old-room-registration' }]);
  await context.__adminChain();
  assert.equal(publicReads, 1, 'a stale subscription cannot start another room read');
  assert.equal(renders, 0, 'a stale result cannot render over the new room');
});
