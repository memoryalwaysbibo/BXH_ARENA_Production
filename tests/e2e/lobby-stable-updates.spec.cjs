'use strict';

const { test, expect } = require('@playwright/test');

// Run against the complete shipped index, Core, feature scripts and CSS. Only
// the cloud service boundary is replaced. No Firebase SDK, account, production
// read, or registration write is allowed in this suite.
test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });
const pageErrors = new WeakMap();
const pageDiagnostics = new WeakMap();
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    // Collected on the driver side, so a stalled renderer cannot block the
    // diagnostic attachment. The trace retains the same console events.
    await testInfo.attach('lobby-frame-diagnostics', {
      body: JSON.stringify(pageDiagnostics.get(page) || [], null, 2), contentType: 'application/json',
    });
  }
  expect(pageErrors.get(page) || [], 'No runtime errors may occur during lobby interactions').toEqual([]);
});

async function openLobby(page, options = {}) {
  const errors = [];
  pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  const diagnostics = [];
  pageDiagnostics.set(page, diagnostics);
  page.on('console', message => {
    const text = message.text();
    if (text.startsWith('[lobby-frame] ')) {
      diagnostics.push(text.slice(14));
      console.log(text);
    }
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort('blockedbyclient');
    if (url.pathname === '/modules/cloud/cloud-runtime.js') {
      return route.fulfill({ contentType: 'text/javascript', body: '// Cloud services are synthetic in this test.' });
    }
    return route.continue();
  });
  await page.addInitScript(() => {
    const copy = value => JSON.parse(JSON.stringify(value));
    const fresh = items => ({ ok: true, items: copy(items), fromCache: false, hasPendingWrites: false, excluded: [] });
    const fixture = window.lobbyFixture = {
      rows: [], subscriptions: [], publicQueries: [], registrationQueries: [], detailReads: [], writes: [],
      holdPublic: false, holdRegistrations: false, registrations: [], authCallback: null,
      flushes: 0, fresh,
    };
    // Observe scheduling without replacing requestAnimationFrame, forcing an
    // action, reading geometry, or changing the shipped rendering/CSS.
    let mutations = 0, phase = 'init';
    new MutationObserver(records => { mutations += records.length; })
      .observe(document, { childList: true, subtree: true, attributes: true });
    fixture.diagnostic = nextPhase => {
      if (nextPhase) phase = nextPhase;
      console.debug('[lobby-frame] ' + JSON.stringify({
        ms: Math.round(performance.now()), phase, visibility: document.visibilityState,
        focus: document.hasFocus(), flushes: fixture.flushes, mutations,
      }));
    };
    let pulses = 0;
    const diagnosticTimer = setInterval(() => {
      fixture.diagnostic();
      if (++pulses >= 20) clearInterval(diagnosticTimer);
    }, 2000);
    document.addEventListener('visibilitychange', () => fixture.diagnostic());
    window.cloudSync = {
      isEnabled: () => true,
      connect: async () => true,
      subscribePublicTournaments(callback) {
        const subscription = { callback, stopped: false };
        fixture.subscriptions.push(subscription);
        return () => { subscription.stopped = true; };
      },
      queryPublicTournaments() {
        const request = {};
        fixture.publicQueries.push(request);
        if (!fixture.holdPublic) return Promise.resolve(fresh(fixture.rows));
        return new Promise((resolve, reject) => { request.resolve = resolve; request.reject = reject; });
      },
      queryMyRegistrations() {
        const request = {};
        fixture.registrationQueries.push(request);
        if (!fixture.holdRegistrations) return Promise.resolve(copy(fixture.registrations));
        return new Promise((resolve, reject) => { request.resolve = resolve; request.reject = reject; });
      },
      getPublicTournamentSummary: async code => copy(fixture.rows.find(row => row.code === code) || null),
      getPublicTournamentFull: async code => {
        fixture.detailReads.push(code);
        return copy(fixture.rows.find(row => row.code === code) || null);
      },
      getMyRegistrationForTournament: async () => null,
      joinTournamentAsPlayer: async (...args) => {
        fixture.writes.push(args);
        throw Error('This suite must never write a registration');
      },
    };
    window.cloudAuth = {
      isReady: () => true,
      hasSuperAdmin: async () => true,
      onAuthChange: callback => { fixture.authCallback = callback; return () => {}; },
      getUserProfile: async uid => ({ uid, role: 'player', active: true, realName: 'Synthetic player',
        displayName: 'Synthetic player', playerId: 'P-FIXTURE', email: 'fixture@example.invalid' }),
      touchLastLogin: () => {},
      signOutUser: async () => {},
    };
    window.engagementService = {
      mailbox: async () => ({ ok: true, messages: [], unreadCount: 0 }),
      mood: async () => ({ ok: true, messages: [] }),
      familyRegistration: async payload => {
        if (payload.action !== 'mine') throw Error('Unexpected registration action: ' + payload.action);
        return { ok: true, rows: [] };
      },
    };
  });
  await page.goto('/', { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.lobbyFixture.authCallback === 'function');
  await page.evaluate(async ({ cached, missingRegistrations }) => {
    const fixture = window.lobbyFixture;
    const now = Date.now();
    fixture.rows = Array.from({ length: 7 }, (_, index) => {
      const code = 'BXH-FIXTURE-' + String(index + 1);
      const name = 'Synthetic event ' + String(index + 1);
      return {
        code, name, visibility: 'public', publishedAt: 1, eventAuthority: 'official',
        hostName: 'Synthetic host', tournamentPhase: 'waiting', registrationStatus: 'open',
        registrationEnabled: true, eventDate: '2099-06-01', startAt: '12:00', location: 'Fixture hall',
        registrationOpenAt: now - 60000, registrationCloseAt: now + 3600000,
        cancellationDeadline: now + 3600000, capacity: 32, confirmedCount: 2,
        waitlistEnabled: true, waitlistCapacity: 4, waitlistCount: 0, updatedAt: 100,
        parsedData: { meta: { name, date: '2099-06-01', startTime: '12:00', location: 'Fixture hall' },
          players: [{ id: 'p1', name: 'Synthetic participant', checkedIn: false }], matches: [] },
        bracketView: JSON.stringify({ revision: 1, matches: [] }),
      };
    });
    myRegistrationsCache = missingRegistrations ? null : [];
    fixture.holdRegistrations = !!missingRegistrations;
    const source = fixture.fresh(fixture.rows);
    if (cached) source.fromCache = true;
    applyPublicTournamentItems(fixture.rows, { renderIfChanged: false, source });
    lobbySectionExpanded = { live: true, settling: true, registration: true, waiting: true, ended: true };
    pendingLoginIntent = 'player';
    await fixture.authCallback({ uid: 'fixture-player', email: 'fixture@example.invalid' });
    // Court-call discovery shares queryMyRegistrations. Its independent 30 s
    // cache is seeded so request-order assertions concern the lobby loader.
    courtCallDiscoveryAt = Date.now();
    fixture.publish = (rows = fixture.rows, metadata = {}) => {
      fixture.rows = rows;
      const subscription = fixture.subscriptions.findLast(item => !item.stopped);
      if (!subscription) throw Error('No active public subscription');
      subscription.callback({ ...fixture.fresh(rows), ...metadata });
    };
    fixture.publish(fixture.rows, cached ? { fromCache: true } : {});
    fixture.readState = () => ({ phase: appPhase, uid: currentAuthUid(), code: tournamentDetailCode,
      cache: publicTournamentsCache, registrations: myRegistrationsCache, loading: publicTournamentsLoading });
    const originalFlush = flushLobbyRender;
    flushLobbyRender = function (...args) { fixture.flushes++; return originalFlush.apply(this, args); };
  }, options);
  await expect(page.locator('[data-lobby-root]')).toBeVisible();
  await expect(page.locator('[data-lobby-code]')).toHaveCount(7);
  // Existing viewport restoration schedules its final pass at 180 ms. Let the
  // login render finish before measuring subsequent user-controlled scroll.
  await page.waitForTimeout(220);
  await settle(page);
  expect(errors, 'Full-runtime fixture must not hide JavaScript errors').toEqual([]);
  return errors;
}

async function settle(page) {
  await page.evaluate(() => new Promise(resolve => {
    lobbyFixture.diagnostic('settle:start');
    requestAnimationFrame(() => {
      lobbyFixture.diagnostic('settle:raf1');
      requestAnimationFrame(time => { lobbyFixture.diagnostic('settle:raf2'); resolve(time); });
    });
  }));
}

const card = (page, code = 'BXH-FIXTURE-1') => page.locator('[data-lobby-code="' + code + '"]');
const action = (page, code = 'BXH-FIXTURE-1') => card(page, code).locator('.lobby-card-actions [data-action="view-public-tournament"]');

async function expandCard(page, code = 'BXH-FIXTURE-1') {
  await page.evaluate(() => lobbyFixture.diagnostic('expand:before-click'));
  await card(page, code).locator(':scope > summary').click();
  await expect(card(page, code)).toHaveAttribute('open', '');
  await page.evaluate(() => lobbyFixture.diagnostic('expand:after-click'));
}

test('public updates and unrelated render calls retain card, roster, focus and scroll', async ({ page }) => {
  await openLobby(page);
  await expandCard(page);
  await card(page).locator('.lobby-roster-block > summary').click();
  await action(page).focus();
  await page.evaluate(() => {
    const fixture = lobbyFixture;
    fixture.card = document.querySelector('[data-lobby-code="BXH-FIXTURE-1"]');
    fixture.roster = fixture.card.querySelector('.lobby-roster-block');
    fixture.button = fixture.card.querySelector('.lobby-card-actions button');
    window.scrollTo(0, 240);
    fixture.scroll = window.scrollY;
    const rows = structuredClone(fixture.rows);
    rows[0].confirmedCount = 3;
    rows[1].confirmedCount = 4;
    fixture.publish(rows);
  });
  await settle(page);
  await page.evaluate(() => render());
  await settle(page);
  expect(await page.evaluate(() => ({
    card: lobbyFixture.card === document.querySelector('[data-lobby-code="BXH-FIXTURE-1"]'),
    roster: lobbyFixture.roster === lobbyFixture.card.querySelector('.lobby-roster-block'),
    button: lobbyFixture.button === lobbyFixture.card.querySelector('.lobby-card-actions button'),
    open: lobbyFixture.card.open && lobbyFixture.roster.open,
    focus: document.activeElement === lobbyFixture.button,
    scrollDelta: Math.abs(scrollY - lobbyFixture.scroll),
  }))).toEqual({ card: true, roster: true, button: true, open: true, focus: true, scrollDelta: 0 });
  await expect(card(page).locator('.lobby-detail-grid')).toContainText('3 / 32');
});

test('pointer down survives an intervening update and opens the intended detail once', async ({ page }) => {
  await openLobby(page);
  await expandCard(page);
  await action(page).scrollIntoViewIfNeeded();
  const box = await action(page).boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // This is the shipped stylesheet, with no test-only style injection.
  await expect(card(page)).toHaveCSS('filter', 'none');
  await page.mouse.down();
  await page.evaluate(() => {
    const rows = structuredClone(lobbyFixture.rows);
    rows[0].confirmedCount++;
    lobbyFixture.publish(rows);
  });
  await settle(page);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => lobbyFixture.detailReads)).toEqual(['BXH-FIXTURE-1']);
  expect(await page.evaluate(() => lobbyFixture.readState().code)).toBe('BXH-FIXTURE-1');
  expect(await page.evaluate(() => lobbyFixture.writes)).toEqual([]);
});

