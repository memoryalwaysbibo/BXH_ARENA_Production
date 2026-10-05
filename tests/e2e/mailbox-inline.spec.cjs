'use strict';
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

// This spec is discovered by the existing UI smoke config on desktop, iPhone,
// and Android. It never loads Firebase or makes requests to a live service.
// Use the real mailbox module, production CSS and core viewport functions, with
// a minimal full-innerHTML host and deterministic, in-memory service responses.
test.use({ contextOptions: { reducedMotion: 'reduce' }, serviceWorkers: 'block' });
const root = path.join(__dirname, '../..');
const core = fs.readFileSync(path.join(root, 'modules/main-app/core.js'), 'utf8');
const viewportStart = core.indexOf('function captureRenderViewport()');
const viewportEnd = core.indexOf('function render(){', viewportStart);
if (viewportStart < 0 || viewportEnd <= viewportStart) throw Error('Core viewport integration functions are missing');
const viewportSource = core.slice(viewportStart, viewportEnd);
// Observe completion of core's final scheduled restore without changing its
// timing or scroll behavior. Tokens keep older renders from reporting readiness.
const lastRestore = '  setTimeout(restore, 180);';
if (viewportSource.split(lastRestore).length !== 2) throw Error('Core final viewport restore changed');
const observedViewportSource = viewportSource.replace(lastRestore, `  setTimeout(() => {
    restore();
    if (token === __viewportRestoreToken) fixture.settledViewportToken = token;
  }, 180);`);
