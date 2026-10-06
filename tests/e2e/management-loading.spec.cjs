'use strict';
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

// Isolated browser smoke: real management renderer, list loader, cloud query,
// creator-name enrichment and V2 navigation; mocked identity and Firestore.
// No Firebase SDK, real-account login, production reads, or real-room writes.
test.use({ contextOptions: { reducedMotion: 'reduce' }, serviceWorkers: 'block' });
const root = path.join(__dirname, '../..');
const core = fs.readFileSync(path.join(root, 'modules/main-app/core.js'), 'utf8');
const cloud = fs.readFileSync(path.join(root, 'modules/cloud/cloud-runtime.js'), 'utf8');
function between(source, start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  if (a < 0 || b <= a) throw Error('Production integration seam missing: ' + start);
  return source.slice(a, b);
}
const declarations = between(core, 'let adminTournamentListOpen = false;', 'let refereeDirectoryUsers = null;');
const renderer = between(core, 'function renderTournamentManagementTab(){', '\nfunction adminTournamentListIdentityKey()');
const loading = between(core, 'function adminTournamentListIdentityKey()', '\nfunction renderAdminNoTournamentScreen(){');
const app = between(core, 'function renderApp(){', '\nfunction startLockoutCountdown(){');
const switchAction = between(core, '  if(action==="switch-tab"){', '\n  if(action==="force-refresh-version"){');
const refreshAction = between(core, '  if(action==="cloud-refresh-admin-list"){', '\n  if(action==="cloud-admin-copy-code"){');
const cloudMethods = between(cloud, '    async queryAdminTournaments(){', '\n    // v13.13.4：玩家');
const cloudDeadline = between(cloud, '  function withTimeout(promise, ms, fallbackValue){', '\n  async function tryInitFirebase(){');
const styles = ['core-competition', 'auth-player', 'player-center-hunter', 'lobby-community', 'call-admin-tail', 'referee-tail', 'tail-p7'];
const scripts = ['/modules/management-v2/navigation.js', '/modules/management-v2/adapter.js'];
function row(name = 'Fixture room', extra = {}) {
  return { code: 'BXH-MOCK01', name, createdBy: 'fixture-owner', createdByName: 'Fixture creator',
    eventAuthority: 'official', tournamentPhase: 'waiting', archiveStatus: 'ongoing', ...extra };
}
function html(options) {
  const seed = { rows: [row()], holdQuery: false, holdNames: false, holdRepair: false, ...options };
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${styles.map(name => '<link rel="stylesheet" href="/modules/main-css/' + name + '.css">').join('\n')}
<link rel="stylesheet" href="/modules/management-v2/styles.css"></head><body><div id="app"></div>
${scripts.map(src => '<script src="' + src + '"></script>').join('\n')}
<script>
const copy = value => JSON.parse(JSON.stringify(value));
window.fixture = Object.assign(${JSON.stringify(seed).replace(/</g, '\\u003c')}, { queries: [], names: [], repairs: [], actions: [], renders: 0 });
let firebaseUser = null, userProfile = null, currentRole = null, activeMode = null;
let appPhase = 'landing', activeTab = 'management', publicTournamentsCache = {}, myRegistrationsCache = {};
let state = { cloudCode: null, meta: {} }, celebrationOpen = false, shareModalOpen = false, pendingModal = null;
let historyCloudSyncBusy = false, historyCloudSyncLoaded = false, registrationFormDraftDirty = false;
let viewingRecordId = null, viewingRecordData = null;
${declarations}
let refereeAssignmentDraftEnabled = null, mainTabNavScrollLeft = 0, mainTabNavCenterRequested = true;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hasAdminAccess = () => currentRole === 'admin' || currentRole === 'tester';
const currentAuthUid = () => firebaseUser?.uid || '';
const currentUserUidForWrites = currentAuthUid;
const isTester = () => userProfile?.role === 'tester';
const isAdminTierOrAbove = () => ['admin', 'super_admin'].includes(userProfile?.role);
const isSuperAdmin = () => userProfile?.role === 'super_admin';
const isPartnerOrganizerMode = () => activeMode === 'partner_organizer';
const isEventStaffMode = () => activeMode === 'event_staff';
const partnerOrganizerGrant = () => userProfile?.partnerOrganizer || {};
const cloudAvailable = () => true, canCreateOfficialTournament = () => false, canManageMemberRaffles = () => false;
const registrationStatusLabel = () => '尚未開始';
const computeTournamentPhase = data => data.tournamentPhase || 'waiting';
const LOGO_SRC = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
const topbarConnectionRailHtml = () => '', accountMenuHtml = () => '<span>管理身分（隔離測試）</span>', accountMenuOverlayHtml = () => '';
const tournamentViewContextHeaderHtml = () => '', renderSystemClosureNotice = () => '', adminManagementContextHtml = () => '', testSandboxBannerHtml = () => '';
const renderPrintBracket = () => '', renderModal = () => '', renderCloudJoinModal = () => '', renderEventEntryModal = () => '', renderQrScannerModal = () => '', renderSwitchTournamentModal = () => '', renderCloudTestResultModal = () => '';
const bindDynamicInputs = () => {}, resetRegistrationFormDraft = () => {}, stopAdminRosterWatch = () => {}, showToast = () => {};
const cloudEnabled = true, dbHandle = {};
const snapshot = rows => ({ docs: copy(rows).map(item => ({ id: item.code, data: () => item })) });
const fx = {
  collection: (_, kind) => kind, query: (...parts) => parts, where: (...parts) => parts,
  doc: (_, kind, id) => ({ kind, id }),
  getDocs: async () => {
    const call = { uid: currentAuthUid() }; fixture.queries.push(call);
    if (!fixture.holdQuery) return snapshot(fixture.rows);
    return new Promise((resolve, reject) => { call.resolve = rows => resolve(snapshot(rows)); call.reject = reject; });
  },
  getDoc: async ref => {
    if (ref.kind !== 'users') throw Error('Unexpected mock document read: ' + ref.kind);
    const call = { id: ref.id }; fixture.names.push(call);
    if (!fixture.holdNames) return { exists: () => true, data: () => ({ displayName: 'Resolved creator' }) };
    return new Promise((resolve, reject) => { call.resolve = name => resolve({ exists: () => true, data: () => ({ displayName: name }) }); call.reject = reject; });
  }
};
${cloudDeadline}
window.cloudSync = {
  connect: async () => true,
  ${cloudMethods}
  repairTournamentLifecycle: async code => {
    const call = { code }; fixture.repairs.push(call);
    if (!fixture.holdRepair) return { ok: true };
    return new Promise((resolve, reject) => { call.resolve = resolve; call.reject = reject; });
  }
};
window.BXH_INTERFACE_PREFERENCE = { get: () => 'v2' };
${renderer}
${loading}
${app}
function render() {
  reconcileAdminTournamentListContext(); fixture.renders++;
  if (!hasAdminAccess()) {
    document.getElementById('app').innerHTML = '<main><button class="btn" data-fixture-enter>管理身分（隔離測試）</button></main>';
    return;
  }
  renderApp();
  BXH_MANAGEMENT_UI_V2_ADAPTER.mount({ host: document.getElementById('bxh-management-v2-nav') });
}
function handleAction(action, target) {
  fixture.actions.push(action);
  if (action === 'switch-tab' && target.getAttribute('data-tab') !== 'management') throw Error('Unrelated navigation forbidden in this fixture');
  ${switchAction}
  ${refreshAction}
  throw Error('Unexpected fixture action: ' + action);
}
fixture.enter = () => {
  firebaseUser = { uid: 'fixture-owner' }; userProfile = { role: 'admin', active: true };
  currentRole = 'admin'; activeMode = 'admin'; appPhase = 'app'; activeTab = 'management'; render();
};
fixture.logout = () => { firebaseUser = null; userProfile = null; currentRole = null; activeMode = null; appPhase = 'landing'; render(); };
fixture.changeAccount = () => { firebaseUser = { uid: 'next-owner' }; render(); };
fixture.demote = () => { userProfile = { role: 'staff', active: true }; render(); };
fixture.refresh = () => loadAdminTournamentList();
fixture.state = () => ({ busy: adminTournamentListBusy, loaded: adminTournamentListLoaded, error: adminTournamentListError, items: copy(adminTournamentListItems), activeTab });
document.addEventListener('click', event => {
  if (event.target.closest('[data-fixture-enter]')) return fixture.enter();
  const target = event.target.closest('[data-action]');
  if (target) handleAction(target.getAttribute('data-action'), target);
});
render();
</script></body></html>`;
}
async function openManagement(page, options = {}) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Fail closed. Only the isolated HTML fixture, real navigation scripts and
  // production local CSS are allowed; all auth/backends and writes are blocked.
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort('blockedbyclient');
    if (url.pathname === '/' && url.searchParams.has('management_fixture')) return route.fulfill({ status: 200, contentType: 'text/html', body: html(options) });
    if (scripts.includes(url.pathname) || url.pathname === '/modules/management-v2/styles.css' || /^\/modules\/main-css\/[a-z-]+\.css$/.test(url.pathname)) return route.continue();
    return route.abort('blockedbyclient');
  });
  await page.goto('/?management_fixture=1', { waitUntil: 'load' });
  await page.locator('[data-fixture-enter]').click();
  await expect(page.locator('[data-management-v2-group="event"]')).toHaveClass('active');
  await expect(page.locator('[data-management-v2-tab="management"]')).toHaveClass('active');
  await expect(page.getByText('賽事管理中心', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  return errors;
}
const cards = page => page.locator('.tournament-management-card');
const refresh = page => page.locator('[data-action="cloud-refresh-admin-list"]').first();
const getState = page => page.evaluate(() => fixture.state());
async function settle(page) { await expect.poll(() => getState(page).then(state => state.busy)).toBe(false); }

// All tests stay inside Management identity → Events → Tournament Management.
test('cards appear directly while creator lookup is pending, without switching tabs', async ({ page }, testInfo) => {
  const errors = await openManagement(page, { rows: [row('Immediately usable room', { createdByName: '' })], holdNames: true });
  await expect(cards(page)).toContainText('Immediately usable room');
  await expect(cards(page)).toContainText('fixture-owner');
  await expect(page.getByText('正在讀取雲端賽事…', { exact: true })).toHaveCount(0);
  expect((await getState(page)).activeTab).toBe('management');
  expect(await page.evaluate(() => fixture.names.length)).toBe(1);
  expect(await page.evaluate(() => fixture.queries.length)).toBe(1);
  const screenshot = testInfo.outputPath('management-cards-pending-name.png');
  await page.screenshot({ path: screenshot });
  await testInfo.attach('Room cards before optional creator lookup finishes', { path: screenshot, contentType: 'image/png' });
  await page.evaluate(() => fixture.names[0].resolve('Resolved creator')); await settle(page);
  await expect(cards(page)).toContainText('Resolved creator'); expect(errors).toEqual([]);
});

test('repeated refresh and management-tab clicks share a pending query', async ({ page }) => {
  await openManagement(page, { holdQuery: true });
  for (let i = 0; i < 3; i++) { await refresh(page).click(); await page.locator('[data-management-v2-tab="management"]').click(); }
  await page.evaluate(() => { render(); render(); });
  expect(await page.evaluate(() => fixture.queries.length)).toBe(1);
  await page.evaluate(() => fixture.queries[0].resolve(fixture.rows)); await settle(page);
  await expect(cards(page)).toContainText('Fixture room');
  expect((await getState(page)).activeTab).toBe('management');
});

test('a hung primary query times out and retry works in place; late old data is ignored', async ({ page }) => {
  await page.clock.install(); await openManagement(page, { holdQuery: true });
  await expect.poll(() => page.evaluate(() => fixture.queries.length)).toBe(1);
  await page.clock.fastForward(10001);
  await expect(page.locator('.auth-error')).toContainText('逾時');
  await expect(page.getByText('正在讀取雲端賽事…', { exact: true })).toHaveCount(0);
  await page.evaluate(() => { fixture.holdQuery = false; fixture.rows = [{ ...fixture.rows[0], name: 'Retried room' }]; });
  await refresh(page).click(); await settle(page); await expect(cards(page)).toContainText('Retried room');
  await page.evaluate(() => fixture.queries[0].resolve([{ ...fixture.rows[0], name: 'Late old room' }]));
  await expect(cards(page)).toContainText('Retried room'); await expect(cards(page)).not.toContainText('Late old room');
  expect((await getState(page)).activeTab).toBe('management');
});

test('refreshing and a failed refresh keep last-known cards visible', async ({ page }) => {
  await openManagement(page); await settle(page); await expect(cards(page)).toContainText('Fixture room');
  await page.evaluate(() => { fixture.holdQuery = true; }); await refresh(page).click();
  await expect(cards(page)).toContainText('Fixture room');
  await expect.poll(() => page.evaluate(() => fixture.queries.length)).toBe(2);
  await page.evaluate(() => fixture.queries[1].reject(Error('fixture offline')));
  await expect(page.locator('.auth-error')).toBeVisible(); await expect(cards(page)).toContainText('Fixture room');
  await page.evaluate(() => { fixture.holdQuery = false; fixture.rows[0].name = 'Fresh room'; });
  await refresh(page).click(); await settle(page);
  await expect(cards(page)).toContainText('Fresh room'); await expect(page.locator('.auth-error')).toHaveCount(0);
});

test('hung lifecycle repair leaves cards usable and releases refresh after its deadline', async ({ page }) => {
  await page.clock.install();
  await openManagement(page, { rows: [row('Archived room', { archiveStatus: 'completed' })], holdRepair: true });
  await expect(cards(page)).toContainText('Archived room');
  await expect.poll(() => page.evaluate(() => fixture.repairs.length)).toBe(1);
  await expect(page.getByText('正在讀取雲端賽事…', { exact: true })).toHaveCount(0);
  await page.clock.fastForward(10001); await settle(page);
  await expect(cards(page)).toContainText('Archived room'); await expect(page.locator('.auth-error')).toContainText('狀態更新');
  await page.evaluate(() => { fixture.rows[0].tournamentPhase = 'done'; fixture.holdRepair = false; });
  await refresh(page).click(); await settle(page);
  await expect(page.locator('.auth-error')).toHaveCount(0); await expect(cards(page)).toContainText('已結束');
});

test('logout and another identity cannot receive a late old response', async ({ page }) => {
  await openManagement(page, { holdQuery: true });
  await expect.poll(() => page.evaluate(() => fixture.queries.length)).toBe(1);
  await page.evaluate(() => fixture.logout());
  await expect(page.locator('[data-fixture-enter]')).toBeVisible(); await expect(cards(page)).toHaveCount(0);
  await page.evaluate(() => fixture.queries[0].resolve([{ ...fixture.rows[0], name: 'Private old room' }]));
  expect((await getState(page)).items).toEqual([]);
  await page.evaluate(() => { fixture.holdQuery = false; fixture.rows[0].name = 'New identity room'; fixture.enter(); fixture.changeAccount(); });
  await settle(page); await expect(cards(page)).toContainText('New identity room');
  await expect(cards(page)).not.toContainText('Private old room');
});

test('role change immediately clears privileged cached rooms before its replacement query', async ({ page }) => {
  await openManagement(page, { rows: [row(), row('Private community room', { eventAuthority: 'community', code: 'BXH-MOCK02' })] });
  await settle(page); expect((await getState(page)).items).toHaveLength(2);
  await page.evaluate(() => { fixture.holdQuery = true; fixture.demote(); });
  await expect(cards(page)).toHaveCount(0); expect((await getState(page)).items).toEqual([]);
  await expect.poll(() => page.evaluate(() => fixture.queries.length)).toBe(2);
  await page.evaluate(() => fixture.queries[1].resolve(fixture.rows)); await settle(page);
  await expect(cards(page)).toHaveCount(1); expect((await getState(page)).items.map(item => item.name)).toEqual(['Fixture room']);
});

test('empty rooms and denied reads leave a retryable page without navigation workarounds', async ({ page }) => {
  await openManagement(page, { rows: [] }); await settle(page);
  await expect(page.getByText('目前沒有可管理的賽事', { exact: true })).toBeVisible();
  await page.evaluate(() => { fixture.holdQuery = true; }); await refresh(page).click();
  await expect.poll(() => page.evaluate(() => fixture.queries.length)).toBe(2);
  await page.evaluate(() => fixture.queries[1].reject({ code: 'permission-denied' })); await settle(page);
  await expect(page.locator('.auth-error')).toContainText('權限');
  await expect(refresh(page)).toBeVisible(); expect((await getState(page)).activeTab).toBe('management');
});
