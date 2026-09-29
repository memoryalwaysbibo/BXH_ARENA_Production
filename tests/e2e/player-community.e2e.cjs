const { test, expect } = require('@playwright/test');
const crypto = require('node:crypto');

test('player can create account and open a community room on isolated emulators', async ({ page }) => {
  const externalFirebaseRequests = [];

  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    const host = url.hostname;
    const isExternalFirebase =
      host === 'firestore.googleapis.com' ||
      host === 'identitytoolkit.googleapis.com' ||
      host === 'securetoken.googleapis.com' ||
      host.endsWith('.firebaseio.com') ||
      host.endsWith('.cloudfunctions.net');

    if (isExternalFirebase) {
      externalFirebaseRequests.push(url.toString());
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });

  const run = Date.now().toString(36);
  const email = `bot.${run}@bxh-e2e.test`;
  const secret = crypto.randomUUID().replaceAll('-', '') + 'A9!';

  const response = await page.goto('/?bxh_e2e=1', { waitUntil: 'domcontentloaded' });
  expect(response?.headers()['x-bxh-e2e-emulator']).toBe('1');

  await expect(page.locator('[data-action="select-role-player"]')).toBeVisible();
  await page.locator('[data-action="select-role-player"]').click();

  await expect(page.locator('[data-action="player-goto-apply"]')).toBeVisible();
  await page.locator('[data-action="player-goto-apply"]').click();

  await expect(page.getByText('申請玩家帳號', { exact: true })).toBeVisible();
  await page.locator('#apply-realname').fill('BOT 測試玩家');
  await page.locator('#apply-email').fill(email);
  await page.locator('#apply-password').fill(secret);
  await page.locator('#apply-password2').fill(secret);
  await page.locator('#apply-nickname').fill('BOT-E2E');
  await page.locator('#apply-phone').fill('0900000000');
  await page.locator('#apply-agree').check();

  // Cold CI starts must wait for the Firebase SDK and emulator connections.
  // A real user naturally spends time filling the form; the bot can otherwise
  // reach submit before cloudAuth is ready and correctly receive "尚未連線".
  await page.waitForFunction(
    () => window.cloudAuth && typeof window.cloudAuth.isReady === 'function' && window.cloudAuth.isReady(),
    null,
    { timeout: 90000 }
  );
  await page.locator('[data-action="player-apply-submit"]').click();

  await expect(page.locator('.player-shell')).toBeVisible({ timeout: 30000 });
  const hostTab = page.locator('[data-action="player-switch-tab"][data-tab="host"]').first();
  await expect(hostTab).toBeVisible();

  await hostTab.click();
  await expect(page.locator('.community-host-hero')).toBeVisible({ timeout: 20000 });

  await page.locator('[data-action="community-create-open"]').click();
  await expect(page.getByText('快速開房', { exact: true })).toBeVisible();
  await page.locator('#community-format').selectOption('single');
  await page.locator('[data-action="community-create-submit"]').click();

  await expect(page.locator('.community-room-notice')).toBeVisible({ timeout: 30000 });
  const notice = await page.locator('.community-room-notice').innerText();
  expect(notice).toMatch(/BXH-[A-Z0-9]{6}/);

  // Build a four-player field through the same UI used on site.
  await page.locator('[data-action="people-section"][data-section="tools"]').click();
  await expect(page.getByText('現場新增選手', { exact: true })).toBeVisible();
  await page.locator('#quick-add-textarea').fill('BOT Alpha\\nBOT Beta\\nBOT Gamma');
  await page.locator('[data-action="quick-add-players"]').click();

  await page.locator('[data-action="people-section"][data-section="confirmed"]').click();
  await expect(page.getByText('BOT Alpha', { exact: true })).toBeVisible();
  await expect(page.getByText('BOT Beta', { exact: true })).toBeVisible();
  await expect(page.getByText('BOT Gamma', { exact: true })).toBeVisible();

  // Draw the bracket and lock the roster by starting the tournament.
  await page.locator('[data-action="people-section"][data-section="bracket"]').click();
  const drawButton = page.locator('[data-action="draw-bracket"]');
  await expect(drawButton).toBeEnabled();
  await drawButton.click();
  await expect(page.locator('[data-action="start-tournament"]')).toBeVisible({ timeout: 15000 });
  await page.locator('[data-action="start-tournament"]').click();
  await expect(page.locator('[data-action="modal-confirm"]')).toBeVisible({ timeout: 15000 });
  await page.locator('[data-action="modal-confirm"]').click();

  // Community rooms keep their own tab state, so enter the referee desk explicitly.
  await page.locator('[data-action="community-switch-room-tab"][data-tab="referee"]').click();
  const extremeA = page.locator('[data-action="score"][data-side="A"][data-type="extreme"]').first();
  const spinA = page.locator('[data-action="score"][data-side="A"][data-type="spin"]').first();
  await expect(extremeA).toBeEnabled({ timeout: 20000 });

  // Standard scoring: Extreme 3 + Spin 1 reaches the four-point win threshold.
  await extremeA.click();
  await spinA.click();
  const confirmResult = page.locator('[data-action="confirm-result"]').first();
  await expect(confirmResult).toBeEnabled();
  await confirmResult.click();
  await expect(page.locator('[data-action="modal-confirm"]')).toBeVisible();
  await page.locator('[data-action="modal-confirm"]').click();

  // A successful cloud-guard transaction advances the station and exposes
  // correction controls for the just-completed match.
  await expect(page.locator('.ref-previous-correction')).toBeVisible({ timeout: 30000 });

  expect(externalFirebaseRequests).toEqual([]);
});