const invitations = fs.readFileSync(path.join(root, 'registration-invitations-ui.js'), 'utf8');
const invitationStart = invitations.indexOf('function mailboxInvitationPanel(){');
const invitationEnd = invitations.indexOf('async function mine(', invitationStart);
if (invitationStart < 0 || invitationEnd <= invitationStart) throw Error('Registration invitation mailbox extension is missing');
const invitationSource = invitations.slice(invitationStart, invitationEnd);
const styles = ['core-competition', 'auth-player', 'player-center-hunter', 'lobby-community', 'call-admin-tail', 'referee-tail', 'tail-p7'];
function messages() {
  return Array.from({ length: 36 }, (_, index) => ({
    id: 'mail-' + index, subject: 'Fixture message ' + index,
    body: 'Body for message ' + index + '\n' + 'Readable message content.\n'.repeat(index === 0 ? 16 : 3),
    senderName: 'Fixture sender', createdAt: 1, readAt: index === 5 ? null : 1,
    attachments: index === 17 ? [{ id: 'rules', name: 'fixture.txt', size: 12 }] : [],
    fixtureReward: index === 17
  }));
}
function fixtureHtml(seed) {
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${styles.map(name => '<link rel="stylesheet" href="/modules/main-css/' + name + '.css">').join('\n')}
</head><body><div id="app"></div><script>
window.fixture = { calls: [], server: ${JSON.stringify(seed).replace(/</g, '\\u003c')}, pendingList: null, holdList: false };
let firebaseUser = { uid: 'isolated-mailbox-fixture' }, engagementSessionEpoch = 1, accountMenuOpen = false;
const currentAuthUid = () => firebaseUser.uid;
const isSuperAdmin = () => false;
const mailboxDate = () => '2026/10/05';
const showToast = () => {};
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const copy = value => JSON.parse(JSON.stringify(value));
const listResult = () => ({ ok: true, messages: copy(fixture.server), unreadCount: fixture.server.filter(message => !message.readAt).length });
window.engagementService = {
  mailbox: async payload => {
    fixture.calls.push(copy(payload));
    if (payload.action === 'list') {
      if (fixture.holdList) return new Promise((resolve, reject) => { fixture.pendingList = { resolve, reject }; });
      return listResult();
    }
    if (!['markRead', 'markUnread'].includes(payload.action)) throw Error('Unexpected mock mailbox action: ' + payload.action);
    const message = fixture.server.find(message => message.id === payload.messageId);
    if (!message) throw Error('Unknown fixture message');
    message.readAt = payload.action === 'markRead' ? 1 : null;
    return { ok: true };
  },
  mailboxAttachment: async payload => {
    if (payload.action !== 'download') throw Error('Uploads are forbidden in this fixture');
    fixture.calls.push(copy(payload));
    return { ok: true, base64: btoa('fixture text'), mime: 'text/plain', name: 'fixture.txt' };
  },
  claimTitleReward: async () => { throw Error('A live reward claim must never run'); }
};
window.BXHTitleRewardUI = {
  card: (message, busy) => message.fixtureReward ? '<button class="btn" data-action="mailbox-title-reward" data-message-id="' + esc(message.id) + '" ' + (busy ? 'disabled' : '') + '>Fixture title reward</button>' : '',
  open: async id => { fixture.calls.push({ action: 'fixtureTitleReward', messageId: id }); }
};
window.BXHCardRewardUI = {
  bodyText: message => message.body,
  card: (message, busy) => message.fixtureReward ? '<button class="btn" data-action="mailbox-card-reward" data-message-id="' + esc(message.id) + '" ' + (busy ? 'disabled' : '') + '>Fixture card reward</button>' : '',
  isVirtualAttachment: () => false,
  claim: async id => { fixture.calls.push({ action: 'fixtureCardReward', messageId: id }); }
};
let __lastRenderedViewportKey = null, __viewportRestoreToken = 0;
const currentRenderViewportKey = () => 'mailbox-fixture';
const captureHorizontalNavPositions = () => ({});
const restoreHorizontalNavPositions = () => {};
${observedViewportSource}
const runtime = () => ({ mailbox: () => window.BXHMailbox.mailboxContext() });
const mineRows = [];
${invitationSource}
function render() {
  const snapshot = captureRenderViewport();
  document.getElementById('app').innerHTML = '<main class="player-main">' + window.BXHMailbox.renderMailboxPage() + '</main>';
  mailboxInvitationPanel();
  finishRenderViewport(snapshot);
}
</script><script src="/modules/main-app/mailbox.js"></script><script>
Object.assign(BXHMailbox.mailboxContext(), { open: true, messages: copy(fixture.server), unreadCount: fixture.server.filter(message => !message.readAt).length });
fixture.refresh = () => BXHMailbox.handleMailbox('mailbox-refresh', document.querySelector('[data-action="mailbox-refresh"]'));
fixture.resolveList = () => { const pending = fixture.pendingList; fixture.pendingList = null; fixture.holdList = false; pending.resolve(listResult()); };
fixture.rejectList = () => { const pending = fixture.pendingList; fixture.pendingList = null; fixture.holdList = false; pending.reject(Error('fixture offline')); };
document.addEventListener('click', event => {
  const target = event.target.closest('[data-action]');
  if (target) void BXHMailbox.handleMailbox(target.getAttribute('data-action'), target);
});
render();
</script></body></html>`;
}

async function openMailbox(page, seed = messages()) {
  // Fail closed: only the fixture, mailbox JS and production CSS may be fetched.
  // No auth SDK, network API, production account or backend write is involved.
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort('blockedbyclient');
    if (url.pathname === '/' && url.searchParams.has('mailbox_fixture')) {
      return route.fulfill({ status: 200, contentType: 'text/html', body: fixtureHtml(seed) });
    }
    if (url.pathname === '/modules/main-app/mailbox.js' || /^\/modules\/main-css\/[a-z-]+\.css$/.test(url.pathname)) return route.continue();
    return route.abort('blockedbyclient');
  });
  await page.goto('/?mailbox_fixture=1', { waitUntil: 'load' });
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  await expect(page.locator('.mailbox-entry')).toHaveCount(seed.length);
  await settleViewport(page);
}
const header = (page, id) => page.locator('.mailbox-item[data-message-id="' + id + '"]');
const expanded = page => page.locator('.mailbox-detail:not([hidden])');
// Wait for the latest render's actual final restore callback, not a fixed sleep.
const settleViewport = async page => {
  await expect.poll(() => page.evaluate(() => fixture.settledViewportToken === __viewportRestoreToken)).toBe(true);
};
async function activate(page, locator) {
  if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) await locator.tap();
  else await locator.click();
}
async function centerHeader(page, id) {
  const node = header(page, id);
  await node.evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
  return (await node.boundingBox()).y;
}
async function assertInline(page, id) {
  const button = header(page, id);
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(expanded(page)).toHaveCount(1);
  const structure = await button.evaluate(node => {
    const detail = node.nextElementSibling, entry = node.parentElement;
    return { tag: detail?.tagName, detailClass: detail?.classList.contains('mailbox-detail'),
      hidden: detail?.hidden, controls: node.getAttribute('aria-controls'), detailId: detail?.id,
      labelledby: detail?.getAttribute('aria-labelledby'), buttonId: node.id,
      entry: entry.classList.contains('mailbox-entry'), list: entry.parentElement.classList.contains('mailbox-list'),
      detailTop: detail?.getBoundingClientRect().top, buttonBottom: node.getBoundingClientRect().bottom };
  });
  expect(structure.tag).toBe('ARTICLE'); expect(structure.detailClass).toBe(true);
  expect(structure.hidden).toBe(false); expect(structure.entry).toBe(true); expect(structure.list).toBe(true);
  expect(structure.controls).toBe(structure.detailId); expect(structure.labelledby).toBe(structure.buttonId);
  expect(structure.detailTop).toBeGreaterThanOrEqual(structure.buttonBottom);
  expect(structure.detailTop - structure.buttonBottom).toBeLessThan(20);
}

for (const index of [0, 17, 35]) {
  test('message ' + index + ' opens directly under its header in a 36-message inbox', async ({ page }, testInfo) => {
    await openMailbox(page); const id = 'mail-' + index;
    const top = await centerHeader(page, id);
    await activate(page, header(page, id)); await assertInline(page, id);
    await expect(expanded(page)).toContainText('Body for message ' + index);
    await settleViewport(page);
    expect(Math.abs((await header(page, id).boundingBox()).y - top)).toBeLessThanOrEqual(2);
    if (index !== 35) {
      const screenshot = testInfo.outputPath('mailbox-inline-' + index + '.png');
      await page.screenshot({ path: screenshot });
      await testInfo.attach('Expanded mailbox row ' + index, { path: screenshot, contentType: 'image/png' });
    }
    const next = header(page, 'mail-' + (index + 1));
    if (index < 35) {
      const bounds = await expanded(page).boundingBox();
      expect((await next.boundingBox()).y).toBeGreaterThanOrEqual(bounds.y + bounds.height);
    }
  });
}

test('switching to a lower row keeps its header anchored when the previous tall body closes', async ({ page }) => {
  await openMailbox(page); await activate(page, header(page, 'mail-0')); await settleViewport(page);
  const top = await centerHeader(page, 'mail-17');
  await activate(page, header(page, 'mail-17')); await settleViewport(page);
  await assertInline(page, 'mail-17');
  await expect(header(page, 'mail-0')).toHaveAttribute('aria-expanded', 'false');
  expect(Math.abs((await header(page, 'mail-17').boundingBox()).y - top)).toBeLessThanOrEqual(2);
  await activate(page, header(page, 'mail-17')); await settleViewport(page);
  await expect(expanded(page)).toHaveCount(0);
  await expect(header(page, 'mail-17')).toHaveAttribute('aria-expanded', 'false');
  expect(Math.abs((await header(page, 'mail-17').boundingBox()).y - top)).toBeLessThanOrEqual(2);
});

test('native Enter and Space toggle once, preserve focus, and expose a visible focus indicator', async ({ page }) => {
  await openMailbox(page); const button = header(page, 'mail-17');
  await button.focus(); await page.keyboard.press('Enter'); await assertInline(page, 'mail-17');
  await expect(button).toBeFocused();
  const focus = await button.evaluate(node => ({ visible: node.matches(':focus-visible'), width: getComputedStyle(node).outlineWidth, style: getComputedStyle(node).outlineStyle }));
  expect(focus.visible).toBe(true); expect(parseFloat(focus.width)).toBeGreaterThan(0); expect(focus.style).not.toBe('none');
  await page.keyboard.press('Space'); await expect(expanded(page)).toHaveCount(0); await expect(button).toBeFocused();
  await page.keyboard.press('Space'); await assertInline(page, 'mail-17'); await expect(button).toBeFocused();
  await page.evaluate(() => render()); await expect(button).toBeFocused();
});

test('unread activation marks read once and keeps the same inline message and focus', async ({ page }) => {
  await openMailbox(page); const button = header(page, 'mail-5');
  await expect(button).toHaveClass(/unread/); await button.focus(); await page.keyboard.press('Enter');
  await expect(button).not.toHaveClass(/unread/); await assertInline(page, 'mail-5');
  await expect(button).toBeFocused();
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
  await assertInline(page, 'mail-5');
  expect(await page.evaluate(() => fixture.calls.filter(call => call.action === 'markRead').length)).toBe(1);
});

test('pending and failed refresh retain the body; reorder preserves selected ID, anchor and focus', async ({ page }) => {
  await openMailbox(page); const id = 'mail-17', button = header(page, id);
  await centerHeader(page, id); await button.focus(); await page.keyboard.press('Enter'); await settleViewport(page);
  const originalId = await button.getAttribute('id'), top = (await button.boundingBox()).y;
  await page.evaluate(() => { fixture.holdList = true; void fixture.refresh(); });
  await expect(page.locator('.mailbox-list')).toHaveAttribute('aria-busy', 'true');
  await assertInline(page, id); await expect(button).toBeFocused();
  await page.evaluate(() => fixture.rejectList());
  await expect(page.getByRole('alert')).toBeVisible(); await assertInline(page, id); await settleViewport(page);
  expect(Math.abs((await button.boundingBox()).y - top)).toBeLessThanOrEqual(2);
  await page.evaluate(() => { fixture.server.reverse(); void fixture.refresh(); });
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.mailbox-item').first()).toHaveAttribute('data-message-id', 'mail-35');
  await assertInline(page, id); await expect(button).toHaveAttribute('id', originalId); await expect(button).toBeFocused();
  await settleViewport(page);
  expect(Math.abs((await button.boundingBox()).y - top)).toBeLessThanOrEqual(2);
  await page.evaluate(() => { fixture.server = fixture.server.filter(message => message.id !== 'mail-17'); void fixture.refresh(); });
  await expect(button).toHaveCount(0); await expect(expanded(page)).toHaveCount(0);
  expect(await page.evaluate(() => BXHMailbox.mailboxContext().selectedId)).toBe('');
});

test('attachment and mocked reward actions stay inside the open message without toggling its header', async ({ page }) => {
  await openMailbox(page); await activate(page, header(page, 'mail-17'));
  const download = page.waitForEvent('download');
  await activate(page, page.locator('[data-action="mailbox-download-attachment"]'));
  expect((await download).suggestedFilename()).toBe('fixture.txt');
  await assertInline(page, 'mail-17');
  await activate(page, page.locator('[data-action="mailbox-title-reward"]'));
  await assertInline(page, 'mail-17');
  await activate(page, page.locator('[data-action="mailbox-card-reward"]'));
  await assertInline(page, 'mail-17');
  expect(await page.evaluate(() => fixture.calls.filter(call => call.action !== 'list').map(call => call.action))).toEqual(['download', 'fixtureTitleReward', 'fixtureCardReward']);
});

test('long subjects, senders, bodies and attachment filenames do not overflow mobile or desktop', async ({ page }) => {
  const seed = messages();
  seed[17].subject = 'VeryLongSubject'.repeat(35);
  seed[17].senderName = 'LongSenderWithoutWhitespace'.repeat(15);
  seed[17].body = '<script>unsafe</script>\nhttps://example.test/' + 'long-segment'.repeat(120);
  seed[17].attachments[0].name = 'LongFilename'.repeat(40) + '.pdf';
  await openMailbox(page, seed); await activate(page, header(page, 'mail-17'));
  await assertInline(page, 'mail-17');
  await expect(expanded(page).locator('script')).toHaveCount(0);
  await expect(expanded(page)).toContainText('<script>unsafe</script>');
  const overflow = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const nodes = [...document.querySelectorAll('.mailbox-list, .mailbox-entry, .mailbox-item, .mailbox-detail:not([hidden]), .mailbox-body, .mailbox-attachments, .mailbox-attachments button')];
    return { viewport, document: document.documentElement.scrollWidth,
      nodes: nodes.map(node => ({ className: node.className, left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right, scroll: node.scrollWidth, client: node.clientWidth })) };
  });
  expect(overflow.document).toBeLessThanOrEqual(overflow.viewport + 1);
  for (const node of overflow.nodes) {
    expect(node.left, node.className).toBeGreaterThanOrEqual(-1);
    expect(node.right, node.className).toBeLessThanOrEqual(overflow.viewport + 1);
    expect(node.scroll, node.className).toBeLessThanOrEqual(node.client + 1);
  }
});

test('all controls resolve to unique labelled detail regions, including punctuation and Unicode IDs', async ({ page }) => {
  const ids = ['mail-0', 'a b', 'a-b', 'a_b', 'a/b', 'a?b', '訊息😀', 'x" onclick="bad', '<script>'];
  const seed = messages(); ids.forEach((id, index) => { seed[index].id = id; });
  await openMailbox(page, seed);
  const semantics = await page.locator('.mailbox-item').evaluateAll(nodes => nodes.map(node => {
    const detail = document.getElementById(node.getAttribute('aria-controls'));
    return { id: node.id, detailId: detail?.id, labelledby: detail?.getAttribute('aria-labelledby'),
      hidden: detail?.hidden, adjacent: node.nextElementSibling === detail, nestedInteractive: !!node.querySelector('button, a, input') };
  }));
  expect(new Set(semantics.flatMap(item => [item.id, item.detailId])).size).toBe(72);
  for (const item of semantics) {
    expect(item.id).toBeTruthy(); expect(item.detailId).toBeTruthy(); expect(item.labelledby).toBe(item.id);
    expect(item.hidden).toBe(true); expect(item.adjacent).toBe(true); expect(item.nestedInteractive).toBe(false);
  }
});

test('registration invitation extension appears in the selected visible row and leaves ordinary rows untouched', async ({ page }) => {
  const seed = messages();
  Object.assign(seed[17], { type: 'tournament_invitation', eventCode: 'BXH-INVITE', invitationStatus: 'pending', eventName: 'Fixture tournament' });
  await openMailbox(page, seed);
  await activate(page, header(page, 'mail-17')); await assertInline(page, 'mail-17');
  const invitation = page.locator('#mailbox-invitation-actions');
  await expect(invitation).toHaveCount(1);
  await expect(expanded(page).locator('#mailbox-invitation-actions')).toHaveCount(1);
  await expect(invitation.locator('[data-invite="accept"]')).toBeVisible();
  await expect(invitation.locator('[data-invite="decline"]')).toBeVisible();
  await expect(invitation).toContainText('Fixture tournament');
  expect(await invitation.evaluate(node => !!node.closest('[hidden]'))).toBe(false);
  await expect(page.locator('.mailbox-layout article.panel')).toHaveCount(1);
  await page.evaluate(() => mailboxInvitationPanel());
  await expect(invitation).toHaveCount(1);
  await activate(page, header(page, 'mail-17'));
  await expect(invitation).toHaveCount(0); await expect(expanded(page)).toHaveCount(0);
  await settleViewport(page);
  await activate(page, header(page, 'mail-0'));
  await expect(invitation).toHaveCount(0); await assertInline(page, 'mail-0');
});
