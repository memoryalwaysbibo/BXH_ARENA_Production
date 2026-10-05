'use strict';
// The shipped mailbox feature in a network-free VM. All service calls are mocks.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'modules/main-app/mailbox.js'), 'utf8');
const core = fs.readFileSync(path.join(root, 'modules/main-app/core.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function message(index, extra = {}) {
  return { id: 'mail-' + index, subject: 'Message ' + index, body: 'Body ' + index,
    senderName: 'Fixture sender', createdAt: 1, readAt: 1, attachments: [], ...extra };
}
function setup(messages = Array.from({ length: 36 }, (_, index) => message(index))) {
  const calls = [], renders = [];
  let server = clone(messages), list = async () => ({ ok: true, messages: clone(server), unreadCount: server.filter(item => !item.readAt).length });
  const sandbox = {
    firebaseUser: { uid: 'mailbox-fixture-user' }, engagementSessionEpoch: 1,
    currentAuthUid: () => sandbox.firebaseUser?.uid || '', accountMenuOpen: false,
    crypto: { randomUUID }, console, setTimeout, clearTimeout,
    esc: value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    isSuperAdmin: () => false, mailboxDate: () => '2026/10/05', showToast() {},
    document: { activeElement: null, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    window: { engagementService: {} },
    render() { renders.push(sandbox.window.BXHMailbox.renderMailboxPage()); }
  };
  let mark = async payload => {
    const item = server.find(item => item.id === payload.messageId);
    assert.ok(item, 'mock message exists');
    item.readAt = payload.action === 'markRead' ? 1 : null;
    return { ok: true };
  };
  sandbox.window.engagementService.mailbox = async payload => {
    calls.push(clone(payload));
    if (payload.action === 'list') return list();
    assert.ok(['markRead', 'markUnread'].includes(payload.action), 'Unexpected service mutation: ' + payload.action);
    return mark(payload);
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'mailbox.js' });
  const api = sandbox.window.BXHMailbox, state = api.mailboxContext();
  Object.assign(state, { open: true, messages: clone(messages), unreadCount: messages.filter(item => !item.readAt).length });
  const target = (id, extra = {}) => ({ getAttribute: name => ({ 'data-message-id': id, ...extra })[name] ?? null });
  return { api, state, calls, renders, sandbox, target,
    view: () => api.renderMailboxPage(),
    select: id => api.handleMailbox('mailbox-select', target(id)),
    refresh: () => api.handleMailbox('mailbox-refresh', target('')),
    list: fn => { list = fn; }, mark: fn => { mark = fn; }, server: next => { server = clone(next); }
  };
}
function headers(html) {
  return [...html.matchAll(/<button\b([^>]*\bclass="[^"]*\bmailbox-item\b[^"]*"[^>]*)>[\s\S]*?<\/button>\s*<article\b([^>]*)>/g)].map(match => {
    const attr = (text, name) => text.match(new RegExp('(?:^|\\s)' + name + '="([^"]*)"'))?.[1];
    return { id: attr(match[1], 'data-message-id'), expanded: attr(match[1], 'aria-expanded'),
      controls: attr(match[1], 'aria-controls'), headerId: attr(match[1], 'id'),
      detailId: attr(match[2], 'id'), labelledby: attr(match[2], 'aria-labelledby'),
      hidden: /(?:^|\s)hidden(?:\s|=|$)/.test(match[2]), index: match.index };
  });
}

test('36 messages have stable, unique accessible sibling detail regions, initially collapsed', () => {
  const t = setup(), html = t.view(), rows = headers(html);
  assert.equal((html.match(/class="mailbox-entry\b/g) || []).length, 36);
  assert.equal(rows.length, 36, 'each header must be immediately followed by its detail article');
  assert.equal(new Set(rows.flatMap(row => [row.headerId, row.detailId])).size, 72);
  for (const row of rows) {
    assert.ok(row.headerId && row.detailId);
    assert.equal(row.controls, row.detailId);
    assert.equal(row.labelledby, row.headerId);
    assert.equal(row.expanded, 'false');
    assert.equal(row.hidden, true);
  }
  assert.doesNotMatch(html, /Body \d/);
});

for (const index of [0, 17, 35]) {
  test('message ' + index + ' expands immediately under its own header in a 36-message list', async () => {
    const t = setup(); await t.select('mail-' + index);
    const html = t.view(), rows = headers(html);
    assert.equal(t.state.selectedId, 'mail-' + index);
    assert.equal(rows.filter(row => row.expanded === 'true').length, 1);
    assert.equal(rows.filter(row => !row.hidden).length, 1);
    assert.equal(rows[index].expanded, 'true');
    const bodyAt = html.indexOf('Body ' + index);
    assert.ok(bodyAt > rows[index].index);
    if (index < rows.length - 1) assert.ok(bodyAt < rows[index + 1].index, 'body precedes the following message header');
    assert.equal(t.calls.length, 0, 'opening an already-read message does not write');
  });
}

test('switching opens one message, activating it again collapses, and reopening remains possible', async () => {
  const t = setup(); await t.select('mail-0'); await t.select('mail-17');
  assert.equal(t.state.selectedId, 'mail-17');
  assert.doesNotMatch(t.view(), /Body 0</);
  await t.select('mail-17');
  assert.equal(t.state.selectedId, '');
  assert.equal(headers(t.view()).filter(row => !row.hidden).length, 0);
  await t.select('mail-17');
  assert.equal(t.state.selectedId, 'mail-17');
});

test('IDs remain stable after reorder and are collision-free for punctuation, Unicode and HTML-sensitive IDs', async () => {
  const ids = ['a b', 'a-b', 'a_b', 'a/b', 'a?b', 'a%20b', '訊息😀', 'x" onclick="bad', '<script>'];
  const t = setup(ids.map((id, index) => message(index, { id })));
  const before = headers(t.view());
  assert.equal(new Set(before.flatMap(row => [row.headerId, row.detailId])).size, ids.length * 2);
  assert.ok(before.every(row => /^[A-Za-z][A-Za-z0-9_-]*$/.test(row.detailId)));
  await t.select(ids[6]);
  t.state.messages.reverse();
  const after = headers(t.view());
  for (const row of before) {
    const found = after.find(candidate => candidate.id === row.id);
    assert.equal(found.headerId, row.headerId); assert.equal(found.detailId, row.detailId);
  }
  assert.doesNotMatch(t.view(), /<script>| onclick="bad/);
});

test('refresh keeps the cached selected body while loading and after failure; retry retains selection', async () => {
  const t = setup(); await t.select('mail-17');
  const cached = t.state.messages, pending = deferred(); t.list(() => pending.promise);
  await t.refresh();
  assert.equal(t.state.loading, true); assert.equal(t.state.messages, cached);
  assert.equal(t.state.selectedId, 'mail-17'); assert.match(t.view(), /Body 17/);
  pending.reject(Error('offline')); await tick();
  assert.equal(t.state.loading, false); assert.equal(t.state.messages, cached);
  assert.equal(t.state.selectedId, 'mail-17'); assert.match(t.view(), /Body 17/);
  assert.match(t.view(), /role="alert"/);
  t.list(async () => ({ ok: true, messages: clone(cached).reverse(), unreadCount: 0 }));
  await t.refresh(); await tick();
  assert.equal(t.state.selectedId, 'mail-17'); assert.equal(t.state.error, '');
  assert.match(t.view(), /Body 17/);
});

test('a successful refresh clears a missing selection and renders empty mailbox normally', async () => {
  const t = setup(); await t.select('mail-17');
  t.list(async () => ({ ok: true, messages: [], unreadCount: 0 }));
  await t.refresh(); await tick();
  assert.equal(t.state.selectedId, ''); assert.equal(t.state.messages.length, 0);
  assert.doesNotMatch(t.view(), /Body 17/); assert.match(t.view(), /目前沒有站內信/);
});

test('opening unread mail uses the existing mark-read flow once, without collapsing on its rerenders', async () => {
  const t = setup([message(0, { readAt: null })]);
  await t.select('mail-0'); await tick();
  assert.equal(t.calls.filter(call => call.action === 'markRead').length, 1);
  assert.equal(t.state.selectedId, 'mail-0'); assert.ok(t.state.messages[0].readAt);
  assert.equal(t.state.unreadCount, 0); assert.match(t.view(), /Body 0/);
  await t.select('mail-0'); await t.select('mail-0'); await tick();
  assert.equal(t.calls.filter(call => call.action === 'markRead').length, 1);
  assert.equal(t.state.selectedId, 'mail-0');
});

test('body escaping and all existing attachment, title, card and invitation controls survive inline rendering', async () => {
  const t = setup([message(0, { body: '<img src=x onerror=bad>\nnext line', eventCode: 'EVENT', invitationStatus: 'invited',
    attachments: [{ id: 'pdf', name: 'Rules <final>.pdf', size: 2048 }, { id: 'virtual', name: 'Virtual pack', size: 1 }] })]);
  t.sandbox.window.BXHTitleRewardUI = { card: () => '<button data-action="mailbox-title-reward">Title reward</button>' };
  t.sandbox.window.BXHCardRewardUI = { bodyText: item => item.body, card: () => '<button data-action="mailbox-card-reward">Card reward</button>',
    isVirtualAttachment: (item, attachment) => attachment.id === 'virtual' };
  await t.select('mail-0'); const html = t.view();
  assert.match(html, /&lt;img src=x onerror=bad&gt;\nnext line/);
  assert.doesNotMatch(html, /<img src=x/);
  for (const action of ['mailbox-title-reward', 'mailbox-card-reward', 'mailbox-download-attachment', 'mailbox-event-staff-respond', 'mailbox-toggle-read']) assert.ok(html.includes('data-action="' + action + '"'));
  assert.equal((html.match(/data-action="mailbox-download-attachment"/g) || []).length, 1);
  assert.match(html, /Rules &lt;final&gt;\.pdf \(2 KB\)/);
  t.state.messages[0] = message(0, { id: 'partner_ORDER', orderCode: 'ORDER' }); t.state.selectedId = 'partner_ORDER';
  assert.match(t.view(), /data-action="mailbox-open-contract"/);
});

test('late reward details do not reopen a collapsed message', async () => {
  const t = setup([message(0, { type: 'card_reward' })]), pending = deferred();
  t.sandbox.window.engagementService.getCardRewardMessage = () => pending.promise;
  await t.select('mail-0'); await t.select('mail-0');
  pending.resolve({ ok: true, message: { reward: { kind: 'card' } } }); await tick();
  assert.equal(t.state.selectedId, '');
  assert.equal(headers(t.view()).filter(row => !row.hidden).length, 0);
});

test('a late refresh from an earlier session cannot leak cached mail into the next account', async () => {
  const t = setup(), pending = deferred(); t.list(() => pending.promise);
  await t.refresh(); t.sandbox.firebaseUser = { uid: 'different-fixture-user' }; t.sandbox.engagementSessionEpoch++;
  const nextState = t.api.mailboxContext();
  pending.resolve({ ok: true, messages: [message(99)], unreadCount: 1 }); await tick();
  assert.equal(nextState.messages, null); assert.equal(nextState.selectedId, ''); assert.equal(nextState.error, '');
});

test('core render viewport calls the mailbox capture and restore hooks', () => {
  const start = core.indexOf('function captureRenderViewport()'), end = core.indexOf('function render(){', start);
  assert.ok(start >= 0 && end > start);
  const viewportSource = core.slice(start, end);
  assert.match(viewportSource, /BXHMailbox\?\.captureViewport\?\.\(/);
  assert.match(viewportSource, /BXHMailbox\?\.restoreViewport\?\.\(/);
  const t = setup();
  assert.equal(typeof t.api.captureViewport, 'function'); assert.equal(typeof t.api.restoreViewport, 'function');
});

test('viewport uses the clicked header, restores its offset and focused control after full replacement', async () => {
  const t = setup(), body = {}, focused = [], scrolls = [];
  let headerDocumentY = 1600;
  t.state.selectedId = 'mail-0';
  t.sandbox.window.scrollY = 1200; t.sandbox.window.scrollX = 0;
  t.sandbox.window.scrollTo = ({ top }) => { t.sandbox.window.scrollY = top; scrolls.push(top); };
  const attributes = { 'data-action': 'mailbox-select', 'data-message-id': 'mail-17', 'data-attachment-id': null, 'data-response': null };
  const anchor = { getBoundingClientRect: () => ({ top: headerDocumentY - t.sandbox.window.scrollY }),
    getAttribute: name => attributes[name] ?? null,
    closest: () => ({}), matches: () => true,
    focus: options => { focused.push(clone(options)); t.sandbox.document.activeElement = anchor; } };
  t.sandbox.document.body = body; t.sandbox.document.activeElement = anchor;
  const clickedHeaderId = headers(t.view()).find(row => row.id === 'mail-17').headerId;
  t.sandbox.document.getElementById = id => id === clickedHeaderId ? anchor : null;
  t.sandbox.document.querySelectorAll = () => [anchor];
  t.state.viewportAnchorId = 'mail-17';
  const snapshot = t.api.captureViewport();
  assert.equal(snapshot.id, 'mail-17'); assert.equal(snapshot.top, 400);
  assert.equal(t.state.viewportAnchorId, undefined, 'one-render click anchor is consumed');
  headerDocumentY -= 600; // Previous expanded body disappears above clicked row.
  t.sandbox.document.activeElement = body;
  assert.equal(t.api.restoreViewport(snapshot), true);
  assert.equal(anchor.getBoundingClientRect().top, 400);
  assert.deepEqual(scrolls, [600]); assert.deepEqual(focused, [{ preventScroll: true }]);
  t.api.restoreViewport(snapshot);
  assert.equal(focused.length, 1, 'delayed restorations do not repeatedly steal focus');
  assert.equal(scrolls.length, 1, 'restoration is idempotent');
});

test('viewport refuses stale sessions and missing anchors, and does not steal a newer focus target', () => {
  const t = setup(), body = {}, newerFocus = {}, focused = [];
  t.state.selectedId = 'mail-17';
  const attributes = { 'data-action': 'mailbox-select', 'data-message-id': 'mail-17' };
  const anchor = { getBoundingClientRect: () => ({ top: 100 }), getAttribute: name => attributes[name] ?? null,
    closest: () => ({}), matches: () => true, focus: () => focused.push(true) };
  t.sandbox.document.body = body; t.sandbox.document.activeElement = anchor;
  t.sandbox.document.getElementById = () => anchor; t.sandbox.document.querySelectorAll = () => [anchor];
  const snapshot = t.api.captureViewport();
  t.sandbox.document.activeElement = newerFocus;
  assert.equal(t.api.restoreViewport(snapshot), true); assert.equal(focused.length, 0);
  t.sandbox.document.getElementById = () => null;
  assert.equal(t.api.restoreViewport(snapshot), false);
  t.sandbox.engagementSessionEpoch++;
  assert.equal(t.api.restoreViewport(snapshot), false);
  assert.equal(t.api.restoreViewport(null), false);
});

for (const order of ['mark-read-first', 'old-list-first', 'same-turn-old-list-first', 'same-turn-mark-read-first']) {
  test('unread/list race ' + order + ' performs one mark and one authoritative queued refresh', async () => {
    const t = setup([message(0, { readAt: null })]);
    const oldList = deferred(), freshList = deferred(), markRead = deferred();
    let listCalls = 0;
    t.list(() => (++listCalls === 1 ? oldList.promise : freshList.promise));
    t.mark(() => markRead.promise);
    const initialLoad = t.api.loadMailbox(true);
    await t.select('mail-0'); await tick();
    assert.equal(t.state.loading, true); assert.equal(t.state.busy, true);
    assert.equal(t.state.selectedId, 'mail-0');
    const oldResult = { ok: true, messages: [message(0, { readAt: null, body: 'Old list body' })], unreadCount: 1 };
    if (order.startsWith('same-turn')) {
      if (order === 'same-turn-old-list-first') { oldList.resolve(oldResult); markRead.resolve({ ok: true }); }
      else { markRead.resolve({ ok: true }); oldList.resolve(oldResult); }
      await tick();
    } else if (order === 'mark-read-first') {
      markRead.resolve({ ok: true }); await tick();
      assert.equal(t.state.reloadRequested, true);
      assert.equal(t.state.busy, true);
      assert.equal(listCalls, 1, 'fresh list waits until the older request drains');
      oldList.resolve(oldResult); await tick();
      assert.ok(!t.renders.some(html => html.includes('Old list body')), 'queued refresh discards the obsolete list');
    } else {
      oldList.resolve(oldResult); await tick();
      assert.equal(t.state.loading, false);
      assert.equal(t.state.busy, true, 'pending mutation still blocks another auto-mark');
      markRead.resolve({ ok: true }); await tick();
    }
    assert.equal(listCalls, 2);
    assert.equal(t.state.loading, true); assert.equal(t.state.busy, true);
    await t.select('mail-0'); await t.select('mail-0');
    assert.equal(t.state.selectedId, 'mail-0', 'busy activation cannot close/reopen and repeat auto-mark');
    assert.equal(t.calls.filter(call => call.action === 'markRead').length, 1);
    freshList.resolve({ ok: true, messages: [message(0, { readAt: 42 })], unreadCount: 0 });
    await initialLoad; await tick();
    assert.equal(t.state.loading, false); assert.equal(t.state.busy, false);
    assert.equal(t.state.selectedId, 'mail-0'); assert.equal(t.state.messages[0].readAt, 42);
    assert.equal(t.state.unreadCount, 0); assert.equal(listCalls, 2);
    await t.select('mail-0'); await t.select('mail-0'); await tick();
    assert.equal(t.calls.filter(call => call.action === 'markRead').length, 1);
    assert.equal(listCalls, 2);
  });
}

test('several forced refreshes coalesce to one fresh list and never paint the obsolete response', async () => {
  const t = setup(), oldList = deferred(), freshList = deferred(); let count = 0;
  await t.select('mail-17');
  t.list(() => (++count === 1 ? oldList.promise : freshList.promise));
  const first = t.api.loadMailbox(true), second = t.api.loadMailbox(true), third = t.api.loadMailbox(true);
  assert.equal(count, 1);
  oldList.resolve({ ok: true, messages: [], unreadCount: 0 }); await tick();
  assert.equal(count, 2); assert.equal(t.state.selectedId, 'mail-17'); assert.equal(t.state.messages.length, 36);
  freshList.resolve({ ok: true, messages: [message(17, { readAt: 42 })], unreadCount: 0 });
  await Promise.all([first, second, third]); await tick();
  assert.equal(count, 2); assert.equal(t.state.selectedId, 'mail-17'); assert.equal(t.state.messages[0].readAt, 42);
});

for (const invalidate of ['different-account', 'same-account-new-session']) {
  test('queued list does not leak or refetch after ' + invalidate, async () => {
    const t = setup(), oldList = deferred(), newList = deferred(); let count = 0;
    t.list(() => (++count === 1 ? oldList.promise : newList.promise));
    const first = t.api.loadMailbox(true), queued = t.api.loadMailbox(true);
    assert.equal(t.state.reloadRequested, true); assert.equal(count, 1);
    if (invalidate === 'different-account') t.sandbox.firebaseUser = { uid: 'next-account' };
    t.sandbox.engagementSessionEpoch++;
    const current = t.api.mailboxContext(), latest = t.api.loadMailbox(true);
    assert.equal(count, 2); assert.equal(current.loading, true);
    oldList.resolve({ ok: true, messages: [message(99, { body: 'Obsolete private mail' })], unreadCount: 1 });
    await Promise.all([first, queued]); await tick();
    assert.equal(count, 2, 'obsolete session must not start its queued refetch');
    assert.equal(current.messages, null); assert.equal(current.selectedId, '');
    assert.equal(current.loading, true); assert.equal(current.error, '');
    assert.ok(!t.renders.some(html => html.includes('Obsolete private mail')));
    newList.resolve({ ok: true, messages: [message(1)], unreadCount: 0 }); await latest;
    assert.equal(current.messages[0].id, 'mail-1'); assert.equal(current.loading, false);
  });
}

test('real registration invitation extension mounts controls in the selected visible article only', async () => {
  const t = setup(Array.from({ length: 36 }, (_, index) => message(index, index === 17 ? {
    type: 'tournament_invitation', eventCode: 'BXH-INVITE', invitationStatus: 'pending', eventName: 'Fixture tournament'
  } : {})));
  const extension = fs.readFileSync(path.join(root, 'registration-invitations-ui.js'), 'utf8');
  const start = extension.indexOf('function mailboxInvitationPanel(){'), end = extension.indexOf('async function mine(', start);
  assert.ok(start >= 0 && end > start);
  let articles = [], nodes = new Map();
  const resetDom = () => {
    nodes = new Map();
    articles = [...t.view().matchAll(/<article\b([^>]*)>/g)].map(match => {
      const attrs = match[1], node = { id: attrs.match(/\bid="([^"]+)"/)[1],
        className: attrs.match(/\bclass="([^"]+)"/)[1], hidden: /\shidden(?:\s|$)/.test(attrs),
        children: [], appendChild(child) { this.children.push(child); child.parent = this; nodes.set(child.id, child); } };
      nodes.set(node.id, node); return node;
    });
  };
  t.sandbox.runtime = () => ({ mailbox: () => t.state }); t.sandbox.mineRows = [];
  t.sandbox.document.getElementById = id => nodes.get(id) || null;
  t.sandbox.document.querySelector = selector => {
    assert.equal(selector, '.mailbox-layout article.panel');
    return articles.find(node => node.className.split(/\s+/).includes('panel')) || null;
  };
  t.sandbox.document.createElement = () => ({ style: {}, dataset: {}, innerHTML: '', remove() { nodes.delete(this.id); } });
  vm.runInContext(extension.slice(start, end), t.sandbox, { filename: 'mailbox-invitation-panel.js' });
  await t.select('mail-17'); resetDom();
  t.sandbox.mailboxInvitationPanel();
  const panel = nodes.get('mailbox-invitation-actions');
  assert.ok(panel); assert.equal(panel.parent.id, headers(t.view()).find(row => row.id === 'mail-17').detailId);
  assert.equal(panel.parent.hidden, false); assert.equal(articles.filter(node => node.className.split(/\s+/).includes('panel')).length, 1);
  assert.match(panel.innerHTML, /data-invite="accept"/); assert.match(panel.innerHTML, /data-invite="decline"/);
  t.sandbox.mailboxInvitationPanel(); assert.equal(panel.parent.children.length, 1, 'repeat extension tick does not duplicate controls');
  await t.select('mail-17'); resetDom(); t.sandbox.mailboxInvitationPanel();
  assert.equal(nodes.has('mailbox-invitation-actions'), false, 'collapse removes invitation controls');
  await t.select('mail-0'); resetDom(); t.sandbox.mailboxInvitationPanel();
  assert.equal(nodes.has('mailbox-invitation-actions'), false, 'ordinary mail never inherits invitation controls');
});
