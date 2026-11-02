'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {randomUUID} = require('node:crypto');

const moduleDir = path.join(__dirname, '../modules/referee-license');
const sources = ['domain.js', 'ui.js'].map(name => fs.readFileSync(path.join(moduleDir, name), 'utf8'));
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => {resolve = a; reject = b;}); return {promise, resolve, reject}; };
function snapshot(uid, changes = {}) {
  const base = {
    uid, person: {realName: '測試裁判', nickname: '驗證用'}, revision: 7,
    certificate: {number: 'BXH-REF-0007', awardedLevel: 5, status:'active', issuedAt: 1760000000000, photoDataUrl: '', isChief: false},
    stats: {decisions: 240, eventCount: 12, scales: {64: 10, 96: 3, 128: 1},
      milestones: Object.fromEntries(Array.from({length: 10}, (_, i) => [(i + 1) * 100, i < 3 ? 1 : 0])),
      unknownScaleEvents: 0, pendingLogCount: 0, pendingEvents: 0, systemDecisions: 240, backfillDecisions: 0, knownMaxSize: 320, maxPrecision: 'exact'},
    eligibleLevel: 5, backfills: [], systemRecords: [], chiefRevision: 2, isChief: false, incomplete: false
  };
  return {...base, ...changes, stats: {...base.stats, ...changes.stats}};
}
function harness(handler) {
  const listeners = {}, calls = [];
  const h = {handler, calls, live: {uid: '', epoch: 0, isSuperAdmin: false}, renders: 0};
  const document = {addEventListener: (name, callback) => {listeners[name] = callback;}};
  const window = {crypto: {randomUUID}, engagementService: {refereeLicense(payload) {calls.push(plain(payload)); return h.handler(payload);}}};
  const sandbox = vm.createContext({window, document, console, setTimeout, clearTimeout});
  for (const source of sources) vm.runInContext(source, sandbox);
  h.api = window.BXHRefereeLicense; h.domain = window.BXHRefereeLicenseDomain;
  h.ctx = (uid, isSuperAdmin = false, epoch = 1) => {
    h.live = {uid, epoch, isSuperAdmin};
    return {uid, epoch, isSuperAdmin, currentSession: () => h.live, rerender: () => {h.renders++;}};
  };
  h.action = (key, ctx, data = {}) => h.api.handleAction('referee-license-' + key, {dataset: data}, ctx);
  h.query = value => listeners.input({target: {dataset: {refereeQuery: ''}, value}});
  h.field = (name, value) => listeners.input({target: {dataset: {refereeField: name}, value,
    closest: () => ({querySelector: selector => selector === '[name="size"]' ? {} : {innerHTML: ''}})}});
  h.change = (dataset, value) => listeners.change({target: {dataset, value}});
  h.select = async (ctx, uid) => {
    h.api.renderAdmin(ctx); h.query(uid); h.action('search', ctx); await tick();
    h.action('select', ctx, {uid}); await tick(); h.api.renderAdmin(ctx);
  };
  return h;
}

test('inclusive scale previews, unknown sizes, exact limits and within-grade progress', () => {
  const h = harness(() => {}), D = h.domain, source = snapshot('u');
  assert.equal(D.progress(source).fraction, .16);
  const entry = {kind:'event',sourceKey:'historical:event',basis:'核實依據',decisions: 0, events: 1, size: 148, precision: 'exact', period: '系統開始記錄前', note: ''};
  const impact = D.impact(source, entry);
  assert.deepEqual(plain(impact.eventCount), {current: 12, after: 13});
  assert.deepEqual(plain(impact.thresholds.map(item => item.size)), [64, 96, 128, 100]);
  assert.equal(D.impact(source, {...entry, size: 96}).thresholds.some(item => item.size === 100), false);
  assert.equal(D.impact(source, {...entry, size: 1000}).thresholds.filter(item => item.size % 100 === 0).length, 10);
  const unknown = D.impact(source, {...entry, events: 1, size: null, precision: 'unknown'});
  assert.equal(unknown.eventCount.after, 13); assert.equal(unknown.thresholds.length, 0);
  const existing = {...entry, id: 'old', status: 'active'};
  const corrected = D.impact({...source, backfills: [existing]}, {...entry, id: 'old', events: 1});
  assert.equal(corrected.eventCount.after, 12, 'editing replaces the original entry');
  assert(D.validateEntry({...entry, decisions: 1000001}).length);
  assert(D.validateEntry({...entry, period: '期'.repeat(101)}).length);
  assert(D.validateEntry({...entry, note: '註'.repeat(501)}).length);
  assert(D.validateEntry({...entry, size: 64, precision: 'unknown'}).length);
  assert.equal(D.validateEntry({...entry, size: null, precision: 'unknown'}).length, 0);
  assert.equal(source.stats.eventCount, 12, 'a preview never mutates server data');
});

