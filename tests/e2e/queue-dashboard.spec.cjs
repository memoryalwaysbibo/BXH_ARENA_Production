'use strict';
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

// Full shipped page and CSS. Only the service boundary is synthetic: no live
// Firebase SDK, player account, registration write, or backend request is used.
test.use({ serviceWorkers: 'block', contextOptions: { reducedMotion: 'reduce' } });
async function openQueue(page, motion = 'reduce') {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort('blockedbyclient');
    if (url.pathname === '/modules/cloud/cloud-runtime.js') return route.fulfill({ contentType: 'text/javascript', body: '// Isolated queue test services.' });
    return route.continue();
  });
  await page.addInitScript(() => {
    const copy = value => JSON.parse(JSON.stringify(value));
    const fixture = window.queueFixture = { reads: [], subscriptions: [], authCallback: null, registrations: [], info: null };
    window.cloudSync = {
      isEnabled: () => true, connect: async () => true,
      subscribePublicTournaments(callback) { fixture.subscriptions.push(callback); return () => {}; },
      queryPublicTournaments: async () => ({ ok: true, items: [], fromCache: false, hasPendingWrites: false }),
      queryMyRegistrations: async () => copy(fixture.registrations),
      getPublicTournamentSummary: async code => { fixture.reads.push(code); return copy(fixture.info); },
    };
    window.cloudAuth = {
      isReady: () => true, hasSuperAdmin: async () => true,
      onAuthChange: callback => { fixture.authCallback = callback; return () => {}; },
      getUserProfile: async uid => ({ uid, role: 'player', active: true, realName: '測試選手', displayName: '測試選手', playerId: 'P-TEST', email: 'queue@example.invalid' }),
      touchLastLogin: () => {}, signOutUser: async () => {},
    };
    window.engagementService = {
      mailbox: async () => ({ ok: true, messages: [], unreadCount: 0 }),
      mood: async () => ({ ok: true, messages: [] }),
      courtCall: async payload => { if (payload.action !== 'list') throw Error('Queue test may not mutate calls'); return { ok: true, rows: [], prepares: [], passUsed: false }; },
      familyRegistration: async payload => { if (payload.action !== 'mine') throw Error('Queue test may not mutate registrations'); return { ok: true, rows: [] }; },
    };
  });
  await page.goto('/', { waitUntil: 'load' });
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), 'Browser must use the requested motion preference').toBe(motion === 'reduce');
  await page.waitForFunction(() => typeof queueFixture.authCallback === 'function');
  await page.evaluate(async () => {
    pendingLoginIntent = 'player';
    await queueFixture.authCallback({ uid: 'queue-player', email: 'queue@example.invalid' });
    appPhase = 'player-center'; playerActiveTab = 'registered'; currentRole = 'player';
    reconcileLobbyContext(); syncEngagementIdentity();
    const names = ['阿哲', '小宇', '阿岳', '小豪', '阿傑', '阿柏', '測試選手', '示範對手', '阿凱', '阿仁', '阿翔', '小賴'];
    const players = names.map((name, i) => ({ id: 'p' + (i + 1), name }));
    const match = (id, station, a, b, status = 'ready') => ({ id, station, seq: Number(id.slice(1)), round: 0, indexInRound: Number(id.slice(1)) - 1, bracket: 'RR', a: { playerId: 'p' + a }, b: { playerId: 'p' + b }, status, completed: false, isBye: false });
    queueFixture.info = { name: 'BXH 現場交流賽（測試資料）', tournamentPhase: 'live', parsedData: { meta: { name: 'BXH 現場交流賽', stations: 3, formatType: 'roundrobin' }, startedAt: 1, players,
      matches: [match('m1', 1, 1, 2, 'in_progress'), match('m2', 2, 3, 4, 'in_progress'), match('m3', 3, 5, 6, 'in_progress'), match('m4', 3, 7, 8), match('m5', 1, 9, 10), match('m6', 2, 11, 12)],
      courtAssignments: { court1: { currentMatchId: 'm1', nextMatchId: 'm5' }, court2: { currentMatchId: 'm2', nextMatchId: 'm6' }, court3: { currentMatchId: 'm3', nextMatchId: 'm4' } } } };
    queueFixture.registrations = [{ tournamentCode: 'BXH-QUEUE1', registrationId: 'queue-player', displayName: '測試選手', status: 'confirmed' }];
    myRegistrationsCache = structuredClone(queueFixture.registrations);
    myRegistrationsTournamentInfo = { 'BXH-QUEUE1': structuredClone(queueFixture.info) };
    myRegistrationsLoading = false; myRegistrationsError = null;
    courtCallDiscoveryAt = Date.now();
    render();
  });
  await expect(page.locator('.queue-dashboard')).toBeVisible();
  await page.waitForTimeout(220); // Allow only the initial legacy viewport restore to finish.
  // Let the existing 2.7s call toast finish before visual capture or switching
  // fixture assignments; screenshots should show the settled dashboard.
  await expect(page.locator('#toast-root .toast')).toHaveCount(0);
  return errors;
}

