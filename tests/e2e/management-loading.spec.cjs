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
const app = between(core, 'let adminMailboxRefreshTimer=null;', '\nfunction startLockoutCountdown(){');
const switchAction = between(core, '  if(action==="switch-tab"){', '\n  if(action==="force-refresh-version"){');
const refreshAction = between(core, '  if(action==="cloud-refresh-admin-list"){', '\n  if(action==="cloud-admin-copy-code"){');
const managementActions = between(core, '  if(action==="admin-tournament-filter"){', '\n  if(action==="load-duty-logs"){');
const searchBinding = between(core, 'function bindAdminTournamentSearchInput(){', '\nfunction bindDynamicInputs(){');
const cloudMethods = between(cloud, '    async queryAdminTournaments(){', '\n    // v13.13.4：玩家');
const cloudDeadline = between(cloud, '  function withTimeout(promise, ms, fallbackValue){', '\n  async function tryInitFirebase(){');
const styles = ['core-competition', 'auth-player', 'player-center-hunter', 'lobby-community', 'call-admin-tail', 'referee-tail', 'tail-p7'];
const scripts = ['/modules/management-v2/navigation.js', '/modules/management-v2/adapter.js', '/event-poster-ui.js', '/modules/main-app/mailbox.js', '/modules/main-app/tournament-entry-utils.js'];
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
let accountMenuOpen = false, engagementSessionEpoch = 0;
let appPhase = 'landing', activeTab = 'management', publicTournamentsCache = {}, myRegistrationsCache = {};
let state = { cloudCode: null, meta: {} }, celebrationOpen = false, shareModalOpen = false, pendingModal = null;
let historyCloudSyncBusy = false, historyCloudSyncLoaded = false, registrationFormDraftDirty = false;
let viewingRecordId = null, viewingRecordData = null;
${declarations}
let refereeAssignmentDraftEnabled = null, mainTabNavScrollLeft = 0, mainTabNavCenterRequested = true;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hasAdminAccess = () => currentRole === 'admin' || currentRole === 'tester';
const currentAuthUid = () => firebaseUser?.uid || '';
const { mailboxContext, loadMailbox, mailboxButtonHtml, renderMailboxPage, handleMailbox } = window.BXHMailbox;
const { isValidRoomCode } = window.BXHTournamentEntryUtils;
const mailboxDate = () => '';
window.engagementService = {
  mailbox: async ({ action, messageId }) => {
    const messages = fixture.mail || [];
    if (action === 'markRead') messages.find(message => message.id === messageId).readAt = Date.now();
    else if (action !== 'list') throw Error('Unexpected mailbox action: ' + action);
    return { ok: true, messages: copy(messages), unreadCount: messages.filter(message => !message.readAt).length };
  }
};
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
const renderRefereeCourtView = (app, markup) => { app.innerHTML = markup; return false; };
const bindDynamicInputs = () => bindAdminTournamentSearchInput(), resetRegistrationFormDraft = () => {}, stopAdminRosterWatch = () => {}, showToast = () => {};
// Summary transport only. Full Firestore reads are forbidden in this fixture.
const cloudEnabled=true,dbHandle={},fx={getDocs(){throw Error('full-collection-read-forbidden');},getDoc(){throw Error('extra-document-read-forbidden');}};
function callEngagementFunction(name,request){
 if(name!=="listManagementTournamentSummaries")throw Error('unexpected callable');
 const call={...request,uid:currentAuthUid()};fixture.queries.push(call);
 const result=rows=>{
  const search=String(request.search||'').toLowerCase();
  const group=row=>row.archiveStatus==='completed'||row.tournamentPhase==='done'?'done':['live','settling'].includes(row.tournamentPhase)?'live':row.registrationStatus==='scheduled'?'upcoming':['closed','cancelled'].includes(row.registrationStatus)?'registration_closed':row.registrationStatus==='draft'?'draft':'open';
  const all=copy(rows).filter(row=>(request.kind==='community'?row.eventAuthority==='community':row.eventAuthority!=='community')&&(!search||[row.name,row.code,row.location||''].some(value=>value.toLowerCase().includes(search))));
  const counts={all:all.length,open:0,upcoming:0,registration_closed:0,live:0,done:0,draft:0};all.forEach(row=>counts[group(row)]++);
  const filtered=all.filter(row=>request.status==='all'||group(row)===request.status).sort((a,b)=>Number(b.code===request.pinCode)-Number(a.code===request.pinCode)||Number(group(b)==='live')-Number(group(a)==='live')||a.code.localeCompare(b.code));
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
  if (action.startsWith('mailbox-')) return handleMailbox(action, target);
  if (action === 'switch-tab' && target.getAttribute('data-tab') !== 'management') throw Error('Unrelated navigation forbidden in this fixture');
  ${switchAction}
  ${refreshAction}
  ${managementActions}
  throw Error('Unexpected fixture action: ' + action);
}
fixture.enter = () => {
  firebaseUser = { uid: 'fixture-owner' }; userProfile = { role: fixture.superAdmin ? 'super_admin' : 'admin', active: true };
  currentRole = 'admin'; activeMode = 'admin'; appPhase = 'app'; activeTab = 'management';
  if(fixture.lastManaged)localStorage.setItem(managedRoomStorageKey(),JSON.stringify({uid:currentAuthUid(),mode:activeMode,code:fixture.lastManaged,tab:'referee'}));
  render();
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
    if (scripts.includes(url.pathname) || url.pathname === '/modules/management-v2/styles.css' || /^\/modules\/main-css\/[a-z0-9-]+\.css$/.test(url.pathname)) return route.continue();
    return route.abort('blockedbyclient');
  });
  await page.goto('/?management_fixture=1', { waitUntil: 'load' });
  await page.locator('[data-fixture-enter]').click();
  expect(errors).toEqual([]);
  await expect(page.locator('[data-management-v2-group="event"]')).toHaveClass('active');
  await expect(page.locator('[data-management-v2-tab="management"]')).toHaveClass('active');
  await expect(page.getByRole('searchbox', { name: '搜尋賽事名稱、房號或地點' })).toBeVisible();
  expect(errors).toEqual([]);
  return errors;
}
const cards = page => page.locator('.tournament-management-card');
const refresh = page => page.locator('[data-action="cloud-refresh-admin-list"]').first();
const getState = page => page.evaluate(() => fixture.state());
async function settle(page) { await expect.poll(() => getState(page).then(state => state.busy)).toBe(false); }