test('keyboard focus remains usable across a public update', async ({ page }) => {
  await openLobby(page);
  await expandCard(page);
  await action(page).focus();
  await page.evaluate(() => {
    const rows = structuredClone(lobbyFixture.rows);
    rows[1].confirmedCount++;
    lobbyFixture.publish(rows);
  });
  await settle(page);
  await expect(action(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => lobbyFixture.detailReads)).toEqual(['BXH-FIXTURE-1']);
  expect(await page.evaluate(() => lobbyFixture.writes)).toEqual([]);
});

test('snapshot bursts coalesce to one flush and keep the last count', async ({ page }) => {
  await openLobby(page);
  await expandCard(page);
  const flushes = await page.evaluate(() => {
    const before = lobbyFixture.flushes;
    for (let count = 3; count <= 12; count++) {
      const rows = structuredClone(lobbyFixture.rows);
      rows[0].confirmedCount = count;
      lobbyFixture.publish(rows);
    }
    return before;
  });
  await settle(page);
  expect(await page.evaluate(before => lobbyFixture.flushes - before, flushes)).toBe(1);
  await expect(card(page).locator('.lobby-detail-grid')).toContainText('12 / 32');
});

test('raw match updates and filtered-out events refresh cache without lobby mutation', async ({ page }) => {
  await openLobby(page);
  await page.evaluate(() => {
    findEventsFilters.keyword = 'Synthetic event 1';
    render();
  });
  await settle(page);
  await page.evaluate(() => {
    lobbyFixture.mutations = [];
    lobbyFixture.observer = new MutationObserver(records => lobbyFixture.mutations.push(...records.map(record => record.type)));
    lobbyFixture.observer.observe(document.querySelector('[data-lobby-root]'), { subtree: true, childList: true, attributes: true, characterData: true });
    const rows = structuredClone(lobbyFixture.rows);
    rows[0].updatedAt = 999;
    rows[0].bracketView = JSON.stringify({ revision: 2, matches: [{ scoreA: 4 }] });
    rows[0].parsedData.matches = [{ scoreA: 4 }];
    rows[1].confirmedCount = 25;
    lobbyFixture.publish(rows);
  });
  await settle(page);
  expect(await page.evaluate(() => lobbyFixture.mutations)).toEqual([]);
  expect(await page.evaluate(() => lobbyFixture.readState().cache[0].parsedData.matches[0].scoreA)).toBe(4);
  expect(await page.evaluate(() => lobbyFixture.readState().cache[1].confirmedCount)).toBe(25);
});