test('late account-A response cannot render into account B, including same-UID new epoch', async () => {
  const a = deferred(), b = deferred();
  const h = harness(payload => h.calls.length === 1 ? a.promise : b.promise);
  const ctxA = h.ctx('A', false, 1);
  assert.match(h.api.renderDuty(ctxA), /正在讀取/);
  const ctxB = h.ctx('B', false, 2); h.api.renderDuty(ctxB);
  b.resolve({ok: true, snapshot: snapshot('B', {person: {realName: '乙裁判'}, stats: {decisions: 211}})}); await tick();
  a.resolve({ok: true, snapshot: snapshot('A', {person: {realName: '甲私密裁判'}, stats: {decisions: 999}})}); await tick();
  const html = h.api.renderDuty(ctxB);
  assert.match(html, /乙裁判/); assert.doesNotMatch(html, /甲私密裁判|999/);
  assert.equal(h.renders, 1, 'only current session may request a rerender');
  const old = deferred(), fresh = deferred(); h.handler = () => h.calls.length === 3 ? old.promise : fresh.promise;
  h.action('refresh', ctxB, {uid: 'B'});
  const renewed = h.ctx('B', false, 3); h.api.renderDuty(renewed);
  fresh.resolve({ok: true, snapshot: snapshot('B', {person: {realName: '新工作階段'}})}); await tick();
  old.resolve({ok: true, snapshot: snapshot('B', {person: {realName: '舊工作階段'}})}); await tick();
  assert.equal(h.calls.length, 4);
  assert.match(h.api.renderDuty(renewed), /新工作階段/); assert.doesNotMatch(h.api.renderDuty(renewed), /舊工作階段/);
});

test('get errors and malformed snapshots stay explicit, never become zero totals', async () => {
  const h = harness(async () => {throw Object.assign(new Error('offline'), {code: 'unavailable'});});
  const ctx = h.ctx('owner'); h.api.renderDuty(ctx); await tick();
  let html = h.api.renderDuty(ctx);
  assert.match(html, /連線尚未確認/); assert.doesNotMatch(html, /class="rl-metrics"/);
  h.handler = async () => ({ok: true, snapshot: snapshot('owner', {stats: {scales: {64: 2}}})});
  h.action('refresh', ctx, {uid: 'owner'}); await tick();
  html = h.api.renderDuty(ctx); assert.match(html, /資料格式尚未完整/); assert.doesNotMatch(html, /class="rl-metrics"/);
  h.handler = async () => ({ok: true, snapshot: snapshot('owner')});
  h.action('refresh', ctx, {uid: 'owner'}); await tick(); assert.match(h.api.renderDuty(ctx), /class="rl-metrics"/);
});

test('backfill keeps confirmed totals while saving and accepts only returned server state', async () => {
  const saving = deferred(), base = snapshot('target');
  const h = harness(async payload => payload.action === 'search' ? {ok: true, items: [{uid: 'target'}]} : payload.action === 'get' ? {ok: true, snapshot: base} : saving.promise);
  const ctx = h.ctx('admin', true); await h.select(ctx, 'target');
  h.field('sourceKey','historical:one');h.field('basis','核實責任');h.field('decisions', '1'); h.field('note', '依記憶認列'); h.action('save-backfill', ctx);
  const request = h.calls.find(item => item.action === 'saveBackfill');
  assert.equal(request.expectedRevision, 7); assert.equal(request.entry.decisions, 1); assert.equal(request.entry.note, '依記憶認列');
  assert.match(request.operationId, /^[a-f0-9-]{36}$/);
  assert.match(h.api.renderAdmin(ctx), /累積判決 <strong>240<\/strong>/);
  assert.equal(base.stats.decisions, 240);
  saving.resolve({ok: true, snapshot: snapshot('target', {revision: 8, stats: {decisions: 261, backfillDecisions: 21}})}); await tick();
  assert.match(h.api.renderAdmin(ctx), /累積判決 <strong>261<\/strong>/);
  assert.doesNotMatch(h.api.renderAdmin(ctx), /有一筆變更尚待確認/);
});

