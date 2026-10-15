'use strict';
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

// Full shipped page and CSS. Only the service boundary is synthetic: no live
// Firebase SDK, player account, registration write, or backend request is used.
test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });
async function openQueue(page) {
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