test('presentation-only changes patch without an updatedAt change', async ({ page }) => {
  await openLobby(page);
  await expandCard(page);
  await page.evaluate(() => {
    const rows = structuredClone(lobbyFixture.rows);
    rows[0].parsedData.meta.name = 'Updated synthetic title';
    rows[0].parsedData.meta.location = 'Second fixture hall';
    rows[0].fee = 123;
    rows[0].eventDescription = 'Updated synthetic instructions';
    lobbyFixture.publish(rows);
  });
  await settle(page);
  await expect(card(page)).toContainText('Updated synthetic title');
  await expect(card(page)).toContainText('Second fixture hall');
  await expect(card(page)).toContainText('123 元');
  await expect(card(page)).toContainText('Updated synthetic instructions');
});

test('cached and pending snapshots cannot claim fresh signup eligibility', async ({ page }) => {
  await openLobby(page, { cached: true });
  await expandCard(page);
  await expect(action(page)).toHaveText('查看資訊（報名狀態待確認）');
  await page.evaluate(() => lobbyFixture.publish());
  await settle(page);
  await expect(action(page)).toHaveText('查看與報名');
  await page.evaluate(() => lobbyFixture.publish(lobbyFixture.rows, { fromCache: true }));
  await settle(page);
  await expect(action(page)).toHaveText('查看資訊（報名狀態待確認）');
  await page.evaluate(() => lobbyFixture.publish(lobbyFixture.rows, { hasPendingWrites: true }));
  await settle(page);
  await expect(action(page)).toHaveText('查看資訊（報名狀態待確認）');
});

