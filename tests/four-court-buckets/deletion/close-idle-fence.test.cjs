'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');
const { load, memory } = require('./restore-fixture.cjs');
const { fingerprint } = require('./fixtures/restore/operations-core.js');

const code = 'BXH-TEST01';
const privatePath = 'tournaments/' + code;
const publicPath = 'publicTournaments/' + code;
const activityPath = 'tournamentActivity/' + code;
const settingsPath = 'systemSettings/tournamentOperations';
const spec = { path: 'operations.js' };
const fixturePath = path.join(__dirname, 'fixtures/restore/operations.js');
const patchPath = path.resolve(__dirname, '../../../release/buckets/integration/close-idle-fence.patch');
const expectedFixtureSha = '0c3958dab64801584c84de7c31fe28a4caf33387bce0ad1b9d8c57baceb6d89d';
assert.equal(createHash('sha256').update(fs.readFileSync(fixturePath)).digest('hex'), expectedFixtureSha);

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bxh-idle-close-'));
after(() => fs.rmSync(work, { recursive: true, force: true }));
const candidate = path.join(work, spec.path);
fs.copyFileSync(fixturePath, candidate);
execFileSync('git', ['apply', '--whitespace=error', patchPath], { cwd: work });

function eligibleRoom() {
  const fixture = memory();
  const start = Date.parse('2026-10-30T00:00:00Z');
  fixture.rows.set(activityPath, {
    observedAt: start,
    lastAt: start,
    fingerprint: fingerprint(fixture.rows.get(privatePath)),
  });
  return fixture;
}

test('shared historical source closes an idle room with a bucket marker', async () => {
  const fixture = eligibleRoom();
  fixture.rows.get(privatePath).scoreStorage = {};
  await load(spec, false, fixture).closeIdleTournaments();
  assert.equal(fixture.roomWrites, 2);
  assert.equal(fixture.rows.get(privatePath).systemClosed, true);
  assert.equal(fixture.rows.get(publicPath).systemClosed, true);
});

for (const marker of ['scoreStorage', 'scoreBucketProjection', 'bucketMigration', 'deletionStatus']) {
  for (const root of [privatePath, publicPath]) {
    test('candidate skips ' + marker + ' on ' + root, async () => {
      const fixture = eligibleRoom();
      fixture.rows.get(root)[marker] = null;
      const original = structuredClone(fixture.rows);
      await load(spec, true, fixture, candidate).closeIdleTournaments();
      assert.equal(fixture.roomWrites, 0);
      assert.deepEqual(fixture.errors, []);
      assert.equal(fixture.rows.get(settingsPath).scanCursor, '');
      assert.ok(fixture.rows.get(settingsPath).lastScanAt);
      fixture.rows.delete(settingsPath);
      original.delete(settingsPath);
      assert.deepEqual(fixture.rows, original);
    });
  }
}

test('candidate retains legacy close, mirror and activity updates for an unmarked room', async () => {
  const historical = eligibleRoom();
  const patched = eligibleRoom();
  await load(spec, false, historical).closeIdleTournaments();
  await load(spec, true, patched, candidate).closeIdleTournaments();
  assert.equal(patched.roomWrites, 2);
  assert.deepEqual(patched.rows, historical.rows);
  assert.deepEqual(patched.errors, []);
});
