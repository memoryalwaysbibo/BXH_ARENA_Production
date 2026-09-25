'use strict';
// Runs the actual classic-script handlers in isolated browser-like contexts.
// No Firebase connection, account login or production inventory writes.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(process.env.INVENTORY_UI_SOURCE || path.join(__dirname, '..', 'inventory-ui.js'), 'utf8');

function setup({ admin = true, auth = true, confirmResult = true, pending = null, failFirst = false } = {}) {
  const storage = new Map();
  if (pending) storage.set('bxh.inventory.pending.v1:admin-uid', JSON.stringify(pending));
  const grants = [], confirmations = [];
  const listeners = {};
  let operations = 0;
  const sandbox = {
    currentAuthUid: () => auth ? 'admin-uid' : '', engagementSessionEpoch: 1, isSuperAdmin: () => admin,
    render() {}, loadMailbox: async () => {}, setTimeout() {}, URL, Date,
    esc: value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    mailboxDate: value => String(value), titleRecipientLabel: user => user.name,
    confirm: text => { confirmations.push(text); return confirmResult; },
    crypto: { randomUUID: () => `grant-operation-${++operations}` },
    sessionStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key)
    },
    document: {
      addEventListener(type, fn, options) { (listeners[type] ||= []).push({ fn, capture: options === true || options?.capture === true }); },
      querySelector: () => ({}), querySelectorAll: () => [], getElementById: () => null
    },
    window: { engagementService: { inventory: async payload => {
      if (payload.action === 'grant') {
        grants.push(JSON.parse(JSON.stringify(payload)));
        if (failFirst && grants.length === 1) throw new Error('network-timeout');
        return { ok: true, replayed: grants.length > 1 };
      }
      return { ok: true, items: [], nextCursor: null, serverNow: Date.now() };
    } } }
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'inventory-ui.js' });
  const state = sandbox.inventoryContext();
  state.items = [];
  const fill = () => {
    state.recipient = { uid: 'player-uid', name: '測試玩家' };
    Object.assign(state.draft, { itemCode: 'bxh-test-raffle-ticket', name: 'BXH 測試抽獎券', quantity: '3', purpose: '扣券流程測試', source: '隔離回歸測試' });
  };
  const check = checked => sandbox.inventoryCaptureInput({ target: {
    getAttribute: key => key === 'data-inventory-field' ? 'consumable' : null,
    checked, value: 'on'
  } });
  const checkbox = () => sandbox.renderLegacyInventoryAdminPage().match(/<input id="inventory-consumable"[^>]*>/)?.[0];
  const click = async action => {
    const target = {
      getAttribute: key => key === 'data-action' ? action : null,
      closest: selector => selector === '[data-action^="inventory-"]' ? target : null
    };
    const event = {
      target, prevented: false, stopped: false, immediateStopped: false,
      preventDefault() { this.prevented = true; },
      stopPropagation() { this.stopped = true; },
      stopImmediatePropagation() { this.immediateStopped = true; }
    };
    await sandbox.inventoryClickCapture(event);
    return event;
  };
  return { sandbox, state, fill, check, checkbox, click, listeners, grants, confirmations, storage };
}

test('new grants default to non-consumable and explain existing lots are unchanged', () => {
  const t = setup();
  assert.equal(t.state.draft.consumable, false);
  assert.doesNotMatch(t.checkbox(), /\bchecked\b/);
  assert.match(t.sandbox.renderLegacyInventoryAdminPage(), /不會修改既有道具/);
});

test('player inventory is identical for administrators and regular players', () => {
  const admin = setup({ admin: true }), player = setup({ admin: false });
  assert.equal(admin.sandbox.renderInventoryPage(), player.sandbox.renderInventoryPage());
  assert.doesNotMatch(admin.sandbox.renderInventoryPage(), /最高管理員｜發放道具|inventory-grant|renderRewardRulesAdmin/);
  assert.match(admin.sandbox.renderLegacyInventoryAdminPage(), /最高管理員｜發放道具/);
  assert.doesNotMatch(player.sandbox.renderLegacyInventoryAdminPage(), /inventory-grant/);
});

test('checkbox uses a strict boolean rather than the string input value', () => {
  const t = setup();
  t.check(true); assert.equal(t.state.draft.consumable, true);
  assert.match(t.checkbox(), /\bchecked\b/);
  t.check(false); assert.equal(t.state.draft.consumable, false);
  t.check('true'); assert.equal(t.state.draft.consumable, false);
});

test('checked grants send consumable=true and show the flag before confirmation', async () => {
  const t = setup(); t.fill(); t.check(true);
  await t.sandbox.handleInventory('inventory-grant');
  assert.equal(t.grants.length, 1);
  assert.equal(t.grants[0].consumable, true);
  assert.equal(t.grants[0].quantity, 3);
  assert.match(t.confirmations[0], /使用方式：可消耗（活動使用時會扣除數量）/);
  assert.equal(t.state.pending, null);
  assert.equal(t.state.draft.consumable, false, 'each new grant starts safe');
});

