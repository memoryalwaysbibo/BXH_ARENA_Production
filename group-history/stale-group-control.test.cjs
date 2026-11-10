'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const flush = () => new Promise(resolve => setImmediate(resolve));
for (const mode of ['logout', 'detached', 'new-user', 'pagehide']) test('prepare continuation cannot open rooms after ' + mode, async () => {
  const windowHandlers = {};
  const context = { addEventListener: (type, fn) => windowHandlers[type] = fn, module: { exports: {} }, BXH_GROUP_STAGE_PARENT_CODES: ['BXH-ABC123'], setTimeout, clearTimeout, confirm: () => true };
  vm.runInNewContext(fs.readFileSync(require.resolve('../modules/main-app/group-stages.js'), 'utf8'), context);
  const ui = context.module.exports;
  const node = { dataset: { code: 'BXH-ABC123', view: 'operator' }, isConnected: true, innerHTML: '', querySelector: () => null, addEventListener() {} };
  const handlers = {}, selectHandlers = {};
  const select = { addEventListener: (type, fn) => selectHandlers[type] = fn };
  const button = { dataset: {}, addEventListener: (type, fn) => handlers[type] = fn, closest: () => ({ querySelector: () => select }) };
  const calls = []; let finish;
  const request = payload => { calls.push(payload.action); return payload.action === 'prepare' ? new Promise(resolve => finish = resolve) : Promise.resolve({ unprepared: true }); };
  ui.bind(node, 'old-user', request, button); await flush();
  select.value = '4'; selectHandlers.change({ currentTarget: select });
  handlers.click({ currentTarget: button });
  assert.deepEqual(calls, ['status', 'prepare']);
  if (mode === 'logout') ui.bind(null);
  if (mode === 'pagehide') windowHandlers.pagehide();
  if (mode === 'detached') node.isConnected = false;
  if (mode === 'new-user') { ui.bind(node, 'new-user', request, button); await flush(); }
  finish({ groups: [{ key: 'A', count: 80 }], drawAllPending: true }); await flush();
  assert.equal(calls.includes('open-all'), false);
  ui.bind(null);
});
