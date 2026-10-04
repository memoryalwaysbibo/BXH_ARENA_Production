const { test, expect } = require('@playwright/test');
const crypto = require('node:crypto');

test('four-player community event reaches first confirmed referee result', async ({ page, browser }) => {
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

  // Account creation and Auth observer routing complete independently. Wait
  // until either the player shell is ready or the apply request has settled.
  await page.waitForFunction(() => {
    if (document.querySelector('.player-shell')) return true;
    const submit = document.querySelector('[data-action="player-apply-submit"]');
    return !!(submit && !submit.disabled);
  }, null, { timeout: 60000 });

  // If account creation succeeded before the observer completed routing, use
  // the normal player login UI to resume the new account deterministically.
  if (!(await page.locator('.player-shell').isVisible().catch(() => false))) {
    if (await page.locator('[data-action="select-role-player"]').isVisible().catch(() => false)) {
      await page.locator('[data-action="select-role-player"]').click();
    }
    if (await page.locator('[data-action="player-goto-login"]').isVisible().catch(() => false)) {
      await page.locator('[data-action="player-goto-login"]').first().click();
    }
    await expect(page.locator('#player-login-email')).toBeVisible({ timeout: 30000 });
    await page.locator('#player-login-email').fill(email);
    await page.locator('#player-login-password').fill(secret);
    await page.locator('[data-action="player-email-signin"]').click();
  }

  await expect(page.locator('.player-shell')).toBeVisible({ timeout: 60000 });
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
  const confirmDraw=page.locator('[data-action="modal-confirm"]');
  if(await confirmDraw.isVisible().catch(()=>false)) await confirmDraw.click();
  await page.waitForFunction(()=>Number(state.bracketSize)>0,null,{timeout:30000});

  const start = page.locator('[data-action="start-tournament"]');
  await expect(start).toBeVisible({ timeout: 30000 });
  await start.click();

  const modalConfirm = page.locator('[data-action="modal-confirm"]');
  await expect(modalConfirm).toBeVisible({ timeout: 20000 });
  await modalConfirm.click();

  await page.evaluate(async () => {
    if (typeof flushCloudStateWrites === 'function') await flushCloudStateWrites();
  });

  // Open the live tournament through the public URL used by "觀看比賽".
  // The fresh browser context proves the entry does not depend on the host
  // account session and cannot remain stuck at watch-connecting.
  const watchCode = await page.evaluate(() => state.cloudCode);
  expect(watchCode).toMatch(/^BXH-[A-Z0-9]{6}$/);

  const watchContext = await browser.newContext();
  const watchPage = await watchContext.newPage();
  const watchExternalFirebaseRequests = [];

  await watchPage.route('**/*', async route => {
    const url = new URL(route.request().url());
    const host = url.hostname;
    const blocked =
      host === 'firestore.googleapis.com' ||
      host === 'identitytoolkit.googleapis.com' ||
      host === 'securetoken.googleapis.com' ||
      host.endsWith('.firebaseio.com') ||
      host.endsWith('.cloudfunctions.net');
    if (blocked) {
      watchExternalFirebaseRequests.push(url.toString());
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });

  const watchOrigin = new URL(page.url()).origin;
  const watchResponse = await watchPage.goto(
    `${watchOrigin}/?bxh_e2e=1&code=${encodeURIComponent(watchCode)}&entry=watch`,
    { waitUntil: 'domcontentloaded' }
  );
  expect(watchResponse?.headers()['x-bxh-e2e-emulator']).toBe('1');

  await watchPage.waitForFunction(
    () => typeof appPhase !== 'undefined' && appPhase !== 'watch-connecting',
    null,
    { timeout: 30000 }
  );
  await expect(watchPage.locator('.live-dashboard-panel')).toBeVisible({ timeout: 30000 });

  const publicWatchState = await watchPage.evaluate(() => ({
    appPhase,
    activeTab,
    currentRole,
    guestReadOnlyMode,
    cloudCode: state.cloudCode
  }));
  expect(publicWatchState).toEqual({
    appPhase: 'app',
    activeTab: 'live',
    currentRole: 'guest',
    guestReadOnlyMode: true,
    cloudCode: watchCode
  });
  expect(watchExternalFirebaseRequests).toEqual([]);
  await watchContext.close();

  await page.locator('[data-action="community-switch-room-tab"][data-tab="referee"]').click();

  async function winCurrentMatchForA(expectedCompleted) {
    const extreme = page.locator('[data-action="score"][data-side="A"][data-type="extreme"]:not([disabled])').first();
    await expect(extreme).toBeVisible({ timeout: 30000 });
    await extreme.click();

    await page.waitForFunction(() => {
      const active = [...document.querySelectorAll('.court-card.referee-workstation')]
        .find(card => card.querySelector('[data-action="score"]:not([disabled])'));
      if(!active) return false;
      const scores=[...active.querySelectorAll('.side-score')].map(x=>x.textContent.trim());
      return scores.includes('3');
    }, null, { timeout: 20000 });

    await page.evaluate(async () => {
      if (typeof flushStationMatchMutations === 'function') await flushStationMatchMutations();
    });

    const spin = page.locator('[data-action="score"][data-side="A"][data-type="spin"]:not([disabled])').first();
    await expect(spin).toBeVisible({ timeout: 20000 });
    await spin.click({ force: true });

    await expect(page.locator('[data-action="modal-confirm"]')).toBeVisible({ timeout: 15000 });
    await page.locator('[data-action="modal-confirm"]').click();

    await page.waitForFunction((count) => {
      try {
        return state.matches.filter(m => m && !m.isBye && m.completed).length >= count;
      } catch (_) {
        return false;
      }
    }, expectedCompleted, { timeout: 30000 });

    await page.evaluate(async () => {
      if (typeof flushStationMatchMutations === 'function') await flushStationMatchMutations();
      if (typeof flushCloudStateWrites === 'function') await flushCloudStateWrites();
    });
  }

  // Semi-final 1.
  await winCurrentMatchForA(1);
  await expect(page.getByText(/已完成 1 場/).first()).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('目前場次｜第2場', { exact: true })).toBeVisible({ timeout: 30000 });

  // Semi-final 2.
  await winCurrentMatchForA(2);
  await page.waitForFunction(() => {
    try {
      const final = state.matches.find(m => m && m.bracket === 'SE' && Number(m.round) === 1);
      return !!(final && final.a && final.b && !final.completed);
    } catch (_) {
      return false;
    }
  }, null, { timeout: 30000 });

  // Championship final.
  await winCurrentMatchForA(3);

  await page.waitForFunction(() => {
    try {
      return !!state.championId && state.archiveStatus === 'completed';
    } catch (_) {
      return false;
    }
  }, null, { timeout: 45000 });

  const finalState = await page.evaluate(() => ({
    championId: state.championId,
    runnerUpId: state.runnerUpId,
    archiveStatus: state.archiveStatus,
    completedRealMatches: state.matches.filter(m => m && !m.isBye && m.completed).length,
    totalRealMatches: state.matches.filter(m => m && !m.isBye).length,
    settlementPhase: state.settlementPhase
  }));

  expect(finalState.championId).toBeTruthy();
  expect(finalState.runnerUpId).toBeTruthy();
  expect(finalState.completedRealMatches).toBe(finalState.totalRealMatches);
  expect(finalState.completedRealMatches).toBe(3);
  expect(finalState.archiveStatus).toBe('completed');

  expect(externalFirebaseRequests).toEqual([]);
});