test('unchecked grants explicitly send false', async () => {
  const t = setup(); t.fill();
  await t.sandbox.handleInventory('inventory-grant');
  assert.equal(t.grants[0].consumable, false);
  assert.match(t.confirmations[0], /使用方式：不可消耗/);
});

test('truthy strings cannot opt a grant into consumption', async () => {
  const t = setup(); t.fill(); t.state.draft.consumable = 'false';
  await t.sandbox.handleInventory('inventory-grant');
  assert.equal(t.grants[0].consumable, false);
});

test('cancelling creates no pending request and makes no grant call', async () => {
  const t = setup({ confirmResult: false }); t.fill(); t.check(true);
  await t.sandbox.handleInventory('inventory-grant');
  assert.equal(t.grants.length, 0);
  assert.equal(t.state.pending, null);
  assert.equal(t.storage.size, 0);
});

test('network retry keeps the exact operation and boolean without a new confirmation', async () => {
  const t = setup({ failFirst: true }); t.fill(); t.check(true);
  await t.sandbox.handleInventory('inventory-grant');
  assert.ok(t.state.pending);
  assert.match(t.checkbox(), /\bdisabled\b/);
  t.check(false); assert.equal(t.state.draft.consumable, true, 'pending form is locked');
  await t.sandbox.handleInventory('inventory-grant');
  assert.equal(t.grants.length, 2);
  assert.deepEqual(t.grants[1], t.grants[0]);
  assert.equal(t.confirmations.length, 1);
});

test('reload restores the confirmed payload, not a conflicting saved draft', async () => {
  const t = setup({ pending: {
    actorUid: 'admin-uid', recipient: { uid: 'player-uid', name: '測試玩家' },
    draft: { consumable: false },
    payload: { action: 'grant', targetUid: 'player-uid', consumable: true, operationId: 'existing-operation' }
  } });
  assert.match(t.checkbox(), /\bchecked\b/);
  assert.match(t.checkbox(), /\bdisabled\b/);
  await t.sandbox.handleInventory('inventory-grant');
  assert.equal(t.grants[0].consumable, true);
  assert.equal(t.grants[0].operationId, 'existing-operation');
  assert.equal(t.confirmations.length, 0);
});

test('legacy pending requests are not silently upgraded or rewritten', async () => {
  const payload = { action: 'grant', targetUid: 'player-uid', operationId: 'legacy-operation' };
  const t = setup({ pending: { actorUid: 'admin-uid', draft: { consumable: true }, payload } });
  assert.doesNotMatch(t.checkbox(), /\bchecked\b/);
  await t.sandbox.handleInventory('inventory-grant');
  assert.deepEqual(t.grants[0], payload);
  assert.equal(Object.hasOwn(t.grants[0], 'consumable'), false);
});

test('non-admins cannot see or submit the grant option', async () => {
  const t = setup({ admin: false }); t.fill(); t.check(true);
  assert.equal(t.checkbox(), undefined);
  assert.equal(t.state.draft.consumable, false);
  await t.sandbox.handleInventory('inventory-grant');
  assert.equal(t.grants.length, 0);
});

test('busy form prevents edits and duplicate submissions', async () => {
  const t = setup(); t.fill(); t.state.busy = true;
  assert.match(t.checkbox(), /\bdisabled\b/);
  t.check(true);
  assert.equal(t.state.draft.consumable, false);
  await t.sandbox.handleInventory('inventory-grant');
  assert.equal(t.grants.length, 0);
});

test('item cards distinguish explicit consumable metadata from legacy or string values', () => {
  const t = setup();
  const item = { id: 'lot', name: '券', quantity: 3, expiresAt: null, createdAt: 1 };
  t.state.items = [item];
  assert.match(t.sandbox.renderInventoryPage(), /持有中 · 不可消耗/);
  item.consumable = 'true';
  assert.match(t.sandbox.renderInventoryPage(), /持有中 · 不可消耗/);
  item.consumable = true;
  assert.match(t.sandbox.renderInventoryPage(), /持有中 · 可消耗/);
});


test('captured inventory click owns the action route and submits exactly once', async () => {
  const t = setup(); t.fill(); t.check(true);
  const event = await t.click('inventory-grant');
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  assert.equal(event.immediateStopped, true);
  assert.equal(t.grants.length, 1);
  assert.equal(t.grants[0].consumable, true);
});

test('grant click with missing auth never fails silently', async () => {
  const t = setup({ auth: false });
  await t.click('inventory-grant');
  assert.match(t.state.error, /登入狀態已失效/);
  assert.equal(t.grants.length, 0);
});

test('grant click while inventory is loading returns visible feedback', async () => {
  const t = setup(); t.state.loading = true;
  await t.click('inventory-grant');
  assert.match(t.state.error, /仍在載入/);
  assert.equal(t.grants.length, 0);
});

test('invalid grant reached through the click router returns visible validation feedback', async () => {
  const t = setup();
  await t.click('inventory-grant');
  assert.match(t.state.error, /請重新搜尋並選擇玩家/);
  assert.equal(t.grants.length, 0);
});
