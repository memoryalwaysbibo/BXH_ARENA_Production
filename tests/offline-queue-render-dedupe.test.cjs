'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const core = fs.readFileSync('modules/main-app/core.js', 'utf8');
const cloud = fs.readFileSync('modules/cloud/cloud-runtime.js', 'utf8');
const offline = fs.readFileSync('offline-resilience.js', 'utf8');

const helper = offline.match(/function queueCountsKey\(value\)\{[^\n]+\}/)?.[0];
assert.ok(helper, 'queue count signature helper exists');
const context = {};
vm.createContext(context);
vm.runInContext(helper + '\nglobalThis.__key=queueCountsKey;', context);
const empty = { pending: 0, conflict: 0, failed: 0, total: 0 };
const pending = { pending: 1, conflict: 0, failed: 0, total: 1 };
assert.equal(context.__key(empty), context.__key(empty), 'identical snapshots share a key');
assert.notEqual(context.__key(empty), context.__key(pending), 'queue changes produce a new key');
assert.notEqual(context.__key(pending), context.__key({ pending: 0, conflict: 1, failed: 0, total: 1 }), 'conflict counts are part of the key');

const combined = core + '\n' + cloud;
assert.equal(
  (combined.match(/addEventListener\("bxh-offline-queue-change"/g) || []).length,
  1,
  'only Core owns the offline queue UI listener'
);
assert.equal((cloud.match(/addEventListener\("bxh-offline-queue-change"/g) || []).length, 0, 'Cloud Runtime must not own UI queue events');
assert.match(offline, /if\(key===lastQueueCountsKey\)return;/, 'unchanged queue snapshots must not dispatch');

console.log('Offline queue render dedupe regression gate: PASS');
