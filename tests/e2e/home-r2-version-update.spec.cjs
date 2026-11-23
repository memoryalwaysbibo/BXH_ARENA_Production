'use strict';

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

test.use({ serviceWorkers: 'block' });

test('Home R2 prerequisite: an open tab offers a new build and keeps its room after explicit update', async ({ page }) => {
  const read = name => fs.readFileSync(path.join(__dirname, '..', '..', name), 'utf8');
  const html = read('index.html');
  const guards = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1]).filter(body => body.includes('(function bxhFreshVersionGuard(){'));
  expect(guards).toHaveLength(1);
  const guard = guards[0];
  const current = JSON.parse(read('version.json')).build;
  const next = current + '-r2-browser-fixture';
  const marker = /var CURRENT_BUILD="([^"]+)";/;
  expect(guard.match(marker)?.[1]).toBe(current);
  expect(html.match(/<meta name="bxh-build" content="([^"]+)"/)?.[1]).toBe(current);

  // Real app updater only; no app scripts, Firestore, live site or production data.
  const origin = 'https://arena-release-test.invalid';
  const roomPath = '/?room=BXH-DEMO&keep=1#lobby';
  const versionPath = '/version.json';
  let advertised = current;
  const navigations = [];
  const isVersion = response => {
    const url = new URL(response.url());
    return url.origin === origin && url.pathname === versionPath && response.status() === 200;
  };
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === versionPath) {
      return route.fulfill({ headers: { 'cache-control': 'no-store' }, json: { build: advertised } });
    }
    if (url.pathname !== '/' || !route.request().isNavigationRequest()) return route.abort();
    navigations.push(url.href);
    const build = url.searchParams.get('bxh_build') === next ? next : current;
    const script = build === current ? guard : guard.replace(marker, 'var CURRENT_BUILD=' + JSON.stringify(build) + ';');
    return route.fulfill({ contentType: 'text/html; charset=utf-8', headers: { 'cache-control': 'no-store' }, body:
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<meta name="fixture-build"><script>' + script + '</script><main>Isolated update fixture</main>' +
      '<script>document.querySelector("[name=fixture-build]").content=' + JSON.stringify(build) + '</script>' });
  });
  const banner = page.locator('#bxh-update-banner');
  const firstResponse = page.waitForResponse(isVersion);
  await page.goto(origin + roomPath);
  expect(await (await firstResponse).json()).toEqual({ build: current });
  await expect(banner).toHaveCount(0);
  expect(navigations).toHaveLength(1);

  advertised = next;
  await expect.poll(async () => {
    await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
    return banner.count();
  }).toBe(1);
  await expect(banner).toBeVisible();
  expect(navigations).toHaveLength(1);
  expect(page.url()).toBe(origin + roomPath);

  const update = banner.getByRole('button', { name: '立即更新', exact: true });
  await expect(banner.locator('button')).toHaveText('立即更新');
  await expect(update).toBeVisible();
  const [, , nextResponse] = await Promise.all([
    update.click(),
    page.waitForURL(url => url.searchParams.get('bxh_build') === next),
    page.waitForResponse(isVersion),
  ]);
  expect(await nextResponse.json()).toEqual({ build: next });
  const after = new URL(page.url());
  expect(after.origin).toBe(origin);
  expect(after.searchParams.get('room')).toBe('BXH-DEMO');
  expect(after.searchParams.get('keep')).toBe('1');
  expect(after.searchParams.get('bxh_force')).toMatch(/^\d+$/);
  expect(after.hash).toBe('#lobby');
  await expect(page.locator('meta[name=fixture-build]')).toHaveAttribute('content', next);
  await expect(banner).toHaveCount(0);
  expect(navigations).toHaveLength(2);
});
