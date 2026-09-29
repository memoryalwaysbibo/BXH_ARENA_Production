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
  await page.locator('[data-action="player-apply-submit"]').click();

  await expect(page.locator('.player-shell')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('[data-action="player-switch-tab"][data-tab="host"]')).toBeVisible();

  await page.locator('[data-action="player-switch-tab"][data-tab="host"]').click();
  await expect(page.locator('.community-host-hero')).toBeVisible({ timeout: 20000 });

  await page.locator('[data-action="community-create-open"]').click();
  await expect(page.getByText('快速開房', { exact: true })).toBeVisible();
  await page.locator('#community-format').selectOption('single');
  await page.locator('[data-action="community-create-submit"]').click();

  await expect(page.locator('.community-room-notice')).toBeVisible({ timeout: 30000 });
  const notice = await page.locator('.community-room-notice').innerText();
  expect(notice).toMatch(/BXH-[A-Z0-9]{6}/);
  expect(externalFirebaseRequests).toEqual([]);
});