test('registered queue keeps stable nodes, focused actions and scroll through live updates', async ({ page }, testInfo) => {
  const errors = await openQueue(page);
  await expect(page.locator('.queue-ahead-value span')).toHaveText('1');
  await expect(page.locator('.queue-station strong')).toHaveText('第 3 台');
  await expect(page.locator('.queue-player-identity')).toHaveText('7號｜測試選手');
  await expect(page.locator('.queue-court-card')).toHaveCount(3);
  await expect(page.locator('.queue-court-card.is-mine')).toHaveAttribute('data-queue-key', 'court:3');
  await expect(page.locator('.queue-bracket-button')).toHaveAttribute('data-view', 'bracket');
  const output = path.join('test-results', 'queue-dashboard'); fs.mkdirSync(output, { recursive: true });
  await page.locator('.queue-dashboard').screenshot({ path: path.join(output, testInfo.project.name + '-next.png') });
  await page.screenshot({ path: path.join(output, testInfo.project.name + '-registered-page.png'), fullPage: true });
  await page.locator('.queue-bracket-button').focus();
  await page.evaluate(() => {
    const f = queueFixture;
    f.root = document.querySelector('.player-shell');
    f.card = document.querySelector('.queue-self-card');
    f.court = document.querySelector('[data-queue-key="court:3"]');
    f.button = document.querySelector('.queue-bracket-button');
    window.scrollTo(0, 300); f.scrollY = window.scrollY;
    f.readsBefore = f.reads.length; f.subscriptionsBefore = f.subscriptions.length;
    for (let i = 0; i < 12; i++) render();
    const st = myRegistrationsTournamentInfo['BXH-QUEUE1'].parsedData;
    st.matches.find(m => m.id === 'm3').completed = true;
    st.matches.find(m => m.id === 'm4').status = 'in_progress';
    st.courtAssignments.court3 = { currentMatchId: 'm4', nextMatchId: null };
    render();
  });
  await expect(page.locator('.queue-ahead-value span')).toHaveText('0');
  expect(await page.evaluate(() => ({
    card: queueFixture.card === document.querySelector('.queue-self-card'),
    court: queueFixture.court === document.querySelector('[data-queue-key="court:3"]'),
    button: queueFixture.button === document.querySelector('.queue-bracket-button'),
    root: queueFixture.root === document.querySelector('.player-shell'),
    focus: document.activeElement === queueFixture.button,
    scroll: Math.abs(window.scrollY - queueFixture.scrollY) < 2,
    extraReads: queueFixture.reads.length - queueFixture.readsBefore,
    extraSubscriptions: queueFixture.subscriptions.length - queueFixture.subscriptionsBefore,
  }))).toEqual({ card: true, court: true, button: true, root: true, focus: true, scroll: true, extraReads: 0, extraSubscriptions: 0 });
  expect(errors).toEqual([]);
});

