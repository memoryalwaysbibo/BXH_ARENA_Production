const { test, expect } = require('@playwright/test');

const blockedBackendHosts = [
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'fcmregistrations.googleapis.com',
  'firebaseremoteconfig.googleapis.com',
];

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    const host = url.hostname;
    const blocked =
      blockedBackendHosts.includes(host) ||
      host.endsWith('.firebaseio.com') ||
      host.endsWith('.googleapis.com');

    if (blocked) {
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
});

test('ARENA shell renders and stays inside viewport', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('body')).toBeVisible();
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('.landing-role-cards')).toBeVisible();
  await expect(page.locator('.role-card-player')).toBeVisible();

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

test('main entrance cards exist in isolated rendered layout', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('.landing-role-cards')).toHaveCount(1);
  await expect(page.locator('.role-card-admin')).toHaveCount(1);
  await expect(page.locator('.role-card-player')).toHaveCount(1);
  await expect(page.locator('.role-card-guest')).toHaveCount(1);
});
