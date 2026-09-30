'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { checkFile } = require('../hunter-clash/check-release.cjs');
const gate = path.join(__dirname, '../hunter-clash/check-release.cjs');
test('actual incomplete checkpoint blocks publishing with nonzero exit', () => {
  const run = spawnSync(process.execPath, [gate], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  const result = JSON.parse(run.stdout);
  assert.equal(result.allowed, false);
  assert.ok(result.blockers.includes('backendAuthorization'));
  assert.ok(result.blockers.includes('internalBeta'));
});
test('missing checkpoint fails closed', () => {
  const file = path.join(__dirname, 'missing-hc-checkpoint.json');
  assert.equal(checkFile(file).allowed, false);
  assert.equal(spawnSync(process.execPath, [gate, file]).status, 1);
});