test('missing assignments and long names remain readable without invented queue positions', async ({ page }, testInfo) => {
  const errors = await openQueue(page);
  await page.setViewportSize({ width: 320, height: 780 });
  await page.evaluate(() => {
    const st = myRegistrationsTournamentInfo['BXH-QUEUE1'].parsedData;
    st.courtAssignments.court3.nextMatchId = null;
    st.players.find(p => p.id === 'p8').name = '示範長名字選手ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    render();
  });
  await expect(page.locator('.queue-ahead-value')).toHaveText('等待排台');
  await expect(page.locator('.queue-station strong')).toHaveText('尚未排台');
  await expect(page.locator('.queue-court-card.is-mine')).toHaveCount(0);
  expect(await page.evaluate(() => {
    const el = document.querySelector('.queue-dashboard');
    return { viewport: document.documentElement.clientWidth, right: el.getBoundingClientRect().right, overflow: el.scrollWidth - el.clientWidth };
  })).toEqual(expect.objectContaining({ viewport: 320, overflow: 0 }));
  const overflow = await page.locator('.queue-dashboard').evaluate(el => [...el.querySelectorAll('*')].filter(n => n.getBoundingClientRect().right > el.getBoundingClientRect().right + 1).map(n => n.className));
  expect(overflow).toEqual([]);
  const output = path.join('test-results', 'queue-dashboard'); fs.mkdirSync(output, { recursive: true });
  await page.locator('.queue-dashboard').screenshot({ path: path.join(output, testInfo.project.name + '-unassigned-320.png') });
  expect(errors).toEqual([]);
});

// A timer is diagnostic only: a missing rendering frame still fails the test.
async function requireQueueFrame(page, label) {
  let watchdog;
  try {
    const outcome = await Promise.race([(async () => {
      const before = await page.evaluate(() => ({ theme: document.documentElement.getAttribute('data-bxh-theme'), hidden: document.hidden, visibility: document.visibilityState, focus: document.hasFocus(), reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches, viewport: [innerWidth, innerHeight], rect: document.querySelector('.queue-dashboard').getBoundingClientRect().toJSON() }));
      console.log('QUEUE_FRAME_BEFORE', label, JSON.stringify(before));
      const result = await page.evaluate(async () => {
        let frameId, deadline, heartbeat, ticks = 0;
        heartbeat = setInterval(() => { ticks++; }, 100);
        const frame = await Promise.race([
          new Promise(resolve => { frameId = requestAnimationFrame(() => resolve(true)); }),
          new Promise(resolve => { deadline = setTimeout(() => resolve(false), 5000); }),
        ]);
        clearInterval(heartbeat); clearTimeout(deadline); cancelAnimationFrame(frameId);
        return { frame, ticks, theme: document.documentElement.getAttribute('data-bxh-theme'), hidden: document.hidden, visibility: document.visibilityState, focus: document.hasFocus(), rect: document.querySelector('.queue-dashboard').getBoundingClientRect().toJSON() };
      });
      return { before, result };
    })(), new Promise(resolve => { watchdog = setTimeout(() => resolve({ result: { frame: false, nodeWatchdog: true } }), 7000); })]);
    console.log('QUEUE_FRAME_AFTER', label, JSON.stringify(outcome));
    expect(outcome.result.frame, `${label}: ${JSON.stringify(outcome)}`).toBe(true);
  } finally { clearTimeout(watchdog); }
}