test('ambiguous write failure retries the identical operation, never adds duplicate backfill', async () => {
  let tries = 0;
  const h = harness(async payload => {
    if (payload.action === 'search') return {ok: true, items: [{uid: 'target'}]};
    if (payload.action === 'get') return {ok: true, snapshot: snapshot('target')};
    if (++tries === 1) throw Object.assign(new Error('response-lost'), {code: 'deadline-exceeded'});
    return {ok: true, snapshot: snapshot('target', {revision: 8, stats: {decisions: 270}})};
  });
  const ctx = h.ctx('admin', true); await h.select(ctx, 'target');
  h.field('sourceKey','historical:two');h.field('basis','核實責任');h.field('decisions', '1'); h.action('save-backfill', ctx); await tick();
  assert.match(h.api.renderAdmin(ctx), /重試原操作/);
  h.field('decisions', '99'); h.action('retry', ctx); await tick();
  const writes = h.calls.filter(item => item.action === 'saveBackfill');
  assert.deepEqual(writes[1], writes[0]); assert.equal(writes[1].entry.decisions, 1);
  assert.doesNotMatch(h.api.renderAdmin(ctx), /重試原操作/);
  h.field('sourceKey','historical:three');h.field('basis','核實責任');h.field('decisions', '1'); h.action('save-backfill', ctx); await tick();
  assert.notEqual(h.calls.at(-1).operationId, writes[0].operationId);
  assert.equal(h.calls.at(-1).expectedRevision, 8);
});

test('revision conflict rereads authoritative totals, preserves draft and requires a new explicit send', async () => {
  let gets = 0, writes = 0;
  const h = harness(async payload => {
    if (payload.action === 'search') return {ok: true, items: [{uid: 'target'}]};
    if (payload.action === 'get') return {ok: true, snapshot: snapshot('target', ++gets === 1 ? {} : {revision: 9, stats: {decisions: 250}})};
    if (++writes === 1) throw Object.assign(new Error('revision-conflict'), {code: 'aborted'});
    return {ok: true, snapshot: snapshot('target', {revision: 10, stats: {decisions: 255}})};
  });
  const ctx = h.ctx('admin', true); await h.select(ctx, 'target'); h.field('sourceKey','historical:four');h.field('basis','核實責任');h.field('decisions', '1'); h.action('save-backfill', ctx); await tick();
  assert.equal(writes, 1); assert.equal(gets, 2); assert.match(h.api.renderAdmin(ctx), /本次未自動重送/);
  assert.match(h.api.renderAdmin(ctx), /累積判決 <strong>250<\/strong>/);
  h.action('save-backfill', ctx); await tick();
  const requests = h.calls.filter(item => item.action === 'saveBackfill');
  assert.equal(requests[1].expectedRevision, 9); assert.equal(requests[1].entry.decisions, 1);
  assert.notEqual(requests[1].operationId, requests[0].operationId);
});

