'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const view = require('../group-history/view.js');
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
class Node {
  constructor(mode = 'preview', code = 'BXH-ABC123') { this.dataset = { groupHistoryMode: mode, code, auto: String(mode !== 'own') }; this.isConnected = true; this.innerHTML = ''; this.listeners = new Map(); }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  removeEventListener(type, fn) { if (this.listeners.get(type) === fn) this.listeners.delete(type); }
  querySelector() { return { focus() {} }; }
  contains() { return true; }
  event(type, target) { target.closest = () => target; this.listeners.get(type)?.({ target, preventDefault() {} }); }
  click(dataset) { this.event('click', { dataset }); }
  input(value) { this.event('input', { name: 'parentCode', value }); }
  submit() { this.event('submit', { matches: () => true }); }
}
function setup() {
  const timers = new Map(), events = new Map(); let timerId = 0;
  const c = vm.createContext({ BXHGroupHistoryView: view, setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id), addEventListener: (type, fn) => events.set(type, fn) });
  vm.runInContext(fs.readFileSync('group-history/integration.js', 'utf8'), c);
  const h = { api: c.BXHGroupHistory, session: { uid: 'account', epoch: 1 }, calls: [], pending: [], timers, events, node: new Node(), scope: 'bracket', mineCalls: [] };
  h.request = payload => { h.calls.push({ ...payload }); return new Promise((resolve, reject) => h.pending.push({ resolve, reject })); };
  h.mine = async payload => { h.mineCalls.push({ ...payload }); return { rows: [{ status: 'confirmed' }] }; };
  h.bind = () => h.api.bind(h.node, { getSession: () => h.session, getScope: () => h.scope, request: h.request, mine: h.mine, parentCodes: Array.from({ length: 30 }, (_, i) => 'BXH-' + String(i).padStart(6, '0')) });
  h.response = (code = 'BXH-ABC123', name = '本人測試') => ({ parent: { code, name }, stages: [{ key: 'A', status: 'completed', players: [{ id: 'self', name }, { id: 'other', name: '對手' }], matches: [{ id: 'm', round: 0, a: { playerId: 'self' }, b: { playerId: 'other' }, completed: true, scoreA: 4, scoreB: 2, winnerId: 'self' }] }], ownPlayerIds: ['self'], ownMatches: [{ stageKey: 'A', round: 0, a: { playerId: 'self' }, b: { playerId: 'other' }, completed: true, scoreA: 4, scoreB: 2, winnerId: 'self' }], placements: [] });
  return h;
}
test('repeated bind/clicks deduplicate; finished rerender retains data and selected tab, clears detached node', async () => {
  const h = setup(); h.bind(); h.bind(); h.node.click({ groupHistoryAction: 'refresh' }); await settle();
  assert.equal(h.calls.length, 1); assert.deepEqual(h.calls[0], { action: 'history', parentCode: 'BXH-ABC123' });
  h.pending[0].resolve(h.response()); await settle(); assert.ok(h.node.innerHTML.includes('本人測試'));
  h.node.click({ groupHistoryStage: 'champions' }); assert.ok(h.node.innerHTML.includes('aria-labelledby="group-history-tab-champions"'));
  const old = h.node; old.isConnected = false; h.node = new Node(); h.bind(); await settle();
  assert.equal(h.calls.length, 1); assert.equal(old.innerHTML, ''); assert.equal(old.listeners.size, 0);
  assert.ok(h.node.innerHTML.includes('aria-labelledby="group-history-tab-champions"'));
});
test('pending node replacement reads anew; stale callback and stale node clicks never mutate current view', async () => {
  const h = setup(); h.bind(); await settle(); const old = h.node; old.isConnected = false;
  h.node = new Node(); h.bind(); await settle(); assert.equal(h.calls.length, 2);
  h.pending[0].resolve(h.response('BXH-ABC123', 'STALE')); await settle(); assert.ok(!h.node.innerHTML.includes('STALE'));
  old.click({ groupHistoryAction: 'refresh' }); await settle(); assert.equal(h.calls.length, 2);
  h.pending[1].resolve(h.response('BXH-ABC123', 'CURRENT')); await settle(); assert.ok(h.node.innerHTML.includes('CURRENT')); assert.equal(old.innerHTML, '');
});
test('logout suspends same session immediately; same UID re-login epoch cannot accept prior callback', async () => {
  const h = setup(); h.bind(); await settle();
  h.api.suspendSession(h.session.uid, h.session.epoch); assert.equal(h.node.innerHTML, ''); h.bind(); await settle(); assert.equal(h.calls.length, 1);
  h.session = { uid: 'account', epoch: 2 }; h.bind(); await settle(); assert.equal(h.calls.length, 2);
  h.pending[0].resolve(h.response('BXH-ABC123', 'OLD ACCOUNT RESULT')); await settle(); assert.ok(!h.node.innerHTML.includes('OLD ACCOUNT RESULT'));
  h.pending[1].resolve(h.response('BXH-ABC123', 'NEW SESSION')); await settle(); assert.ok(h.node.innerHTML.includes('NEW SESSION'));
  h.api.resetSession(); assert.equal(h.node.innerHTML, '');
});
test('navigation, scope change, pagehide and account switch all fence in-flight results and clear DOM', async () => {
  for (const mode of ['navigation', 'scope', 'pagehide', 'account']) {
    const h = setup(); h.bind(); await settle(); const old = h.node;
    if (mode === 'navigation') h.api.bind(null);
    if (mode === 'pagehide') h.events.get('pagehide')();
    if (mode === 'scope') { h.scope = 'archive'; h.node = new Node(); h.bind(); }
    if (mode === 'account') { h.session = { uid: 'other-account', epoch: 2 }; h.node = new Node('own', ''); h.bind(); }
    h.pending[0].resolve(h.response('BXH-ABC123', 'OLD PRIVATE NAME')); await settle();
    assert.equal(old.innerHTML, ''); assert.ok(!h.node.innerHTML.includes('OLD PRIVATE NAME'));
    if (h.pending[1]) { h.pending[1].resolve(h.response()); await settle(); }
    h.api.resetSession();
  }
});
test('own parent-code form normalizes input, blocks repeated submissions and malformed or mismatched results', async () => {
  const h = setup(); h.node = new Node('own', ''); h.bind(); await settle(); assert.equal(h.calls.length, 0);
  h.node.input('not a room'); h.node.submit(); await settle(); assert.equal(h.calls.length, 0); assert.ok(h.node.innerHTML.includes('請輸入完整主房代碼'));
  h.node.input(' bxh-abc123 '); h.node.submit(); h.node.submit(); await settle(); assert.equal(h.calls.length, 1);
  h.pending[0].resolve(h.response('BXH-OTHER1', 'WRONG ROOM')); await settle(); assert.ok(!h.node.innerHTML.includes('WRONG ROOM')); assert.ok(h.node.innerHTML.includes('暫時無法讀取'));
  h.node.submit(); await settle(); h.pending[1].resolve(h.response()); await settle(); assert.ok(h.node.innerHTML.includes('group-history-own')); assert.ok(h.node.innerHTML.includes('積分尚未核對入帳'));
});
test('discovery only reads at most eight configured codes and cannot continue after logout', async () => {
  const h = setup(); h.node = new Node('own', ''); h.bind(); h.node.click({ groupHistoryAction: 'discover' });
  for (let i = 0; i < 20; i++) await settle();
  assert.equal(h.mineCalls.length, 8); assert.equal(h.calls.length, 0);
  assert.ok(h.mineCalls.every(payload => payload.action === 'mine' && Object.keys(payload).sort().join(',') === 'action,code'));
  let resolveMine; const k = setup(); k.node = new Node('own', ''); k.mine = payload => { k.mineCalls.push(payload); return new Promise(resolve => { resolveMine = resolve; }); };
  k.bind(); k.node.click({ groupHistoryAction: 'discover' }); await settle(); assert.equal(k.mineCalls.length, 1);
  k.api.suspendSession(k.session.uid, k.session.epoch); resolveMine({ rows: [{ status: 'confirmed' }] }); await settle();
  assert.equal(k.mineCalls.length, 1); assert.equal(k.node.innerHTML, '');
});
test('timeout recovers retry control and late success cannot populate expired request', async () => {
  const h = setup(); h.bind(); await settle(); [...h.timers.values()][0](); await settle(); assert.ok(h.node.innerHTML.includes('讀取逾時'));
  h.node.click({ groupHistoryAction: 'refresh' }); await settle(); assert.equal(h.calls.length, 2);
  h.pending[0].resolve(h.response('BXH-ABC123', 'EXPIRED')); await settle(); assert.ok(!h.node.innerHTML.includes('EXPIRED'));
  h.pending[1].resolve(h.response()); await settle(); assert.ok(h.node.innerHTML.includes('本人測試'));
});

test('route changes before another core render invalidate pending work and wipe retained DOM', async () => {
 const h=setup();h.bind();await settle();h.scope='another-route';
 h.pending[0].resolve(h.response('BXH-ABC123','STALE ROUTE'));await settle();
 assert.equal(h.node.innerHTML,'');assert.equal(h.node.listeners.size,0);
});
