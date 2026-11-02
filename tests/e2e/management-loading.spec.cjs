'use strict';
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

// Isolated browser smoke: real management renderer, list loader, cloud query,
// summary pagination and V2 navigation; mocked identity and callable transport.
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
const managementActions = between(core, '  if(action==="admin-tournament-filter"){', '\n  if(action==="load-duty-logs"){');
const searchBinding = between(core, 'function bindAdminTournamentSearchInput(){', '\nfunction bindDynamicInputs(){');
const cloudMethods = between(cloud, '    async queryAdminTournaments(){', '\n    // v13.13.4：玩家');
const cloudDeadline = between(cloud, '  function withTimeout(promise, ms, fallbackValue){', '\n  async function tryInitFirebase(){');
const styles = ['core-competition', 'auth-player', 'player-center-hunter', 'lobby-community', 'call-admin-tail', 'referee-tail', 'tail-p7'];
const scripts = ['/modules/management-v2/navigation.js', '/modules/management-v2/adapter.js'];
function row(name = 'Fixture room', extra = {}) {
  return { code: 'BXH-MOCK01', name, createdBy: 'fixture-owner', createdByName: 'Fixture creator',
    eventAuthority: 'official', tournamentPhase: 'waiting', archiveStatus: 'ongoing', registrationStatus:'open',registrationEnabled:true, ...extra };
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
const registrationStatusLabel = status => ({open:'報名中',scheduled:'即將開放',closed:'已關閉',full:'額滿'})[status]||status;
const computeTournamentPhase = data => data.tournamentPhase || 'waiting';
const LOGO_SRC = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
const topbarConnectionRailHtml = () => '', accountMenuHtml = () => '<span>管理身分（隔離測試）</span>', accountMenuOverlayHtml = () => '';
const tournamentViewContextHeaderHtml = () => '', renderSystemClosureNotice = () => '', adminManagementContextHtml = () => '', testSandboxBannerHtml = () => '';
const renderPrintBracket = () => '', renderModal = () => '', renderCloudJoinModal = () => '', renderEventEntryModal = () => '', renderQrScannerModal = () => '', renderSwitchTournamentModal = () => '', renderCloudTestResultModal = () => '';
const bindDynamicInputs = () => bindAdminTournamentSearchInput(), resetRegistrationFormDraft = () => {}, stopAdminRosterWatch = () => {}, showToast = () => {};
// Summary transport only. Full Firestore reads are forbidden in this fixture.
const cloudEnabled=true,dbHandle={},fx={getDocs(){throw Error('full-collection-read-forbidden');},getDoc(){throw Error('extra-document-read-forbidden');}};
function callEngagementFunction(name,request){
 if(name!=="listManagementTournamentSummaries")throw Error('unexpected callable');
 const call={...request,uid:currentAuthUid()};fixture.queries.push(call);
 const result=rows=>{
  const search=String(request.search||'').toLowerCase();
  const group=row=>row.registrationStatus==='scheduled'?'upcoming':['closed','cancelled'].includes(row.registrationStatus)?'closed':row.registrationStatus==='draft'?'draft':'open';
  const all=copy(rows).filter(row=>(request.kind==='community'?row.eventAuthority==='community':row.eventAuthority!=='community')&&(!search||[row.name,row.code,row.location||''].some(value=>value.toLowerCase().includes(search))));
  const counts={all:all.length,open:0,upcoming:0,closed:0,draft:0};all.forEach(row=>counts[group(row)]++);
  const filtered=all.filter(row=>request.status==='all'||group(row)===request.status).sort((a,b)=>a.code.localeCompare(b.code));
  const offset=Number(request.cursor||0),items=filtered.slice(offset,offset+5),hasMore=offset+5<filtered.length;
  return {ok:true,items,counts,pageSize:5,hasMore,nextCursor:hasMore?String(offset+5):null};
 };
 if(!fixture.holdQuery)return Promise.resolve(result(fixture.rows));
 return new Promise((resolve,reject)=>{call.resolve=rows=>resolve(result(rows));call.reject=reject;});
}
${searchBinding}
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
  ${managementActions}
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
fixture.state = () => ({ busy: adminTournamentListBusy, loaded: adminTournamentListLoaded, error: adminTournamentListError, items: copy(adminTournamentListItems), activeTab, more:adminTournamentListHasMore });
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
const manyRows=()=>Array.from({length:12},(_,i)=>row('Paged room '+i,{code:'BXH-'+String(i).padStart(6,'0')}));
test('only five cards load until the explicit expansion; each click adds five',async({page})=>{
 await page.clock.install();const errors=await openManagement(page,{rows:manyRows()});await settle(page);
 await expect(cards(page)).toHaveCount(5);await page.clock.fastForward(30000);
 expect(await page.evaluate(()=>fixture.queries.length)).toBe(1);
 await page.locator('[data-action="admin-tournament-load-more"]').click();await settle(page);await expect(cards(page)).toHaveCount(10);
 expect(await page.evaluate(()=>fixture.queries.length)).toBe(2);expect(errors).toEqual([]);
});
test('a later-page timeout preserves cards and retry requests the same cursor',async({page})=>{
 await page.clock.install();await openManagement(page,{rows:manyRows()});await settle(page);
 await page.evaluate(()=>fixture.holdQuery=true);await page.locator('[data-action="admin-tournament-load-more"]').click();
 await expect.poll(()=>page.evaluate(()=>fixture.queries.length)).toBe(2);await page.clock.fastForward(10001);
 await expect(cards(page)).toHaveCount(5);await expect(page.locator('.auth-error')).toContainText('逾時');
 await page.evaluate(()=>fixture.holdQuery=false);await page.locator('[data-action="admin-tournament-load-more"]').click();await settle(page);
 await expect(cards(page)).toHaveCount(10);expect(await page.evaluate(()=>fixture.queries[2].cursor)).toBe('5');
 await page.evaluate(()=>fixture.queries[1].resolve(fixture.rows));await expect(cards(page)).toHaveCount(10);
});
test('status tabs replace owner tabs and reset the current page',async({page})=>{
 const rows=[...manyRows(),row('Upcoming event',{code:'UPCOMING',registrationStatus:'scheduled'}),row('Closed event',{code:'CLOSED',registrationStatus:'closed'})];
 await openManagement(page,{rows});await settle(page);await expect(page.locator('[data-filter="mine"]')).toHaveCount(0);
 await page.locator('[data-filter="upcoming"]').click();await settle(page);await expect(cards(page)).toHaveCount(1);await expect(cards(page)).toContainText('Upcoming event');
 await page.locator('[data-filter="closed"]').click();await settle(page);await expect(cards(page)).toContainText('Closed event');
 expect(await page.evaluate(()=>fixture.queries.at(-1).cursor)).toBeNull();
});
test('search finds an unloaded event and clearing restores the first five cards',async({page})=>{
 const rows=manyRows();rows[11].name='雪山貓交流賽';await openManagement(page,{rows});await settle(page);
 await page.locator('#admin-tournament-search').fill('雪山貓');await page.locator('[data-action="admin-tournament-search"]').click();await settle(page);
 await expect(cards(page)).toHaveCount(1);await expect(cards(page)).toContainText('雪山貓交流賽');
 await page.locator('[data-action="admin-tournament-search-clear"]').click();await settle(page);await expect(cards(page)).toHaveCount(5);
});
test('Enter submits search without automatic downloads while typing',async({page})=>{
 await openManagement(page,{rows:manyRows()});await settle(page);await page.locator('#admin-tournament-search').fill('Paged room 11');
 expect(await page.evaluate(()=>fixture.queries.length)).toBe(1);await page.locator('#admin-tournament-search').press('Enter');await settle(page);
 await expect(cards(page)).toHaveCount(1);await expect(cards(page)).toContainText('Paged room 11');
});
test('changing status while another response is pending cannot mix categories',async({page})=>{
 const rows=[...manyRows(),row('Upcoming event',{code:'UPCOMING',registrationStatus:'scheduled'})];await openManagement(page,{rows});await settle(page);
 await page.evaluate(()=>fixture.holdQuery=true);await page.locator('[data-action="admin-tournament-load-more"]').click();await expect.poll(()=>page.evaluate(()=>fixture.queries.length)).toBe(2);
 await page.evaluate(()=>fixture.holdQuery=false);await page.locator('[data-filter="upcoming"]').click();await settle(page);
 await page.evaluate(()=>fixture.queries[1].resolve(fixture.rows));await expect(cards(page)).toHaveCount(1);await expect(cards(page)).toContainText('Upcoming event');
});
test('refresh failure keeps the last five cards and offers an in-place retry',async({page})=>{
 await openManagement(page);await settle(page);await page.evaluate(()=>fixture.holdQuery=true);await refresh(page).click();
 await expect.poll(()=>page.evaluate(()=>fixture.queries.length)).toBe(2);await page.evaluate(()=>fixture.queries[1].reject(Error('offline')));
 await expect(page.locator('.auth-error')).toBeVisible();await expect(cards(page)).toHaveCount(1);
 await page.evaluate(()=>fixture.holdQuery=false);await refresh(page).click();await settle(page);await expect(page.locator('.auth-error')).toHaveCount(0);
});
test('logout clears cards and rejects pending previous-account responses',async({page})=>{
 await openManagement(page,{holdQuery:true});await expect.poll(()=>page.evaluate(()=>fixture.queries.length)).toBe(1);
 await page.evaluate(()=>fixture.logout());await page.evaluate(()=>fixture.queries[0].resolve(fixture.rows));await expect(cards(page)).toHaveCount(0);
});
test('empty category differs from a denied first read and remains retryable',async({page})=>{
 await openManagement(page,{holdQuery:true});await expect.poll(()=>page.evaluate(()=>fixture.queries.length)).toBe(1);
 await page.evaluate(()=>fixture.queries[0].reject({code:'functions/permission-denied'}));await expect(page.locator('.auth-error')).toContainText('權限');
 await page.evaluate(()=>{fixture.holdQuery=false;fixture.rows=[];});await refresh(page).click();await settle(page);await expect(page.getByText('此分類目前沒有賽事',{exact:true})).toBeVisible();
});