test('incomplete sources block grants, excluded logs are labelled, and retained awards are visible', async () => {
  const source = snapshot('target', {eligibleLevel: 6, incomplete: true,
    systemRecords: ['current-result-not-completed','different-confirming-referee','test-event','cancelled-event','duplicate-source-key','bye'].map(reason => ({status: 'excluded', reason}))});
  const h = harness(async payload => payload.action === 'search' ? {ok: true, items: [{uid: 'target', active: false}], incomplete: true} : {ok: true, snapshot: source});
  const ctx = h.ctx('admin', true); await h.select(ctx, 'target');
  let html = h.api.renderAdmin(ctx);
  assert.match(html, /referee-license-grant"[^>]*disabled/); assert.match(html, /資料待完整核對/);
  assert.match(html, /結果較多/); assert.match(html, /已停用帳號/); assert.match(html, /maxlength="80"/);
  for (const text of ['未計入','判決已撤回','其他裁判確認','測試賽事','已取消','重複紀錄','輪空']) assert(html.includes(text), text);
  const before = h.calls.length; h.action('grant', ctx); assert.equal(h.calls.length, before);
  h.handler = async () => ({ok: true, snapshot: snapshot('target', {eligibleLevel: 4})});
  const personal = h.ctx('target'); h.api.renderDuty(personal); await tick();
  html = h.api.renderDuty(personal); assert.match(html, /既有授予保留，經歷資料待核對/);
});

test('chief without a certificate can be cleared and a new global appointment invalidates other cached chiefs', async () => {
  const records = {A: snapshot('A', {certificate: null, isChief: true}), B: snapshot('B')};
  const h = harness(async payload => {
    if (payload.action === 'search') return {ok: true, items: [{uid: 'A'}, {uid: 'B'}]};
    if (payload.action === 'get') return {ok: true, snapshot: records[payload.targetUid]};
    if (payload.action === 'setChief') {
      records.A = {...records.A, isChief: false, chiefRevision: 3};
      records.B = {...records.B, isChief: true, chiefRevision: 3, revision: 8};
      return {ok: true, snapshot: records[payload.targetUid]};
    }
  });
  const ctx = h.ctx('admin', true); await h.select(ctx, 'A');
  assert.match(h.api.renderAdmin(ctx), /裁判長已指定，裁判證尚未發行/);
  assert.match(h.api.renderAdmin(ctx), /解除裁判長指定/);
  h.action('select', ctx, {uid: 'B'}); await tick(); h.api.renderAdmin(ctx); h.action('chief', ctx); await tick();
  h.action('select', ctx, {uid: 'A'}); await tick();
  assert.equal(h.calls.filter(item => item.action === 'get' && item.targetUid === 'A').length, 2);
  assert.doesNotMatch(h.api.renderAdmin(ctx), /解除裁判長指定/);
});

test('self photo removal and identical retry are allowed; other-person photo and admin actions are blocked', async () => {
  let attempts = 0;
  const h = harness(async payload => {
    if (payload.action === 'get') return {ok: true, snapshot: snapshot('self', {certificate: null, photoDataUrl: 'data:image/png;base64,YQ=='})};
    if (++attempts === 1) throw Object.assign(new Error('response-lost'), {code: 'unavailable'});
    return {ok: true, snapshot: snapshot('self', {certificate: null, revision: 8, photoDataUrl: ''})};
  });
  const ctx = h.ctx('self'); h.api.renderDuty(ctx); await tick();
  assert.match(h.api.renderDuty(ctx), /data:image\/png;base64,YQ==/);
  h.action('photo-remove', ctx, {uid: 'someone-else'}); h.action('grant', ctx); h.action('save-backfill', ctx);
  assert.equal(h.calls.length, 1);
  h.action('photo-remove', ctx, {uid: 'self'}); await tick();
  assert.match(h.api.renderDuty(ctx), /重試原操作/);
  h.action('retry', ctx); await tick();
  const writes = h.calls.filter(item => item.action === 'photo');
  assert.equal(writes.length, 2); assert.deepEqual(writes[0], writes[1]);
  assert.equal(writes[0].targetUid, 'self'); assert.equal(writes[0].dataUrl, '');
});

test('host achievement navigation keeps the real duty tab authoritative and reset drops cache', async () => {
  const h = harness(async () => ({ok: true, snapshot: snapshot('self')}));
  const ctx = h.ctx('self'); let navigated = 0; ctx.onRefereeAchievements = () => {navigated++; return true;};
  h.api.renderDuty(ctx); await tick(); h.action('show-achievements', ctx);
  assert.equal(navigated, 1); assert.match(h.api.renderDuty(ctx), /data-referee-view="duty"/);
  assert.match(h.api.renderAchievements(ctx), /data-referee-view="achievements"/);
  h.api.resetSession(); h.api.renderDuty(ctx); await tick(); assert.equal(h.calls.length, 2);
});