// Each theme gets a fresh browser context and named diagnostic steps.
// Keep full-page palette samples bounded on mobile WebKit; retain every theme.
for (const theme of ['gold', 'blue', 'red', 'green', 'directive', 'three-gods', 'hunter', 'akatsuki', 'clow', 'zeon', 'gundam']) {
  test(`queue inherits ${theme} immediately without replacing cards or reading services`, async ({ page }, testInfo) => {
    test.setTimeout(45000);
    const errors = await openQueue(page);
    await page.keyboard.press('Tab');
    await page.locator('.queue-bracket-button').focus();
    await test.step('prepare actual controls and stable-node baseline', async () => {
      await page.evaluate(() => {
        const root = document.documentElement, card = document.querySelector('.queue-self-card');
        const mine = document.querySelector('.queue-court-card.is-mine'), button = document.querySelector('.queue-bracket-button');
        const control = document.querySelector('.queue-dashboard .smart-call-unified-control');
        const bell = control?.querySelector('.smart-call-unified-bell');
        const track = control?.querySelector('.smart-call-unified-track');
        const knob = control?.querySelector('.smart-call-unified-knob');
        if (![control, bell, track, knob].every(Boolean)) throw Error('Expected real unified call controls');
        const motion = document.createElement('style');
        motion.textContent = '.queue-dashboard .smart-call-unified-control * { transition: none !important; }';
        document.head.appendChild(motion);
        const probe = document.createElement('span'); probe.hidden = true; document.body.appendChild(probe);
        const color = value => { probe.style.color = value; return getComputedStyle(probe).color; };
        const read = (el, pseudo) => {
          const style = getComputedStyle(el, pseudo);
          return [style.color, style.backgroundColor, style.borderColor, style.backgroundImage, style.content];
        };
        const status = () => {
          const original = [control.className, bell.className], states = [];
          // CSS-only state samples: never click the control or request permission.
          for (const on of [false, true]) for (const background of [false, true]) {
            control.className = `smart-call-unified-control ${on ? 'is-on' : 'is-off'} ${background ? 'has-background' : 'no-background'}`;
            bell.className = `smart-call-unified-bell ${background ? '' : 'is-notify-off'}`;
            states.push({ on, background, bell: read(bell), slash: read(bell, '::after'), track: read(track), knob: read(knob) });
          }
          [control.className, bell.className] = original;
          return states;
        };
        window.queueThemeProbe = {
          status,
          snapshot: () => ({
            theme: root.getAttribute('data-bxh-theme'),
            accent: color('var(--accent-color)'),
            title: getComputedStyle(document.querySelector('.queue-self-head h3')).color,
            badge: getComputedStyle(document.querySelector('.queue-status')).color,
            count: getComputedStyle(document.querySelector('.queue-ahead-value')).color,
            edge: getComputedStyle(mine, '::before').backgroundColor,
            border: getComputedStyle(mine).borderTopColor,
            focus: getComputedStyle(button).outlineColor,
            card: getComputedStyle(card).backgroundColor,
            expectedCard: color('var(--glass-surface-strong)'),
            statusColors: status(),
          }),
          stable: () => card === document.querySelector('.queue-self-card') && mine === document.querySelector('.queue-court-card.is-mine') && document.activeElement === button,
          cleanup: () => { probe.remove(); motion.remove(); },
          reads: queueFixture.reads.length, subscriptions: queueFixture.subscriptions.length,
        };
      });
    });
    const statusColors = await test.step('sample all four semantic notification states', async () => page.evaluate(() => queueThemeProbe.status()));
    expect(statusColors).toHaveLength(4);
    const [offQuiet, offBackground, onQuiet] = statusColors;
    expect(offQuiet.bell).not.toEqual(offBackground.bell);
    expect(offQuiet.track).not.toEqual(onQuiet.track);
    expect(offQuiet.knob).not.toEqual(onQuiet.knob);
    expect(offQuiet.slash[3]).toContain('linear-gradient');
    expect(offBackground.slash[3]).toBe('none');
    await test.step(`switch from gold to ${theme} and cross a browser frame`, async () => {
      // CSS palette inheritance only; no role, entitlement, preference or backend write.
      await page.evaluate(theme => document.documentElement.setAttribute('data-bxh-theme', theme), theme);
      await requireQueueFrame(page, `palette-${theme}`);
    });
    const state = await test.step(`read ${theme} computed palette`, async () => page.evaluate(() => ({
      ...queueThemeProbe.snapshot(), stable: queueThemeProbe.stable(),
      reads: queueFixture.reads.length - queueThemeProbe.reads,
      subscriptions: queueFixture.subscriptions.length - queueThemeProbe.subscriptions,
    })));
    expect(state.theme).toBe(theme);
    for (const name of ['title', 'badge', 'count', 'edge', 'border', 'focus']) expect(state[name], `${theme}: ${name}`).toBe(state.accent);
    expect(state.card, `${theme}: surface`).toBe(state.expectedCard);
    expect(state.statusColors, `${theme}: semantic call states`).toEqual(statusColors);
    expect(state.stable).toBe(true);
    expect(state.reads).toBe(0); expect(state.subscriptions).toBe(0);
    await page.evaluate(() => { queueThemeProbe.cleanup(); delete window.queueThemeProbe; });
    await expect(page.locator('.queue-ahead-value span')).toHaveText('1');
    await expect(page.locator('.queue-station strong')).toHaveText('第 3 台');
    await expect(page.locator('.queue-player-identity')).toHaveText('7號｜測試選手');
    if (['gold', 'red', 'hunter', 'directive'].includes(theme)) {
      const output = path.join('test-results', 'queue-dashboard'); fs.mkdirSync(output, { recursive: true });
      await page.locator('.queue-dashboard').screenshot({ path: path.join(output, `${testInfo.project.name}-theme-${theme}.png`), timeout: 10000 });
    }
    expect(errors).toEqual([]);
  });
}

