'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { compareRuntimeRules: compare } = require('../hunter-clash/compare-runtime-rules.cjs');
const reference = require('../hunter-clash/rules-source-reference.json');
function setFiles(report, value) {
  report.rulesets.records[0].files = value;
  const sorted = value.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  report.rulesets.records[0].manifestSha256 = createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}
function fixture() {
  const report = { schemaVersion: 1, projectId: reference.projectId, readOnly: true, collectionStatus: 'COLLECTED',
    startedAt: '2026-09-30T00:00:00Z', completedAt: '2026-09-30T00:00:01Z',
    functionsV1: { status: 'COLLECTED', records: [] }, functionsV2: { status: 'COLLECTED', records: [] },
    releases: { status: 'COLLECTED', records: [{ name: reference.releaseNames[0], rulesetName: 'projects/bxh-arena/rulesets/r1' }] },
    rulesets: { status: 'COLLECTED', records: [{ name: 'projects/bxh-arena/rulesets/r1' }] } };
  setFiles(report, reference.files); return report;
}
test('matching pinned Rules is partial evidence and never proves HC or runtime deployment', () => {
  const report = fixture(), before = JSON.stringify(report);
  const result = compare(report);
  assert.equal(result.status, 'MATCH'); assert.equal(result.rulesMatch, true);
  assert.equal(result.runtimeReconciled, false); assert.equal(result.hcDeploymentVerified, false);
  assert.equal(result.sourceCommit, reference.sourceCommit); assert.deepEqual(result.differences, []);
  assert.equal(JSON.stringify(report), before);
});
test('missing, wrong-project and incomplete reports fail closed', () => {
  assert.equal(compare(null).status, 'BLOCKED');
  for (const change of [r => r.projectId = 'other', r => r.readOnly = false, r => r.collectionStatus = 'INCOMPLETE', r => r.functionsV2.status = 'INCOMPLETE', r => r.rulesets.records = null, r => r.completedAt = 'bad', r => r.completedAt = '2025-01-01T00:00:00Z']) {
    const r = fixture(); change(r); assert.equal(compare(r).status, 'BLOCKED');
  }
});
test('default Firestore release aliases are accepted only when they reference the same ruleset', () => {
  const r = fixture(); r.releases.records[0].name = reference.releaseNames[1];
  assert.equal(compare(r).status, 'MATCH');
  r.releases.records.push({ ...r.releases.records[0], name: reference.releaseNames[0] });
  assert.equal(compare(r).status, 'MATCH');
  r.releases.records[1].rulesetName = 'projects/bxh-arena/rulesets/r2';
  assert.equal(compare(r).status, 'BLOCKED');
});
test('missing or duplicated releases and cross-project Rules references are blocked', () => {
  for (const change of [r => r.releases.records = [], r => r.releases.records.push({ ...r.releases.records[0] }), r => r.releases.records[0].rulesetName = 'projects/other/rulesets/r1', r => r.rulesets.records = [], r => r.rulesets.records.push({ ...r.rulesets.records[0] })]) {
    const r = fixture(); change(r); assert.equal(compare(r).status, 'BLOCKED');
  }
});
test('changed, missing and extra source files produce precise mismatches', () => {
  const changed = fixture(); setFiles(changed, [{ ...reference.files[0], sha256: 'a'.repeat(64) }]);
  assert.deepEqual(compare(changed).differences, [{ name: 'firestore.rules', reason: 'content-mismatch' }]);
  const renamed = fixture(); setFiles(renamed, [{ ...reference.files[0], name: 'other.rules' }]);
  assert.deepEqual(compare(renamed).differences, [{ name: 'firestore.rules', reason: 'missing-file' }, { name: 'other.rules', reason: 'unexpected-file' }]);
  assert.equal(compare(renamed).status, 'MISMATCH');
});
test('invalid manifest digest, duplicate file names, invalid sizes and missing hashes are blocked', () => {
  for (const change of [r => r.rulesets.records[0].manifestSha256 = 'a'.repeat(64), r => setFiles(r, [reference.files[0], reference.files[0]]), r => setFiles(r, [{ ...reference.files[0], bytes: -1 }]), r => setFiles(r, [{ ...reference.files[0], sha256: 'invalid' }])]) {
    const r = fixture(); change(r); assert.equal(compare(r).status, 'BLOCKED');
  }
});
test('unrelated releases, secrets and raw source content do not appear in comparison output', () => {
  const r = fixture(); r.secret = 'do-not-output'; r.rulesets.records[0].source = { content: 'do-not-output' };
  r.releases.records.push({ name: 'projects/bxh-arena/releases/firebase.storage', rulesetName: 'private-storage-rules' });
  const result = compare(r); assert.equal(result.status, 'MATCH');
  assert(!JSON.stringify(result).includes('do-not-output')); assert(!JSON.stringify(result).includes('private-storage-rules'));
});
