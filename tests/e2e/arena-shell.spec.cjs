const { test, expect } = require('@playwright/test');

test('ARENA shell renders and stays inside viewport', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('body')).toBeVisible();
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('header.topbar')).toBeVisible();
  await expect(page.getByText('BXH ARENA', { exact: false }).first()).toBeVisible();

  const metrics = await page.evaluate(() => ({
    bodyScrollWidth: document.body.scrollWidth,
    docScrollWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    viewportHeight: document.documentElement.clientHeight,
    title: document.title,
  }));

  expect(metrics.title).toContain('BXH ARENA');
  expect(Math.max(metrics.bodyScrollWidth, metrics.docScrollWidth)).toBeLessThanOrEqual(metrics.viewportWidth + 4);
});

test('production identity markers are present in rendered document', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const env = await page.locator('meta[name="bxh-environment"]').getAttribute('content');
  const build = await page.locator('meta[name="bxh-build"]').getAttribute('content');

  expect(env).toBe('production');
  expect(build).toBeTruthy();
});

test('main entrance cards exist in source layout', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const cards = page.locator('.landing-role-cards');
  await expect(cards).toHaveCount(1);

  await expect(page.locator('.role-card-admin')).toHaveCount(1);
  await expect(page.locator('.role-card-player')).toHaveCount(1);
  await expect(page.locator('.role-card-guest')).toHaveCount(1);
});