test('capacity and cutoff updates immediately withdraw signup wording', async ({ page }) => {
  await openLobby(page);
  await expandCard(page);
  await page.evaluate(() => {
    const rows = structuredClone(lobbyFixture.rows);
    rows[0].confirmedCount = rows[0].capacity;
    rows[0].waitlistCount = rows[0].waitlistCapacity;
    lobbyFixture.publish(rows);
  });
  await settle(page);
  await expect(card(page).locator('.lobby-card-actions')).toContainText('已額滿');
  await expect(action(page)).toHaveText('查看賽事資訊');
  await page.evaluate(() => {
    const rows = structuredClone(lobbyFixture.rows);
    rows[0].registrationCloseAt = Date.now() - 1;
    lobbyFixture.publish(rows);
  });
  await settle(page);
  await expect(card(page).locator('.lobby-card-actions')).toContainText('報名截止');
  await expect(action(page)).toHaveText('查看賽事資訊');
});

test('old query and stopped subscription cannot repaint a later lobby visit', async ({ page }) => {
  await openLobby(page);
  await page.evaluate(() => {
    lobbyFixture.holdPublic = true;
    lobbyFixture.oldSubscription = lobbyFixture.subscriptions.findLast(item => !item.stopped);
    void reconcilePublicTournamentsNow('fixture-old-visit');
  });
  await expect.poll(() => page.evaluate(() => lobbyFixture.publicQueries.length)).toBe(1);
  await page.evaluate(() => {
    appPhase = 'landing'; render();
    appPhase = 'player-center'; playerActiveTab = 'home'; render();
    const rows = structuredClone(lobbyFixture.rows);
    rows[0].parsedData.meta.name = 'Current visit';
    lobbyFixture.publish(rows);
    const stale = structuredClone(rows);
    stale[0].parsedData.meta.name = 'Obsolete visit';
    lobbyFixture.oldSubscription.callback(lobbyFixture.fresh(stale));
    lobbyFixture.publicQueries[0].resolve(lobbyFixture.fresh(stale));
  });
  await settle(page);
  await expect(card(page)).toContainText('Current visit');
  await expect(card(page)).not.toContainText('Obsolete visit');
});

