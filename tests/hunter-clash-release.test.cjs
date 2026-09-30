'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
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
test('PASS labels cannot bypass backend provenance or entry integration', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-release-'));
  const file = path.join(dir, 'checkpoint.json');
  const checkpoint = JSON.parse(fs.readFileSync(path.join(__dirname, '../hunter-clash/checkpoint.json'), 'utf8'));
  for (const key of Object.keys(checkpoint.evidence)) checkpoint.evidence[key] = 'PASS';
  try {
    fs.writeFileSync(file, JSON.stringify(checkpoint));
    const blocked = checkFile(file);
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.blockers.includes('backend-provenance-unverified'));
    assert.ok(blocked.blockers.includes('entry-not-wired'));
    checkpoint.backendReferenceIsLiveVerified = true;
    fs.writeFileSync(file, JSON.stringify(checkpoint));
    assert.equal(checkFile(file).allowed, false);
    checkpoint.entryWired = true;
    fs.writeFileSync(file, JSON.stringify(checkpoint));
    assert.equal(checkFile(file).allowed, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
