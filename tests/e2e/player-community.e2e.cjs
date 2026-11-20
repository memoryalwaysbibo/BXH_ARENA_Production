const { test, expect } = require('@playwright/test');
const crypto = require('node:crypto');

test.use({ serviceWorkers: 'block' });

// Browser E2E: use the Web Firestore transport and its actual metadata events.
// A single signed-in synthetic player is deliberately not the fixture owner,
// so the unaffected owner/admin lifecycle-repair fallback is not suppressed.
async function confirmSameContentLobbyWatch(page, request, run) {
  const project = 'demo-bxh-arena-e2e';
  const code = 'R1-WATCH-' + run.toUpperCase();
  const fixture = 'http://127.0.0.1:8080/v1/projects/' + project + '/databases/(default)/documents/publicTournaments/' + code;
  const write = async (fields, params = undefined) => {
    const r = await request.patch(fixture, {
      headers: { Authorization: 'Bearer owner' }, // Firestore Emulator only.
      data: { fields }, params, maxRedirects: 0,
    });
    expect(r.ok(), 'synthetic emulator fixture write: ' + r.status()).toBe(true);
  };
  const runId = 'R1 metadata fixture ' + run;
  const text = stringValue => ({ stringValue });
  const integer = value => ({ integerValue: String(value) });
  const profileTab = page.locator('[data-action="player-switch-tab"][data-tab="profile"]').first();
  const homeTab = page.locator('[data-action="player-switch-tab"][data-tab="home"]').first();
  await expect(profileTab).toBeVisible();
  await profileTab.click();
  await page.evaluate(async expectedProject => {
    const sdk = 'https://www.gstatic.com/firebasejs/10.13.0/';
    const [apps, auth, firestore] = await Promise.all(
      ['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js'].map(name => import(sdk + name))
    );
    const app = apps.getApp();
    if (app.options.projectId !== expectedProject || location.hostname !== '127.0.0.1' ||
        !auth.getAuth(app).currentUser || !window.cloudSync?.subscribePublicTournaments) {
      throw new Error('expected signed-in isolated Firebase Web SDK');
    }
    const db = firestore.getFirestore(app);
    const cloud = window.cloudSync;
    const subscribe = cloud.subscribePublicTournaments;
    const capture = [];
    // Observe the real application callback. Never manufacture metadata flags
    // or replace the query; disable/enableNetwork uses this same app/SDK.
    cloud.subscribePublicTournaments = function(callback) {
      return subscribe.call(this, result => {
        callback(result);
        capture.push({
          ok: result.ok, fromCache: result.fromCache, hasPendingWrites: result.hasPendingWrites,
          requiresLifecycleReconcile: result.requiresLifecycleReconcile,
          items: (result.items || []).map(row => [row.code, row.confirmedCount]),
          skip: shouldSkipLobbyIdlePoll(), hasFallback: publicTournamentsReconcileTimer !== null
        });
      });
    };
    window.__r1WatchWebE2E = { capture,
      offline: () => firestore.disableNetwork(db), online: () => firestore.enableNetwork(db),
      restore: () => { cloud.subscribePublicTournaments = subscribe; },
    };
  }, project);
  try {
    await write({
      visibility: text('public'), eventAuthority: text('official'), ownerUid: text('fixture-not-test-viewer'),
      name: text(runId), publishedAt: integer(Date.now()), tournamentPhase: text('waiting'),
      registrationVisibility: text('public'), registrationStatus: text('open'), registrationEnabled: {booleanValue:true},
      registrationOpenAt: integer(Date.now() - 3600000), registrationCloseAt: integer(Date.now() + 3600000),
      capacity: integer(16), confirmedCount: integer(1),
      bracketView: text(JSON.stringify({meta:{name:runId,eventAuthority:'official'},players:[],matches:[],archiveStatus:'ongoing'})),
    });
    await homeTab.click();
    const card = page.locator('[data-lobby-code="' + code + '"]');
    await expect(card).toBeAttached();
    const snapshot = (mode, after = -1, n = 1) => page.waitForFunction(({code, mode, after, n}) => {
      const hit = window.__r1WatchWebE2E.capture.findIndex((x, index) =>
        index > after && x.ok === true && x.hasPendingWrites === false &&
        x.items.some(([id,count]) => id === code && count === n) &&
        (mode === 'cache' ? x.fromCache === true && !x.skip && x.hasFallback :
          x.fromCache === false && x.requiresLifecycleReconcile === false && x.skip && !x.hasFallback));
      return hit >= 0 ? hit + 1 : false;
    }, { code, mode, after, n }, { timeout: 15000 });
    const index = async (mode, after, n) => Number(await (await snapshot(mode, after, n)).jsonValue()) - 1;
    const server0 = await index('server', -1, 1);
    await page.evaluate(() => window.__r1WatchWebE2E.offline());
    const cache = await index('cache', server0, 1);
    await page.evaluate(() => window.__r1WatchWebE2E.online());
    const server1 = await index('server', cache, 1);
    expect(await page.evaluate(({cache,server1}) => {
      const snapshots = window.__r1WatchWebE2E.capture;
      return JSON.stringify(snapshots[cache].items) === JSON.stringify(snapshots[server1].items);
    }, {cache,server1})).toBe(true);
    await write({ confirmedCount: integer(2) }, { 'updateMask.fieldPaths': 'confirmedCount' });
    await index('server', server1, 2);
    await expect(card).toContainText('2 / 16', { useInnerText: false });
  } finally {
    await page.evaluate(async () => {
      const v = window.__r1WatchWebE2E;
      if (v) { v.restore(); await v.online(); delete window.__r1WatchWebE2E; }
    });
    const r = await request.delete(fixture, { headers: { Authorization: 'Bearer owner' }, maxRedirects: 0 });
    expect(r.ok(), 'synthetic emulator fixture cleanup: ' + r.status()).toBe(true);
  }
}