test('old-account registration results cannot reach a new account', async ({ page }) => {
  await openLobby(page, { missingRegistrations: true });
  await expect.poll(() => page.evaluate(() => lobbyFixture.registrationQueries.length)).toBe(1);
  await page.evaluate(async () => {
    await lobbyFixture.authCallback(null);
    pendingLoginIntent = 'player';
    await lobbyFixture.authCallback({ uid: 'fixture-next-player', email: 'next@example.invalid' });
    courtCallDiscoveryAt = Date.now();
    lobbyFixture.registrationQueries[0].resolve([{ tournamentCode: 'BXH-FIXTURE-1', status: 'confirmed', uid: 'fixture-player' }]);
  });
  await settle(page);
  expect(await page.evaluate(() => lobbyFixture.readState().uid)).toBe('fixture-next-player');
  expect(await page.evaluate(() => (lobbyFixture.readState().registrations || []).some(row => row.uid === 'fixture-player'))).toBe(false);
  await expect(card(page).locator('.lobby-card-actions')).not.toContainText('已報名（正取）');
});

test('T0 refresh keeps existing cards while the public request is still pending', async ({ page }) => {
  await page.clock.install();
  await openLobby(page);
  await page.evaluate(() => {
    const rows = structuredClone(lobbyFixture.rows);
    // Give native WebKit setup time without allowing the boundary to expire
    // before the assertions; the actual crossing is advanced explicitly below.
    lobbyFixture.openingAt = Date.now() + 60000;
    rows[0].registrationOpenAt = lobbyFixture.openingAt;
    rows[0].registrationStatus = 'scheduled';
    lobbyFixture.publish(rows);
  });
  await settle(page);
  await expandCard(page);
  await expect(card(page).locator('[data-registration-countdown]')).toHaveCount(1);
  await page.evaluate(() => {
    lobbyFixture.holdPublic = true;
    lobbyFixture.publicQueriesBeforeOpening = lobbyFixture.publicQueries.length;
    lobbyFixture.card = document.querySelector('[data-lobby-code="BXH-FIXTURE-1"]');
  });
  const untilOpening = await page.evaluate(() => lobbyFixture.openingAt - Date.now());
  expect(untilOpening, 'The clock boundary must still be in the future after native setup').toBeGreaterThan(0);
  await page.clock.fastForward(untilOpening + 1500);
  await settle(page);
  await expect.poll(() => page.evaluate(() => lobbyFixture.publicQueries.length - lobbyFixture.publicQueriesBeforeOpening)).toBeGreaterThan(0);
  expect(await page.evaluate(() => lobbyFixture.readState().cache === null)).toBe(false);
  expect(await page.evaluate(() => lobbyFixture.card === document.querySelector('[data-lobby-code="BXH-FIXTURE-1"]'))).toBe(true);
  await expect(card(page)).toBeVisible();
  await expect(page.getByText('正在讀取賽事大廳……', { exact: true })).toHaveCount(0);
});

