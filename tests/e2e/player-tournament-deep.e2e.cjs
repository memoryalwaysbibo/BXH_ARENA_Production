const { test, expect } = require('@playwright/test');
const crypto = require('node:crypto');

test('four-player community event reaches first confirmed referee result', async ({ page }) => {
  const externalFirebaseRequests = [];

  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    const host = url.hostname;
    const blocked =
      host === 'firestore.googleapis.com' ||
      host === 'identitytoolkit.googleapis.com' ||
      host === 'securetoken.googleapis.com' ||
      host.endsWith('.firebaseio.com') ||
      host.endsWith('.cloudfunctions.net');
    if (blocked) {
      externalFirebaseRequests.push(url.toString());
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });

  const run = Date.now().toString(36);
  const email = `deep.${run}@bxh-e2e.test`;
  const secret = crypto.randomUUID().replaceAll('-', '') + 'A9!';

  const response = await page.goto('/?bxh_e2e=1', { waitUntil: 'domcontentloaded' });
  expect(response?.headers()['x-bxh-e2e-emulator']).toBe('1');

  await page.locator('[data-action="select-role-player"]').click();
  await page.locator('[data-action="player-goto-apply"]').click();
  await page.locator('#apply-realname').fill('BOT 深度測試');
  await page.locator('#apply-email').fill(email);
  await page.locator('#apply-password').fill(secret);
  await page.locator('#apply-password2').fill(secret);
  await page.locator('#apply-nickname').fill('BOT-DEEP');
  await page.locator('#apply-phone').fill('0900000000');
  await page.locator('#apply-agree').check();

  await page.waitForFunction(
    () => window.cloudAuth && typeof window.cloudAuth.isReady === 'function' && window.cloudAuth.isReady(),
    null,
    { timeout: 90000 }
  );
  await page.locator('[data-action="player-apply-submit"]').click();

  await expect(page.locator('.player-shell')).toBeVisible({ timeout: 30000 });
  await page.locator('[data-action="player-switch-tab"][data-tab="host"]').first().click();
  await expect(page.locator('.community-host-hero')).toBeVisible();

  await page.locator('[data-action="community-create-open"]').click();
  await page.locator('#community-format').selectOption('single');
  await page.locator('[data-action="community-create-submit"]').click();
  await expect(page.locator('.community-room-notice')).toBeVisible({ timeout: 30000 });

  await page.locator('[data-action="people-section"][data-section="tools"]').click();
  await expect(page.getByText('現場新增選手', { exact: true })).toBeVisible();
  await page.locator('#quick-add-textarea').fill('BOT Alpha\nBOT Beta\nBOT Gamma');
  await page.locator('[data-action="quick-add-players"]').click();

  await page.locator('[data-action="people-section"][data-section="confirmed"]').click();
  await expect(page.getByText('BOT Alpha（現場）', { exact: true })).toBeVisible();
  await expect(page.getByText('BOT Beta（現場）', { exact: true })).toBeVisible();
  await expect(page.getByText('BOT Gamma（現場）', { exact: true })).toBeVisible();
  await expect(page.locator('.people-roster-table .people-col-name')).toHaveCount(4);

  await page.locator('[data-action="people-section"][data-section="bracket"]').click();
  const draw = page.locator('[data-action="draw-bracket"]');
  await expect(draw).toBeEnabled();
  await draw.click();

  const start = page.locator('[data-action="start-tournament"]');
  await expect(start).toBeVisible({ timeout: 20000 });
  await start.click();

  const modalConfirm = page.locator('[data-action="modal-confirm"]');
  await expect(modalConfirm).toBeVisible({ timeout: 20000 });
  await modalConfirm.click();

  await page.locator('[data-action="community-switch-room-tab"][data-tab="referee"]').click();

  const extremeA = page.locator('[data-action="score"][data-side="A"][data-type="extreme"]:not([disabled])').first();
  await expect(extremeA).toBeVisible({ timeout: 30000 });
  await extremeA.click();

  // Scoring is authoritative through a Firestore transaction. The remote
  // snapshot intentionally re-renders the referee desk, so wait for that
  // transaction to settle before locating the next scoring control.
  await page.waitForFunction(() => {
    const scores = [...document.querySelectorAll('.side-score')].map(x => x.textContent.trim());
    return scores.includes('3');
  }, null, { timeout: 20000 });
  await page.evaluate(async () => {
    if (typeof flushStationMatchMutations === 'function') await flushStationMatchMutations();
  });

  const spinA = page.locator('[data-action="score"][data-side="A"][data-type="spin"]:not([disabled])').first();
  await expect(spinA).toBeVisible({ timeout: 20000 });
  await spinA.click({ force: true });

  await expect(page.locator('[data-action="modal-confirm"]')).toBeVisible({ timeout: 15000 });
  await page.locator('[data-action="modal-confirm"]').click();

  await expect(page.locator('.ref-previous-correction')).toBeVisible({ timeout: 30000 });
  expect(externalFirebaseRequests).toEqual([]);
});