test('player can create account and open a community room on isolated emulators', async ({ page, request }) => {
  test.setTimeout(150000);
  const externalFirebaseRequests = [];

  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    const host = url.hostname;
    const isExternalFirebase =
      host === 'firestore.googleapis.com' ||
      host === 'identitytoolkit.googleapis.com' ||
      host === 'securetoken.googleapis.com' ||
      host === 'firebaseappcheck.googleapis.com' ||
      host === 'firebasestorage.googleapis.com' ||
      host.endsWith('.firebaseio.com') ||
      host.endsWith('.cloudfunctions.net');

    if (isExternalFirebase) {
      externalFirebaseRequests.push(url.toString());
      await route.abort('blockedbyclient');
      return;
    }
    const emulatorOrApp = url.protocol === 'http:' && host === '127.0.0.1' &&
      ['4173', '8080', '9099', '5001'].includes(url.port);
    const pinnedSdk = url.protocol === 'https:' && host === 'www.gstatic.com' &&
      url.pathname.startsWith('/firebasejs/10.13.0/');
    if (!(emulatorOrApp || pinnedSdk)) return route.abort('blockedbyclient');
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
  // Complete cold cloud initialization before entering data; its render can
  // replace the signup form. Preserve all signup and emulator assertions.
  await page.waitForFunction(
    () => window.cloudAuth && typeof window.cloudAuth.isReady === 'function' && window.cloudAuth.isReady(),
    null,
    { timeout: 90000 }
  );
  await page.locator('#apply-realname').fill('BOT 測試玩家');
  await page.locator('#apply-email').fill(email);
  await page.locator('#apply-password').fill(secret);
  await page.locator('#apply-password2').fill(secret);
  await page.locator('#apply-nickname').fill('BOT-E2E');
  await page.locator('#apply-phone').fill('0900000000');
  await page.locator('#apply-agree').check();


  await page.locator('[data-action="player-apply-submit"]').click();

  await expect(page.locator('.player-shell')).toBeVisible({ timeout: 30000 });
  await test.step('cached lobby Watch becomes authoritative without changing rows', () => confirmSameContentLobbyWatch(page, request, run));
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
  const code = notice.match(/BXH-[A-Z0-9]{6}/)?.[0];
  expect(code).toBeTruthy();

  // Fail the first room read, then use the real Firestore query. Keep the
  // optional history pending to verify it does not hold up the room list.
  await page.evaluate(() => {
    const cloud = window.cloudSync;
    const readRooms = cloud.queryMyCommunityEvents.bind(cloud);
    const readHistory = cloud.queryMyCommunityHistory.bind(cloud);
    let roomAttempts = 0;
    cloud.queryMyCommunityEvents = async () => {
      if (++roomAttempts === 1) throw Object.assign(new Error('temporary test outage'), { code: 'unavailable' });
      return readRooms();
    };
    cloud.queryMyCommunityHistory = () => new Promise(resolve => {
      window.releaseRoomHistoryForTest = () => resolve(readHistory());
    });
  });
  await page.locator('[data-action="community-exit-room"]').click();
  await expect(page.locator(`[data-action="community-open-room"][data-code="${code}"]`)).toBeAttached();
  const historyBadge = page.locator('[data-fold-key="host-history"] summary .badge');
  await expect(historyBadge).toHaveText('…');
  await page.evaluate(() => window.releaseRoomHistoryForTest());
  await expect(historyBadge).toHaveText('0');

  expect(externalFirebaseRequests).toEqual([]);
});