test('poster permission hooks and async control text survive unrelated count changes', async ({ page }) => {
  await openLobby(page);
  await expect(card(page)).toHaveAttribute('data-poster-access-hook', '1');
  await page.evaluate(() => {
    // Native details dispatches toggle asynchronously. Wait for the real poster
    // permission handler before adding the plugin-owned presentation state.
    const card = document.querySelector('[data-lobby-code="BXH-FIXTURE-1"]');
    lobbyFixture.posterOpened = new Promise(resolve => card.addEventListener('toggle', resolve, { once: true }));
  });
  await expandCard(page);
  await page.evaluate(() => lobbyFixture.posterOpened.then(() => undefined));
  await expect(card(page).locator('[data-poster-manage]')).toBeHidden();
  await page.evaluate(() => {
    const card = document.querySelector('[data-lobby-code="BXH-FIXTURE-1"]');
    const button = card.querySelector('[data-poster-manage]');
    lobbyFixture.posterButton = button;
    card.dataset.posterAccessHook = '1';
    card.dataset.posterPermissionBusy = '1';
    // A player may not manage a poster. Preserve that real permission result.
    button.textContent = '更換照片'; button.dataset.posterHasPhoto = '1';
    const rows = structuredClone(lobbyFixture.rows); rows[0].confirmedCount++;
    lobbyFixture.publish(rows);
  });
  await settle(page);
  expect(await page.evaluate(() => {
    const card = document.querySelector('[data-lobby-code="BXH-FIXTURE-1"]');
    const button = card.querySelector('[data-poster-manage]');
    return { same: button === lobbyFixture.posterButton, hook: card.dataset.posterAccessHook,
      busy: card.dataset.posterPermissionBusy, hidden: button.hidden, text: button.textContent,
      photo: button.dataset.posterHasPhoto };
  })).toEqual({ same: true, hook: '1', busy: '1', hidden: true, text: '更換照片', photo: '1' });
  await expect(card(page).locator('[data-poster-manage]')).toBeHidden();
  await page.evaluate(() => {
    // Presentation-only clone: no room target, enabled action, or permission
    // change. Prove the CSS rule does not hide controls without [hidden].
    const clone = lobbyFixture.posterButton.cloneNode(true);
    clone.hidden = false; clone.disabled = true; clone.inert = true;
    clone.removeAttribute('data-code'); clone.removeAttribute('data-action');
    clone.dataset.fixturePosterPresentation = '1';
    lobbyFixture.posterButton.parentNode.appendChild(clone);
  });
  const presentation = card(page).locator('[data-fixture-poster-presentation]');
  await expect(presentation).toBeVisible();
  await presentation.evaluate(node => node.remove());
  await expect(card(page).locator('[data-poster-manage]')).toBeHidden();
  expect(await page.evaluate(() => lobbyFixture.writes)).toEqual([]);
});

test('missing-room cached snapshots withdraw old actions and keep the raw cache faithful', async ({ page }) => {
  await openLobby(page);
  await expandCard(page);
  await page.evaluate(() => lobbyFixture.publish(lobbyFixture.rows.slice(1), { fromCache: true }));
  await settle(page);
  await expect(card(page)).toHaveCount(0);
  expect(await page.evaluate(() => lobbyFixture.readState().cache.some(row => row.code === 'BXH-FIXTURE-1'))).toBe(false);
  expect(await page.evaluate(() => lobbyFixture.writes)).toEqual([]);
});

test('removal during a held pointer makes the old target inert before releasing it', async ({ page }) => {
  await openLobby(page);
  await expandCard(page);
  await action(page).scrollIntoViewIfNeeded();
  const box = await action(page).boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.evaluate(() => lobbyFixture.publish(lobbyFixture.rows.slice(1)));
  await settle(page);
  await expect(action(page)).toBeDisabled();
  await page.mouse.up();
  await settle(page);
  await expect(card(page)).toHaveCount(0);
  expect(await page.evaluate(() => lobbyFixture.detailReads)).toEqual([]);
  expect(await page.evaluate(() => lobbyFixture.writes)).toEqual([]);
});

