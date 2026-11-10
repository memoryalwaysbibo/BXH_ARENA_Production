'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const view = require('../group-history/view.js');
function fixture() {
  const match = { id: 'm1', round: 0, indexInRound: 0, bracket: 'SE', a: { playerId: 'self' }, b: { playerId: 'other' }, scoreA: 4, scoreB: 2, winnerId: 'self', loserId: 'other', completed: true };
  return { parent: { code: 'BXH-ABC123', name: '合成賽事' }, stages: view.keys.map(key => ({ key, status: key === 'A' ? 'completed' : 'unpublished', players: [{ id: 'self', name: '<本人>' }, { id: 'other', name: '<本人>' }], matches: [match] })), ownPlayerIds: ['self'], ownMatches: [{ stageKey: 'A', ...match }], placements: [{ playerId: 'self', placement: 3, points: 99 }], pointsStatus: 'unverified' };
}
test('six selectors render exactly one tree; unpublished/malformed stages never render roster', () => {
  const data = fixture(), ready = view.previews(data);
  assert.equal((ready.match(/role="tab"/g) || []).length, 6);
  assert.equal((ready.match(/role="tabpanel"/g) || []).length, 1);
  assert.equal((ready.match(/class="group-history-tree"/g) || []).length, 1);
  assert.ok(ready.includes('第 5～8 名')); assert.ok(ready.includes('第 1～4 名'));
  for (const status of ['unpublished', 'not-applicable', 'invalid']) {
    data.stages[1].status = status;
    const html = view.previews(data, 'B');
    assert.ok(!html.includes('&lt;本人&gt;')); assert.ok(!html.includes('group-history-match'));
  }
});
test('own history uses stable IDs and keeps zero/unknown points unverified', () => {
  const data = fixture();
  data.ownMatches.push({ ...data.ownMatches[0], a: { playerId: 'stranger' }, b: { playerId: 'other' }, id: 'not-own', scoreA: 99 });
  data.placements.push({ playerId: 'stranger', placement: 1, points: 99 });
  const html = view.ownHistory(data);
  assert.ok(html.includes('第 3 名')); assert.ok(!html.includes('第 1 名')); assert.ok(!html.includes('99'));
  assert.ok(html.includes('積分尚未核對入帳')); assert.ok(html.includes('子房不另計天梯積分'));
  assert.equal((html.match(/<li>/g) || []).length, 1); assert.ok(html.includes('&lt;本人&gt;')); assert.ok(!html.includes('<本人>'));
  data.ownPlayerIds = []; assert.ok(!view.ownHistory(data).includes('第 3 名'));
});
test('review-needed stages suppress disputed matches and placement, bronze rounds are named', () => {
  const data = fixture(); data.stages[0].matches[0].bracket = 'BZ'; data.ownMatches[0].bracket = 'BZ';
  assert.ok(view.previews(data).includes('季軍賽')); assert.ok(view.ownHistory(data).includes('季軍賽'));
  data.stages[0].needsReview = true;
  assert.ok(!view.previews(data).includes('group-history-match'));
  assert.ok(!view.ownHistory(data).includes('第 3 名')); assert.ok(!view.ownHistory(data).includes('<li>'));
});
test('parent bracket no-draw branch is reached before generic missing bracket; child is excluded', () => {
  const core = fs.readFileSync('modules/main-app/core.js', 'utf8');
  const start = core.indexOf('function renderBracket(){'), end = core.indexOf('\n}', start) + 2;
  const c = vm.createContext({ window: { BXHGroupHistoryView: view, BXHGroupStageUi: { enabled: () => true } }, firebaseUser: { uid: 'owner' }, state: { cloudCode: 'BXH-ABC123', meta: {}, bracketSize: 0 }, bracketRefreshButtonHtml: () => '' });
  vm.runInContext(core.slice(start, end), c);
  assert.ok(c.renderBracket().includes('id="bxh-group-history"')); assert.ok(!c.renderBracket().includes('尚未產生對戰表'));
  c.state.groupStage = { parentCode: 'BXH-PARENT' };
  assert.ok(!c.renderBracket().includes('id="bxh-group-history"'));
  assert.ok(core.includes('window.BXHGroupHistoryView.slot(rec.cloudCode,"preview"'));
  assert.ok(core.includes('window.BXHGroupHistoryView?.slot("","own",false)'));
  assert.ok(core.includes('window.BXHGroupHistory?.suspendSession(currentAuthUid(),engagementSessionEpoch)'));
});
test('runtime assets load before core; authenticated read-only integration has no direct DB or scheduler access', () => {
  const index = fs.readFileSync('index.html', 'utf8'), integration = fs.readFileSync('group-history/integration.js', 'utf8');
  for (const name of ['view.js', 'integration.js', 'view.css']) assert.ok(index.indexOf('group-history/' + name) < index.indexOf('id="bxh-main-app-m7"'));
  assert.ok(integration.includes("{ action: 'history', parentCode: code }"));
  assert.ok(!/getDoc|getDocs|query\(|collection\(|open-all|prepare'|setDoc|localStorage|sessionStorage/.test(integration));
});
test('archived no-draw parent retains history entry even without current frontend allowlist', () => {
  const core = fs.readFileSync('modules/main-app/core.js', 'utf8');
  const start = core.indexOf('function renderHistoryDetail('), end = core.indexOf('\n}', start) + 2;
  const original = { id: 'unrelated' };
  const c = vm.createContext({ window: { BXHGroupHistoryView: view, BXHGroupStageUi: { enabled: () => false } }, firebaseUser: { uid: 'owner' }, state: original,
    computeStats: () => [], tournamentEligiblePlayers: players => players, esc: view.esc, renderSystemClosureNotice: () => '', isSuperAdmin: () => false,
    FORMAT_LABELS: { single: '單淘汰' }, ARCHIVE_LABELS: { completed: '已封存' }, renderStandingsTableGeneric: () => '' });
  vm.runInContext(core.slice(start, end), c);
  const html = c.renderHistoryDetail({ id: 'old-parent', cloudCode: 'BXH-ABC123', meta: { formatType: 'single' }, players: [], matches: [], bracketSize: 0, archiveStatus: 'completed' });
  assert.ok(html.includes('id="bxh-group-history"')); assert.ok(html.includes('data-auto="false"')); assert.ok(!html.includes('此賽事尚未產生對戰表'));
  assert.ok(html.includes('由分組賽紀錄服務核對後顯示')); assert.equal(c.state, original);
});
test('unknown scores remain dashes, zero is displayed only when actually provided', () => {
  const data = fixture(); data.stages[0].matches[0].scoreA = null; data.stages[0].matches[0].scoreB = 0;
  const html = view.previews(data); assert.ok(html.includes('<b>—</b>')); assert.ok(html.includes('<b>0</b>'));
  data.ownMatches[0].scoreA = undefined; data.ownMatches[0].scoreB = null;
  assert.ok(view.ownHistory(data).includes('比分 —：—'));
});
test('player sees locked group and upcoming opponents without premature zero scores', () => {
  const data = fixture();
  data.assignedGroups = ['B'];
  data.stages[1].status = 'scheduled';
  data.stages[1].matches[0].completed = false;
  data.stages[1].matches[0].scoreA = 0;
  data.stages[1].matches[0].scoreB = 0;
  data.ownMatches = [{ ...data.stages[1].matches[0], stageKey: 'B' }];
  const html = view.previews(data, 'B');
  assert.ok(html.includes('你的抽籤組別'));
  assert.ok(html.includes('B 組'));
  assert.ok(html.includes('已抽籤 · 待開賽'));
  assert.ok(html.includes('&lt;本人&gt;'));
  assert.equal((html.match(/<b>—<\/b>/g) || []).length, 2);
  const own = view.ownHistory(data);
  assert.ok(own.includes('你的抽籤組別'));
  assert.ok(own.includes('比分 —：—'));
});
test('authoritative core identity reset wipes retained group DOM and unbinds scheduler before next render', () => {
  const core = fs.readFileSync('modules/main-app/core.js', 'utf8');
  const start = core.indexOf('function syncEngagementIdentity('), end = core.indexOf('\n}', start) + 2;
  const calls = [];
  const c = vm.createContext({ firebaseUser: { uid: 'old' }, engagementSessionKey: 'old', engagementSessionEpoch: 5, engagementRequestGeneration: 1, engagementDayTimer: 0,
    window: { BXHGroupHistory: { resetSession: () => calls.push('history-clear') }, BXHGroupStageUi: { bind: node => calls.push(node === null ? 'scheduler-unbind' : 'BAD') } }, clearTimeout() {} });
  vm.runInContext(core.slice(start, end), c);
  c.syncEngagementIdentity('old'); assert.deepEqual(calls, []);
  c.syncEngagementIdentity(null); assert.deepEqual(calls, ['history-clear', 'scheduler-unbind']); assert.equal(c.engagementSessionEpoch, 6);
  c.syncEngagementIdentity('old'); assert.equal(c.engagementSessionEpoch, 7); assert.equal(calls.length, 4);
});
test('core player logout and confirmed admin logout suspend history before awaiting signOut', () => {
  const core = fs.readFileSync('modules/main-app/core.js', 'utf8');
  for (const action of ['player-logout', 'account-logout']) {
    const calls = [], start = core.indexOf('  if(action==="' + action + '"){');
    const end = core.indexOf('\n  if(action===', start + 5);
    const c = vm.createContext({ currentAuthUid: () => 'self', engagementSessionEpoch: 4, accountMenuOpen: true, authAvailable: () => true,
      window: { BXHGroupHistory: { suspendSession: (uid, epoch) => calls.push(['suspend', uid, epoch]) }, BXHGroupStageUi: { bind: () => calls.push(['unbind']) }, cloudAuth: { isReady: () => true, signOutUser: () => { calls.push(['signout']); return new Promise(() => {}); } } },
      openModal: options => { c.confirm = options.onConfirm; } });
    vm.runInContext('function act(){const action=' + JSON.stringify(action) + ';' + core.slice(start, end) + '\n}', c);
    c.act();
    if (action === 'account-logout') { assert.deepEqual(calls, []); c.confirm(); }
    assert.deepEqual(calls, [['suspend', 'self', 4], ['unbind'], ['signout']]);
  }
});
