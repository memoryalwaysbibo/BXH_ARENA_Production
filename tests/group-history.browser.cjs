'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { chromium } = require(require.resolve('playwright', { paths: [process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || '.'] }));
test('six-tree and own-history browser flow: repeated clicks, replacement, logout, navigation and bounded discovery', async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.BXH_TEST_BROWSER || '/usr/bin/chromium' });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.abort());
    await page.setContent('<html lang="zh-Hant"><style>body{margin:0;background:#161820;color:#eee;font:14px sans-serif}.panel{padding:16px;box-sizing:border-box}.btn{padding:10px;color:inherit;background:#292e35;border:1px solid #555;border-radius:8px}input{font:inherit}</style><main id="app"></main></html>');
    await page.addStyleTag({ content: fs.readFileSync('group-history/view.css', 'utf8') });
    for (const file of ['view.js', 'integration.js']) await page.addScriptTag({ content: fs.readFileSync('group-history/' + file, 'utf8') });
    await page.evaluate(() => {
      window.session = { uid: 'self-account', epoch: 1 }; window.pending = []; window.calls = []; window.mineCalls = [];
      window.response = code => ({ parent: { code, name: '合成分組賽' }, stages: BXHGroupHistoryView.keys.map(key => ({ key, status: key === 'B' ? 'unpublished' : 'completed', players: [{ id: 'self', name: key === 'B' ? '秘密尚未公布' : '同名選手' }, { id: 'opponent', name: '同名選手' }], matches: [{ id: key + '1', bracket: 'SE', round: 0, indexInRound: 0, a: { playerId: 'self' }, b: { playerId: 'opponent' }, scoreA: 4, scoreB: 2, winnerId: 'self', loserId: 'opponent', completed: true }] })), ownPlayerIds: ['self'], ownMatches: [{ stageKey: 'A', round: 0, a: { playerId: 'self' }, b: { playerId: 'opponent' }, scoreA: 4, scoreB: 2, winnerId: 'self', loserId: 'opponent', completed: true }], placements: [{ playerId: 'self', placement: 2, points: null }] });
      window.request = payload => { calls.push(payload); return new Promise(resolve => pending.push(resolve)); };
      window.mine = payload => { mineCalls.push(payload); return Promise.resolve({ rows: [{ status: 'confirmed', userUid: 'not-used' }] }); };
      window.bind = () => BXHGroupHistory.bind(document.getElementById('bxh-group-history'), { getSession: () => session, scope: window.scope || 'bracket', request, mine, parentCodes: Array.from({ length: 20 }, (_, i) => 'BXH-' + String(i).padStart(6, '0')) });
      window.mount = (mode = 'preview', code = 'BXH-ABC123') => { document.getElementById('app').innerHTML = BXHGroupHistoryView.slot(code, mode, mode !== 'own'); bind(); };
      window.finish = (index, code = 'BXH-ABC123') => pending[index](response(code));
      mount();
    });
    await page.waitForFunction(() => calls.length === 1);
    await page.evaluate(() => { bind(); bind(); document.querySelector('[data-group-history-action="refresh"]').click(); });
    assert.equal(await page.evaluate(() => calls.length), 1);
    await page.evaluate(() => finish(0)); await page.locator('.group-history-tree').waitFor();
    assert.equal(await page.locator('[role="tab"]').count(), 6); assert.equal(await page.locator('[role="tabpanel"]').count(), 1);
    for (const key of ['A', 'B', 'C', 'D', 'runners-up', 'champions']) {
      await page.locator('[data-group-history-stage="' + key + '"]').click();
      assert.equal(await page.locator('[role="tabpanel"]').count(), 1);
      assert.equal(await page.locator('.group-history-tree').count(), key === 'B' ? 0 : 1);
      assert.ok(!(await page.locator('#app').textContent()).includes('秘密尚未公布'));
    }
    await page.locator('[data-group-history-stage="champions"]').press('Home');
    assert.equal(await page.locator('[data-group-history-stage="A"]').getAttribute('aria-selected'), 'true');
    for (const width of [320, 390, 768]) { await page.setViewportSize({ width, height: 900 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); }
    // Normal rerender retains completed data/selection but clears detached personal DOM.
    await page.evaluate(() => { window.oldNode = document.getElementById('bxh-group-history'); mount(); });
    assert.equal(await page.evaluate(() => calls.length), 1); assert.equal(await page.evaluate(() => oldNode.innerHTML), '');
    // Same-session node replacement invalidates the first pending response, never retargets it.
    await page.locator('[data-group-history-action="refresh"]').click();
    await page.waitForFunction(() => calls.length === 2);
    await page.evaluate(() => mount()); await page.waitForFunction(() => calls.length === 3);
    await page.evaluate(() => finish(1)); assert.equal(await page.locator('.group-history-tree').count(), 0);
    await page.evaluate(() => finish(2)); await page.locator('.group-history-tree').waitFor();
    // Logout initiation wipes DOM and prevents a same-session rerender even before auth callback.
    await page.locator('[data-group-history-action="refresh"]').click(); await page.waitForFunction(() => calls.length === 4);
    await page.evaluate(() => { BXHGroupHistory.suspendSession(session.uid, session.epoch); bind(); finish(3); });
    assert.equal(await page.locator('#bxh-group-history').textContent(), '');
    await page.evaluate(() => { session = { uid: 'self-account', epoch: 2 }; mount(); }); await page.waitForFunction(() => calls.length === 5);
    // Navigation away with pending read never repopulates old or new DOM.
    await page.evaluate(() => { window.departed = document.getElementById('bxh-group-history'); BXHGroupHistory.bind(null); document.getElementById('app').innerHTML = '<p>其他頁</p>'; finish(4); });
    assert.equal(await page.locator('#app').textContent(), '其他頁'); assert.equal(await page.evaluate(() => departed.innerHTML), '');
    // Own history is a separate career slot, no name-based identity matching.
    await page.evaluate(() => { window.scope = 'career'; mount('own', ''); });
    await page.locator('input[name="parentCode"]').fill('bxh-abc123');
    await page.locator('[data-group-history-search]').evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
    await page.waitForFunction(() => calls.length === 6);
    await page.evaluate(() => finish(5)); await page.locator('.group-history-own').waitFor();
    assert.equal(await page.locator('.group-history-own').count(), 1);
    assert.ok((await page.locator('#app').textContent()).includes('第 2 名'));
    assert.ok((await page.locator('#app').textContent()).includes('積分尚未核對入帳'));
    // Discovery is explicit and bounded, no broad collection or raw identity request.
    await page.locator('[data-group-history-action="discover"]').click();
    await page.waitForFunction(() => mineCalls.length === 8 && !document.querySelector('[data-group-history-action="discover"]').disabled);
    assert.equal(await page.locator('[data-group-history-code]').count(), 8);
    assert.equal(await page.evaluate(() => calls.every(call => Object.keys(call).sort().join(',') === 'action,parentCode' && call.action === 'history')), true);
    // Account change while reading clears any own results; old callback cannot return them.
    await page.locator('[data-group-history-action="refresh"]').click(); await page.waitForFunction(() => calls.length === 7);
    await page.evaluate(() => { session = { uid: 'other-account', epoch: 3 }; BXHGroupHistory.resetSession(); mount('own', ''); finish(6); });
    assert.equal(await page.locator('.group-history-own').count(), 0);
    assert.ok(!(await page.locator('#app').textContent()).includes('同名選手'));
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