test('an unchanged manual refresh releases a busy refresh control', async ({ page }) => {
  await openLobby(page);
  await page.evaluate(() => { lobbyFixture.holdPublic = true; });
  const refresh = page.locator('[data-lobby-root] [data-action="refresh-public-tournaments"]');
  await refresh.click();
  await expect.poll(() => page.evaluate(() => lobbyFixture.publicQueries.length)).toBe(1);
  await page.evaluate(() => render());
  await expect(refresh).toBeDisabled();
  await page.evaluate(() => lobbyFixture.publicQueries[0].resolve(lobbyFixture.fresh(lobbyFixture.rows)));
  await settle(page);
  await expect(refresh).toBeEnabled();
});

test('same-UID reauthentication rejects old public and registration responses', async ({ page }) => {
  await openLobby(page, { missingRegistrations: true });
  await expect.poll(() => page.evaluate(() => lobbyFixture.registrationQueries.length)).toBe(1);
  await page.evaluate(() => {
    lobbyFixture.holdPublic = true;
    void reconcilePublicTournamentsNow('before same-UID reauthentication');
  });
  await expect.poll(() => page.evaluate(() => lobbyFixture.publicQueries.length)).toBe(1);
  await page.evaluate(async () => {
    await lobbyFixture.authCallback({ uid: 'fixture-player', email: 'fixture@example.invalid' });
    courtCallDiscoveryAt = Date.now();
    const current = structuredClone(lobbyFixture.rows);
    current[0].parsedData.meta.name = 'Current authentication';
    lobbyFixture.publish(current);
    const obsolete = structuredClone(current);
    obsolete[0].parsedData.meta.name = 'Obsolete authentication';
    lobbyFixture.publicQueries[0].resolve(lobbyFixture.fresh(obsolete));
    lobbyFixture.registrationQueries[0].resolve([{ tournamentCode: 'BXH-FIXTURE-1', status: 'confirmed', marker: 'old-auth' }]);
  });
  await expect.poll(() => page.evaluate(() => lobbyFixture.registrationQueries.length)).toBe(2);
  await page.evaluate(() => lobbyFixture.registrationQueries[1].resolve([]));
  await settle(page);
  await expect(card(page)).toContainText('Current authentication');
  await expect(card(page)).not.toContainText('Obsolete authentication');
  expect(await page.evaluate(() => lobbyFixture.readState().registrations)).toEqual([]);
});

test('local cutoff withdraws signup wording while the fresh query remains pending', async ({ page }) => {
  await page.clock.install();
  await openLobby(page);
  await expandCard(page);
  await page.evaluate(() => {
    const rows = structuredClone(lobbyFixture.rows);
    rows[0].registrationCloseAt = Date.now() + 2000;
    lobbyFixture.publish(rows);
    lobbyFixture.holdPublic = true;
  });
  await settle(page);
  await expect(action(page)).toHaveText('查看與報名');
  await page.clock.fastForward(2500);
  await settle(page);
  await expect.poll(() => page.evaluate(() => lobbyFixture.publicQueries.length)).toBeGreaterThan(0);
  await expect(card(page).locator('.lobby-card-actions')).toContainText('報名截止');
  await expect(action(page)).toHaveText('查看賽事資訊');
  expect(await page.evaluate(() => lobbyFixture.readState().cache === null)).toBe(false);
});

test('user scrolling after a stable update is not undone by delayed legacy restoration', async ({ page }) => {
  await openLobby(page);
  await page.evaluate(() => {
    document.querySelectorAll('[data-lobby-code]').forEach(card => { card.open = true; });
    window.scrollTo(0, 200);
    const rows = structuredClone(lobbyFixture.rows); rows[0].confirmedCount++;
    lobbyFixture.publish(rows);
  });
  await settle(page);
  const expected = await page.evaluate(() => { window.scrollTo(0, 350); return window.scrollY; });
  expect(expected).toBeGreaterThan(200);
  // Covers both existing 80 ms and 180 ms legacy restore callbacks.
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.scrollY)).toBe(expected);
});