test('highest administrator receives an unread order notification in management mode', async ({ page }) => {
  await page.clock.install();
  const errors = await openManagement(page, { superAdmin: true, mail: [] });
  await settle(page);
  const mailbox = page.locator('.header-account-controls [data-action="mailbox-open"]');
  await expect(mailbox).toBeVisible();
  await expect(mailbox.locator('.mailbox-unread')).toHaveCount(0);
  await page.evaluate(() => fixture.mail.push({
    id: 'order-notice', subject: '商城新訂單', body: '有一筆訂單等待審核', readAt: null
  }));
  await page.clock.fastForward(120000);
  await expect(mailbox.locator('.mailbox-unread')).toHaveText('1');
  await mailbox.click();
  await page.getByRole('button', { name: /商城新訂單/ }).click();
  await expect(page.getByText('有一筆訂單等待審核')).toBeVisible();
  await expect(mailbox.locator('.mailbox-unread')).toHaveCount(0);
  await page.getByRole('button', { name: '返回上一頁' }).click();
  await expect(page.getByRole('searchbox', { name: '搜尋賽事名稱、房號或地點' })).toBeVisible();
  expect(errors).toEqual([]);
});

// All tests stay inside Management identity → Events → Tournament Management.
const manyRows=()=>Array.from({length:12},(_,i)=>row('Paged room '+i,{code:'BXH-'+String(i).padStart(6,'0')}));
test('only five cards load before expansion; background count refresh preserves pagination',async({page})=>{
 await page.clock.install();const errors=await openManagement(page,{rows:manyRows()});await settle(page);
 await expect(cards(page)).toHaveCount(5);await page.clock.fastForward(30000);
 await expect.poll(()=>page.evaluate(()=>fixture.queries.length)).toBe(2);
 await expect(cards(page)).toHaveCount(5);
 await page.locator('[data-action="admin-tournament-load-more"]').click();await settle(page);await expect(cards(page)).toHaveCount(10);
 expect(await page.evaluate(()=>fixture.queries.length)).toBe(3);expect(errors).toEqual([]);
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
 await page.locator('summary').filter({hasText:'其他分類'}).click();await page.locator('[data-filter="upcoming"]').click();await settle(page);await expect(cards(page)).toHaveCount(1);await expect(cards(page)).toContainText('Upcoming event');
 await page.locator('[data-filter="registration_closed"]').click();await settle(page);await expect(cards(page)).toContainText('Closed event');
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
 await page.evaluate(()=>fixture.holdQuery=false);await page.locator('summary').filter({hasText:'其他分類'}).click();await page.locator('[data-filter="upcoming"]').click();await settle(page);
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

test('compact cards keep the last managed room first and retain poster and roster controls inside details',async({page},testInfo)=>{
 const rows=manyRows();rows[8].tournamentPhase='live';rows[11].name='上次接管的房間';
 rows[11].posterUrl='https://firebasestorage.googleapis.com/v0/b/bxh-arena.firebasestorage.app/o/room-posters%2FBXH-000011%2Faaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jpg?alt=media&token=bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
 const errors=await openManagement(page,{rows,lastManaged:'BXH-000011'});await settle(page);
 await expect(cards(page).first()).toContainText('上次接管的房間');await expect(cards(page).nth(1)).toContainText('Paged room 8');
 expect(await page.evaluate(()=>fixture.queries[0].pinCode)).toBe('BXH-000011');
 const details=cards(page).first().locator('.management-card-details');await expect(details).not.toHaveAttribute('open');
 await expect(cards(page).first().getByRole('button',{name:'返回管理',exact:true})).toBeVisible();
 await expect(details.locator('[data-poster-open]').first()).toBeHidden();
 await details.locator('summary').click();await expect(details).toHaveAttribute('open');
 await expect(details.locator('[data-roster-kind="confirmed"]')).toBeVisible();
 await expect(details.locator('.tournament-poster-stats-layout')).toBeVisible();
 await page.evaluate(()=>render());await expect(cards(page).first().locator('.management-card-details')).toHaveAttribute('open');
 await cards(page).first().locator('summary').click();
 const tabs=page.locator('[role="tablist"][aria-label="賽事狀態分類"] [role="tab"]');
 for(const tab of await tabs.all())await expect(tab).toBeVisible();
 expect(await tabs.allTextContents()).toEqual(['全部 12','報名中 11','開賽中 1','已結束 0','報名已關閉 0']);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:testInfo.outputPath('management-compact.png'),fullPage:true});expect(errors).toEqual([]);
});
