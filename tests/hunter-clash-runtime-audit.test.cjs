'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { collectRuntimeAudit } = require('../hunter-clash/runtime-audit.cjs');
const projectId = 'bxh-arena', token = 'private-access-token';
const rulesetName = 'projects/bxh-arena/rulesets/rules-v1';
const name = 'projects/bxh-arena/locations/us-central1/functions/playerCardService';
const release = { name: 'projects/bxh-arena/releases/cloud.firestore', rulesetName };
const okay = body => ({ ok: true, json: async () => body });
const collect = fetchImpl => collectRuntimeAudit({ projectId, token, fetchImpl, now: () => new Date('2026-09-30T00:00:00Z') });
test('GET-only inventory hashes Rules and excludes credentials, source and deployment claims', async () => {
  const requests = [];
  const source = 'rules_version = "2"; // private rule source';
  const report = await collect(async (url, options) => {
    requests.push(url); assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, `Bearer ${token}`); assert.equal(options.body, undefined);
    if (url.includes('/functions?')) return okay({ functions: [{ name, versionId: '17', runtime: 'nodejs22', environmentVariables: { SECRET: token }, sourceUploadUrl: token, serviceConfig: { revision: 'playerCardService-00017', secretEnvironmentVariables: [token] } }] });
    if (url.includes('/releases?')) return okay({ releases: [release] });
    assert.equal(url, `https://firebaserules.googleapis.com/v1/${rulesetName}`);
    return okay({ name: rulesetName, source: { files: [{ name: 'firestore.rules', content: source }] } });
  });
  assert.equal(requests.length, 4); assert.equal(report.collectionStatus, 'COLLECTED');
  assert.equal(report.runtimeReconciled, false); assert.equal(report.hcDeploymentVerified, false);
  assert.equal(report.rulesets.records[0].files[0].sha256, createHash('sha256').update(source).digest('hex'));
  assert.equal(report.functionsV1.records[0].versionId, '17');
  assert(!JSON.stringify(report).includes(token)); assert(!JSON.stringify(report).includes(source));
});
test('project and missing token are rejected before any network request', async () => {
  let calls = 0; const fetchImpl = async () => { calls++; return okay({}); };
  await assert.rejects(collectRuntimeAudit({ projectId: 'other-project', token, fetchImpl }), /unsupported-project/);
  await assert.rejects(collectRuntimeAudit({ projectId, token: '', fetchImpl }), /missing-access-token/);
  assert.equal(calls, 0);
});
test('pagination is followed and records are sorted; empty proto lists are supported', async () => {
  let calls = 0;
  const report = await collect(async url => {
    if (!url.includes('/v1/projects/bxh-arena/locations/')) return okay({});
    calls++;
    if (calls === 1) return okay({ functions: [{ name: name.replace('playerCardService', 'z') }], nextPageToken: 'next+/=' });
    assert.equal(new URL(url).searchParams.get('pageToken'), 'next+/=');
    return okay({ functions: [{ name: name.replace('playerCardService', 'a') }] });
  });
  assert.equal(calls, 2); assert.equal(report.collectionStatus, 'COLLECTED');
  assert(report.functionsV1.records[0].name.endsWith('/a')); assert.deepEqual(report.releases.records, []);
});
test('cross-project and URL-like Rules references never receive access tokens', async () => {
  for (const bad of ['projects/other/rulesets/r1', 'https://evil.invalid/token', 'projects/bxh-arena/rulesets/../other']) {
    const requests = [];
    const report = await collect(async url => { requests.push(url); return okay(url.includes('/releases?') ? { releases: [{ ...release, rulesetName: bad }] } : {}); });
    assert.equal(requests.length, 3); assert.equal(report.collectionStatus, 'INCOMPLETE');
    assert.equal(report.releases.reason, 'invalid-release-resource'); assert(!JSON.stringify(report).includes(bad));
  }
});
test('unreachable regions, malformed lists, repeated pagination and duplicates discard incomplete records', async () => {
  for (const body of [{ functions: [{ name }], unreachable: ['us-central1'] }, { functions: {} }, { nextPageToken: 'repeat' }, { functions: [{ name }, { name }] }]) {
    const report = await collect(async url => okay(url.includes('/locations/') ? body : {}));
    assert.equal(report.collectionStatus, 'INCOMPLETE'); assert.equal(report.functionsV1.status, 'INCOMPLETE');
    assert.deepEqual(report.functionsV1.records, []);
  }
});
test('HTTP errors, exception messages and invalid JSON never expose raw server details', async () => {
  for (const response of [async () => ({ ok: false, status: 403, json: async () => { throw Error(token); } }), async () => { throw Error(token); }, async () => ({ ok: true, json: async () => { throw Error(token); } })]) {
    const report = await collect(response);
    assert.equal(report.collectionStatus, 'INCOMPLETE'); assert(!JSON.stringify(report).includes(token));
  }
});
test('ruleset identity, duplicate files and missing source cannot be treated as collected', async () => {
  for (const body of [{ name: 'projects/other/rulesets/rules-v1' }, { name: rulesetName }, { name: rulesetName, source: { files: [{ name: 'x', content: '' }, { name: 'x', content: '' }] } }]) {
    const report = await collect(async url => okay(url.includes('/releases?') ? { releases: [release] } : url.includes('/rulesets/') ? body : {}));
    assert.equal(report.rulesets.status, 'INCOMPLETE'); assert.equal(report.collectionStatus, 'INCOMPLETE');
  }
});
