'use strict';
// Synthetic browser QA only. No site, real Firebase, screenshots, or remote calls.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(require.resolve('playwright', { paths: [process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || '.'] }));
(async () => {
  let browser;
  try {
    browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.abort());
    await page.setContent('<!doctype html><meta charset="utf-8"><body style="margin:0;background:#111;color:#fff"><main id="app"></main></body>');
    await page.addStyleTag({ path: path.join(__dirname, 'view.css') });
    await page.addScriptTag({ path: path.join(__dirname, 'view.js') });
    await page.addScriptTag({ path: path.join(__dirname, 'integration.js') });
    await page.evaluate(() => {
      window.session = { uid: 'synthetic-user', epoch: 1 }; window.calls = [];
      const players = [{ id: 'own', name: '<img src=x onerror="window.bad=true">' }, { id: 'other', name: 'Synthetic opponent' }];
      const match = { id: 'm1', round: 0, indexInRound: 0, bracket: 'SE', a: { playerId: 'own' }, b: { playerId: 'other' }, scoreA: 4, scoreB: 2, completed: true, winnerId: 'own', loserId: 'other' };
      window.response = { parent: { code: 'BXH-AUDPAR', name: 'Synthetic browser audit' }, ownPlayerIds: ['own'], ownMatches: [{ stageKey: 'A', ...match }], placements: [{ playerId: 'own', placement: 1 }], needsReview: false,
        stages: ['A','B','C','D','runners-up','champions'].map(key => ({ key, status: key === 'B' ? 'unpublished' : 'completed', players, matches: key === 'champions' ? [match, { ...match, id: 'bronze', bracket: 'BZ' }] : [match], needsReview: false })) };
      window.mount = (mode='preview', request=async payload => { calls.push(payload); return structuredClone(response); }, scope='one') => {
        document.getElementById('app').innerHTML = BXHGroupHistoryView.slot(mode === 'own' ? '' : 'BXH-AUDPAR', mode, mode !== 'own');
        BXHGroupHistory.bind(document.getElementById('bxh-group-history'), { getSession:()=>session, scope, request });
      };
      mount();
    });
    await page.getByRole('tab', { name: 'A 組 已完成', exact: true }).waitFor();
    assert.equal(await page.locator('#app img').count(), 0);
    assert.equal(await page.evaluate(() => !!window.bad), false);
    assert((await page.locator('#group-history-tree-panel').innerText()).includes('<img'));
    assert.equal(await page.getByRole('tab').count(), 6);
    await page.getByRole('tab', { name: 'B 組 尚未公布', exact: true }).click();
    assert.equal(await page.locator('.group-history-match').count(), 0);
    await page.getByRole('tab', { name: '第 1～4 名 已完成', exact: true }).click();
    assert.equal(await page.getByRole('heading', { name: '季軍賽', exact: true }).count(), 1);
    await page.keyboard.press('Home');
    assert.equal(await page.getByRole('tab', { name: 'A 組 已完成', exact: true }).getAttribute('aria-selected'), 'true');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    console.log('PASS: six tabs, unpublished privacy, BZ labels, XSS escaping, keyboard, mobile width');

    await page.evaluate(() => { response.stages[0].needsReview = true; response.stages[0].status = 'needs-review'; response.needsReview = true; BXHGroupHistory.resetSession(); mount(); });
    await page.getByText('已回收賽果與目前資料尚待核對，暫不顯示對戰結果及名次。').waitFor();
    assert.equal(await page.locator('.group-history-match').count(), 0);
    console.log('PASS: disputed stage does not render stale tree');

    await page.evaluate(() => { BXHGroupHistory.resetSession(); response.stages[0].needsReview = false; response.stages[0].status = 'completed'; response.needsReview = false; mount('preview', payload => { calls.push(payload); return new Promise(resolve => window.finishOld = resolve); }); });
    await page.waitForFunction(() => !!window.finishOld);
    await page.evaluate(() => { BXHGroupHistory.suspendSession(session.uid, session.epoch); mount(); finishOld(response); });
    await page.waitForTimeout(30);
    assert.equal(await page.locator('#bxh-group-history').innerHTML(), '');
    console.log('PASS: pending logout response and same-session rerender cannot resurrect data');

    await page.evaluate(() => { session = { uid: 'new-user', epoch: 2 }; mount('preview', payload => new Promise(resolve => window.finishNav = resolve)); });
    await page.waitForFunction(() => !!window.finishNav);
    await page.evaluate(() => { mount('preview', async () => ({ ...response, parent: { ...response.parent, name: 'Current navigation' } }), 'two'); });
    await page.getByRole('heading', { name: 'Current navigation', exact: true }).waitFor();
    await page.evaluate(() => finishNav({ ...response, parent: { ...response.parent, name: 'STALE NAVIGATION' } }));
    await page.waitForTimeout(30);
    assert.equal(await page.getByText('STALE NAVIGATION').count(), 0);
    console.log('PASS: old navigation cannot overwrite replacement node');
    assert.deepEqual(errors, []);
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
  finally { await browser?.close(); }
})();
