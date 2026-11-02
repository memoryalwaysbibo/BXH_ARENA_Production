'use strict';
// Isolated browser fixture: no Firebase project, production account or network writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(require.resolve('playwright', {paths: [process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || '.']}));
const repo = path.join(__dirname, '..');
const origin = 'https://referee.fixture.test';
const executablePath = process.env.BXH_TEST_BROWSER || process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

(async () => {
  const browser = await chromium.launch({headless: true, ...(executablePath ? {executablePath} : {}), args: ['--no-sandbox']});
  try {
    const page = await browser.newPage({viewport: {width: 320, height: 900}}), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/') return route.fulfill({contentType: 'text/html', body: '<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Referee UI validation</title><style>body{margin:0;background:#11161e;padding:12px}button,input,select,textarea{font:inherit}main{max-width:900px;margin:auto;min-width:0}</style><link rel="stylesheet" href="/modules/referee-license/styles.css"><main id="app"></main><script src="/modules/referee-license/domain.js"></script><script src="/modules/referee-license/ui.js"></script></html>'});
      if (!/^\/modules\/referee-license\/(?:styles\.css|domain\.js|ui\.js|fonts\/bxh-kai-subset\.ttf)$/.test(url.pathname)) return route.abort();
      return route.fulfill({body: fs.readFileSync(path.join(repo, url.pathname.slice(1))), contentType: url.pathname.endsWith('.css') ? 'text/css' : url.pathname.endsWith('.js') ? 'application/javascript' : 'font/ttf'});
    });
    await page.goto(origin);
    await page.evaluate(() => {
      function make(uid, extra = {}) {
        const base = {uid, person: {realName: uid === 'self' ? '林以安' : '陳定宇', nickname: '驗證專用裁判'}, revision: 7,
          certificate: {number: 'BXH-REF-000007', awardedLevel: 5, status:'active', issuedAt: 1760000000000, photoDataUrl: '', isChief: false},
          stats: {decisions: 240, eventCount: 12, scales: {64: 10, 96: 3, 128: 1}, milestones: Object.fromEntries(Array.from({length: 10}, (_, i) => [(i + 1) * 100, i < 3 ? 1 : 0])), unknownScaleEvents: 0, pendingLogCount: 0, pendingEvents: 0, systemDecisions: 240, backfillDecisions: 0, knownMaxSize: 320, maxPrecision: 'exact'},
          eligibleLevel: 5, backfills: [], chiefRevision: 2, isChief: false, incomplete: false,
          systemRecords: [{eventName: '已完成正式賽', status: 'verified', confirmedAt: 1760000000000, station: 2}, {eventName: '撤回判決紀錄', status: 'excluded', reason: 'current-result-not-completed'}, {eventName: '進行中正式賽', status: 'pending_event'}, {eventName: '待確認活動', status: 'pending', reason: 'event-authority-unresolved'}]};
        return {...base, ...extra, stats: {...base.stats, ...extra.stats}};
      }
      const clone = value => JSON.parse(JSON.stringify(value));
      const f = window.fixture = {uid: 'self', epoch: 1, isSuperAdmin: false, view: 'duty', calls: [], holdMutation: false, nextMutation: null,
        snapshots: {self: make('self'), target: make('target'), pending: make('pending', {incomplete: true, eligibleLevel: 6}), zero: make('zero', {certificate: null, eligibleLevel: 0, stats: {decisions: 0, eventCount: 0}})}};
      f.render = () => {
        const ctx = {uid: f.uid, epoch: f.epoch, isSuperAdmin: f.isSuperAdmin, currentSession: () => ({uid: f.uid, epoch: f.epoch, isSuperAdmin: f.isSuperAdmin}), rerender: f.render,
          onRefereeAchievements: () => {f.view = 'achievements'; f.render(); return true;}};
        f.ctx = ctx;
        document.getElementById('app').innerHTML = f.view === 'admin' ? BXHRefereeLicense.renderAdmin(ctx) : f.view === 'achievements' ? BXHRefereeLicense.renderAchievements(ctx) : BXHRefereeLicense.renderDuty(ctx);
      };
      f.switchSession = (uid, isSuperAdmin, view) => {f.uid = uid; f.isSuperAdmin = isSuperAdmin; f.view = view; f.epoch++; f.render();};
      window.engagementService = {refereeLicense: async payload => {
        f.calls.push(clone(payload));
        if (payload.action === 'search') return {ok: true, items: [{uid: 'target', realName: '陳定宇', nickname: '驗證專用裁判', active: true}, {uid: 'pending', realName: '待核對裁判', active: true}, {uid: 'zero', realName: '未授證裁判', active: true}], incomplete: false};
        if (payload.action === 'get') return {ok: true, snapshot: clone(f.snapshots[payload.targetUid || f.uid])};
        if (f.holdMutation) await new Promise(resolve => {f.release = () => {f.holdMutation = false; resolve();};});
        const before = f.snapshots[payload.targetUid];
        if (payload.expectedRevision !== before.revision) throw Object.assign(new Error('revision-conflict'), {code: 'aborted'});
        let next = f.nextMutation ? clone(f.nextMutation) : clone(before); f.nextMutation = null;
        next.revision = before.revision + 1;
        if (payload.action === 'photo') {next.photoDataUrl = payload.dataUrl; if (next.certificate) next.certificate.photoDataUrl = payload.dataUrl;}
        if (payload.action === 'grant') next.certificate.awardedLevel = payload.level;
        if (payload.action === 'setChief') {next.isChief = payload.appointed; next.chiefRevision++; if (next.certificate) next.certificate.isChief = payload.appointed;}
        f.snapshots[payload.targetUid] = next;
        return {ok: true, snapshot: clone(next)};
      }};
      document.addEventListener('click', event => {const element = event.target.closest('[data-action]'); if (element && !element.disabled) BXHRefereeLicense.handleAction(element.dataset.action, element, f.ctx);});
      f.render();
    });
    await page.locator('.rl-certificate').waitFor(); await page.evaluate(() => document.fonts.ready);
    const noOverflow = async label => {
      const overflow = await page.evaluate(() => ({document: document.documentElement.scrollWidth > innerWidth,
        nodes: [...document.querySelectorAll('.rl-root *')].filter(el => {const r = el.getBoundingClientRect(); return r.width && r.height && (r.right > innerWidth + 1 || r.left < -1);}).map(el => el.className).slice(0, 8)}));
      assert.equal(overflow.document, false, label + ': document overflow'); assert.deepEqual(overflow.nodes, [], label + ': child overflow');
    };
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({width, height: 900});
      for (const colorScheme of ['light', 'dark']) {
        await page.emulateMedia({colorScheme});
        await noOverflow('duty ' + width + ' ' + colorScheme);
        await page.evaluate(() => document.querySelectorAll('details').forEach(el => {el.open = true;}));
        await noOverflow('expanded duty ' + width + ' ' + colorScheme);
      }
    }
    await page.setViewportSize({width: 320, height: 900}); await page.emulateMedia({colorScheme: 'light'});
    await page.evaluate(() => document.querySelectorAll('details').forEach(el => {el.open = false;}));
    await page.screenshot({path: '/tmp/bxh-referee-production-duty-320.png', fullPage: true});
    await page.getByRole('button', {name: '查看成就', exact: true}).click();
    assert.equal(await page.locator('.rl-achievement').count(), 10); await noOverflow('achievements 320');
    await page.screenshot({path: '/tmp/bxh-referee-production-achievements-320.png', fullPage: true});
    await page.evaluate(() => {fixture.view = 'duty'; fixture.render();});
    await page.locator('[data-referee-view="duty"]').waitFor();
    await page.getByText('數據來源與執勤紀錄', {exact: true}).click();
    assert((await page.locator('.rl-record').allTextContents()).some(text => text.includes('未計入') && text.includes('判決已撤回')));

    // Exercise the real File/Image/canvas path and wait for server confirmation.
    const png = await page.evaluate(() => {const c = document.createElement('canvas'); c.width = 90; c.height = 120; const p = c.getContext('2d'); p.fillStyle = '#d9e2e8'; p.fillRect(0, 0, 90, 120); p.fillStyle = '#486b77'; p.beginPath(); p.arc(45, 41, 20, 0, Math.PI * 2); p.fill(); p.fillRect(20, 72, 50, 50); return c.toDataURL('image/png').split(',')[1];});
    const file = {name: 'referee-photo.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64')};
    await page.getByText('裁判照片', {exact: true}).last().click();
    await page.locator('[data-referee-photo-input]').setInputFiles(file);
    await page.getByRole('button', {name: '儲存照片', exact: true}).waitFor();
    await page.evaluate(() => {fixture.holdMutation = true;});
    await page.getByRole('button', {name: '儲存照片', exact: true}).click();
    await page.waitForFunction(() => typeof fixture.release === 'function');
    assert.equal(await page.locator('.rl-certificate .rl-photo img').count(), 0, 'photo must await authoritative response');
    const photoRequest = await page.evaluate(() => fixture.calls.at(-1));
    assert.equal(photoRequest.action, 'photo'); assert.equal(photoRequest.targetUid, 'self'); assert(photoRequest.dataUrl.startsWith('data:image/jpeg;base64,'));
    assert(photoRequest.dataUrl.length <= 600000); assert(Buffer.from(photoRequest.dataUrl.split(',')[1], 'base64').length <= 450000);
    await page.evaluate(() => fixture.release()); await page.locator('.rl-certificate .rl-photo img').waitFor();
    await page.getByText('裁判照片', {exact: true}).last().click();
    await page.locator('[data-referee-photo-input]').setInputFiles(file);
    await page.getByRole('button', {name: '儲存照片', exact: true}).waitFor();
    await page.evaluate(() => {fixture.snapshots.self.revision++;});
    await page.getByRole('button', {name: '儲存照片', exact: true}).click();
    await page.getByText(/本次未自動重送/).waitFor();
    assert.equal(await page.evaluate(() => fixture.calls.filter(p => p.action === 'photo').length), 2);
    await page.getByRole('button', {name: '儲存照片', exact: true}).click();
    await page.getByText('裁判照片已更新。', {exact: true}).waitFor();
    assert.equal(await page.evaluate(() => fixture.calls.filter(p => p.action === 'photo').at(-1).expectedRevision), 9);
    await page.getByText('裁判照片', {exact: true}).last().click();
    await page.getByRole('button', {name: '移除照片', exact: true}).click();
    await page.waitForFunction(() => !document.querySelector('.rl-certificate .rl-photo img'));

    await page.evaluate(() => fixture.switchSession('admin', true, 'admin'));
    await page.locator('[data-referee-query]').fill('陳定宇');
    await page.locator('[data-referee-form="search"] button').click();
    await page.locator('[data-action="referee-license-select"][data-uid="target"]').click();
    await page.locator('[data-referee-form="backfill"]').waitFor();
    await page.locator('[name="kind"]').selectOption('event');await page.locator('[name="sourceKey"]').fill('historical:fixture-event');await page.locator('[name="basis"]').fill('fixture verified experience');await page.locator('[name="precision"]').selectOption('exact');await page.locator('[name="decisions"]').fill('0'); await page.locator('[name="events"]').fill('1');
    await page.locator('[name="size"]').fill('148'); await page.locator('[name="note"]').fill('系統開始前的執勤印象');
    assert((await page.locator('[data-referee-impact]').textContent()).includes('12 → 13'));
    await page.evaluate(() => {
      const next = structuredClone(fixture.snapshots.target);
      next.stats.decisions = 260; next.stats.backfillDecisions = 20; next.stats.eventCount = 13;
      next.stats.scales = {64: 11, 96: 4, 128: 2}; next.stats.milestones[100] = 2;
      next.backfills = [{id: 'backfill-1', kind:'event',sourceKey:'historical:fixture-event',basis:'fixture verified experience',recognitionValid:true,revision: 1, decisions: 0, events: 1, size: 148, precision: 'exact', period: '系統開始記錄前', note: '系統開始前的執勤印象', status: 'active', updatedBy: 'admin', updatedAt: 1760000000000, history: []}];
      fixture.nextMutation = next; fixture.holdMutation = true;
    });
    await page.locator('[data-referee-form="backfill"] button[type="submit"]').click();
    assert((await page.locator('.rl-admin-totals').textContent()).includes('240'));
    assert.equal(await page.evaluate(() => fixture.calls.at(-1).action), 'saveBackfill');
    assert.notEqual(await page.locator('[data-referee-form="backfill"] fieldset').getAttribute('disabled'), null);
    assert.equal(await page.locator('[name="decisions"]').isDisabled(), true);
    await page.evaluate(() => fixture.release());
    await page.waitForFunction(() => document.querySelector('.rl-admin-totals')?.textContent.includes('260'));
    await page.locator('[data-action="referee-license-edit"]').click();
    await page.locator('[name="events"]').fill('1'); await page.locator('[name="precision"]').selectOption('unknown');
    assert.equal(await page.locator('[name="size"]').isDisabled(), true);
    await page.evaluate(() => {
      const next = structuredClone(fixture.snapshots.target); next.stats.eventCount = 15; next.stats.unknownScaleEvents = 3;
      next.stats.scales = {64: 10, 96: 3, 128: 1}; next.stats.milestones[100] = 1;
      Object.assign(next.backfills[0], {events: 1, size: null, precision: 'unknown', revision: 2}); fixture.nextMutation = next;
    });
    await page.locator('[data-referee-form="backfill"] button[type="submit"]').click();
    await page.waitForFunction(() => document.querySelector('.rl-admin-totals')?.textContent.includes('15'));
    const edit = await page.evaluate(() => fixture.calls.filter(p => p.action === 'saveBackfill').at(-1));
    assert.equal(edit.entry.id, 'backfill-1'); assert.equal(edit.entry.size, null); assert.equal(edit.entry.precision, 'unknown');
    assert.equal(await page.locator('.rl-backfill').count(), 1);
    await page.evaluate(() => {const next = structuredClone(fixture.snapshots.target); next.stats.decisions = 240; next.stats.eventCount = 12; next.stats.unknownScaleEvents = 0; next.backfills[0].status = 'revoked'; fixture.nextMutation = next;});
    await page.locator('[data-action="referee-license-revoke"]').click(); await page.locator('[data-action="referee-license-restore"]').waitFor();
    await page.evaluate(() => {const next = structuredClone(fixture.snapshots.target); next.stats.decisions = 260; next.stats.eventCount = 15; next.stats.unknownScaleEvents = 3; next.backfills[0].status = 'active'; fixture.nextMutation = next;});
    await page.locator('[data-action="referee-license-restore"]').click(); await page.locator('[data-action="referee-license-revoke"]').waitFor();
    for (const width of [320, 390, 768]) {await page.setViewportSize({width, height: 900}); await page.evaluate(() => document.querySelectorAll('details').forEach(el => {el.open = true;})); await noOverflow('admin ' + width);}
    await page.setViewportSize({width: 320, height: 900}); await page.emulateMedia({colorScheme: 'dark'});
    await page.evaluate(() => document.querySelectorAll('details').forEach(el => {el.open = false;}));
    await page.screenshot({path: '/tmp/bxh-referee-production-admin-320.png', fullPage: true});
    await page.locator('[data-action="referee-license-select"][data-uid="pending"]').click();
    await page.locator('[data-action="referee-license-grant"]').waitFor();
    assert.equal(await page.locator('[data-action="referee-license-grant"]').isDisabled(), true);
    assert.equal(await page.locator('[data-action="referee-license-chief"]').isDisabled(), false, 'incomplete must not block chief management');
    await page.locator('[data-action="referee-license-select"][data-uid="zero"]').click();
    await page.getByText('裁判長指定', {exact: true}).click();
    await page.getByRole('button', {name: '指定為唯一裁判長', exact: true}).click();
    await page.getByText('裁判長已指定，裁判證尚未發行。', {exact: true}).waitFor({state: 'attached'});
    await page.getByText('裁判長指定', {exact: true}).click();
    await page.getByRole('button', {name: '解除裁判長指定', exact: true}).click();
    await page.waitForFunction(() => fixture.snapshots.zero.isChief === false);
    assert.deepEqual(errors, []);
    console.log('PASS referee license: 320/390/768 light/dark layout, host navigation, excluded records, owner JPEG preview/save/conflict/remove, server-owned backfill add/edit/revoke/restore, incomplete grant and chief without certificate');
  } finally {await browser.close();}
})().catch(error => {console.error(error); process.exitCode = 1;});