test.describe('normal-motion theme rendering', () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' } });
for (const surface of ['shipped', 'opaque-control']) test(`queue repeats same-page theme switches and returns to its original palette (${surface})`, async ({ page }, testInfo) => {
  test.setTimeout(45000);
  const errors = await openQueue(page, 'no-preference');
  if (surface === 'opaque-control') {
    // Diagnostic A/B only. The shipped case and full theme matrix stay unchanged.
    await page.addStyleTag({ content: '.queue-dashboard { --queue-card: var(--panel); --queue-court: var(--panel-2); }' });
    const surfaces = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const rgb = token => {
        const hex = root.getPropertyValue(token).trim();
        if (!/^#[0-9a-f]{6}$/i.test(hex)) throw Error(`Expected opaque six-digit panel token: ${token}=${hex}`);
        return `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
      };
      return { card: getComputedStyle(document.querySelector('.queue-self-card')).backgroundColor,
        court: getComputedStyle(document.querySelector('.queue-court-card:not(.is-mine)')).backgroundColor,
        panel: rgb('--panel'), panel2: rgb('--panel-2') };
    });
    expect(surfaces.card).toBe(surfaces.panel); expect(surfaces.court).toBe(surfaces.panel2);
  }
  await page.keyboard.press('Tab');
  await page.locator('.queue-bracket-button').focus();
  const baseline = await page.evaluate(() => {
    queueFixture.themeCard = document.querySelector('.queue-self-card');
    queueFixture.themeButton = document.querySelector('.queue-bracket-button');
    queueFixture.themeReads = queueFixture.reads.length;
    queueFixture.themeSubscriptions = queueFixture.subscriptions.length;
    return { title: getComputedStyle(document.querySelector('.queue-self-head h3')).color, card: getComputedStyle(queueFixture.themeCard).backgroundColor };
  });
  for (const theme of ['red', 'gold', 'green', 'gold']) await test.step(`same-page switch to ${theme}`, async () => {
    await page.evaluate(theme => document.documentElement.setAttribute('data-bxh-theme', theme), theme);
    await requireQueueFrame(page, `${surface}-${theme}`);
    const state = await page.evaluate(() => ({
      theme: document.documentElement.getAttribute('data-bxh-theme'),
      title: getComputedStyle(document.querySelector('.queue-self-head h3')).color,
      card: getComputedStyle(document.querySelector('.queue-self-card')).backgroundColor,
      stable: queueFixture.themeCard === document.querySelector('.queue-self-card') && document.activeElement === queueFixture.themeButton,
      reads: queueFixture.reads.length - queueFixture.themeReads,
      subscriptions: queueFixture.subscriptions.length - queueFixture.themeSubscriptions,
    }));
    expect(state.theme).toBe(theme);
    expect(state.stable).toBe(true);
    expect(state.reads).toBe(0); expect(state.subscriptions).toBe(0);
    if (theme === 'gold') {
      expect(state.title).toBe(baseline.title); expect(state.card).toBe(baseline.card);
    } else expect(state.title).not.toBe(baseline.title);
  });
  await expect(page.locator('.queue-player-identity')).toHaveText('7號｜測試選手');
  await expect(page.locator('.queue-ahead-value span')).toHaveText('1');
  const output = path.join('test-results', 'queue-dashboard'); fs.mkdirSync(output, { recursive: true });
  await page.locator('.queue-dashboard').screenshot({ path: path.join(output, `${testInfo.project.name}-roundtrip-${surface}.png`), timeout: 10000 });
  expect(errors).toEqual([]);
});
});
