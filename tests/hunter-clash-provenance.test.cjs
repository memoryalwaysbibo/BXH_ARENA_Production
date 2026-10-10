'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { backendProvenanceDecision: decide } = require('../hunter-clash/backend-provenance.cjs');
function fixture() {
  const sourceCommit = 'a'.repeat(40);
  return { schemaVersion: 1, repository: 'memoryalwaysbibo/BXH_ARENA_Functions_Production',
    projectId: 'bxh-arena', sourceCommit, runtimeReconciled: true,
    run: { id: 1, head_sha: sourceCommit, status: 'completed', conclusion: 'success' },
    jobs: [{ run_id: 1, status: 'completed', conclusion: 'success', steps: [
      { name: 'Deploy Production Firestore Rules', status: 'completed', conclusion: 'success' },
      { name: 'Deploy Production Functions', status: 'completed', conclusion: 'success' }
    ] }] };
}
test('missing evidence and successful validation with skipped deployments fail closed', () => {
  assert.equal(decide(null).allowed, false);
  const e = fixture();
  e.jobs[0].steps.forEach(step => step.conclusion = 'skipped');
  const r = decide(e);
  assert.equal(r.allowed, false);
  assert.ok(r.blockers.includes('backend-rules-not-deployed'));
  assert.ok(r.blockers.includes('backend-functions-not-deployed'));
});
test('wrong project, source commit, run, and incomplete jobs are rejected', () => {
  for (const alter of [e => e.projectId = 'bxh-arena-beta', e => e.run.head_sha = 'b'.repeat(40),
    e => e.run.conclusion = 'failure', e => e.jobs[0].run_id = 2,
    e => e.jobs = [], e => e.sourceCommit = 'main', e => e.runtimeReconciled = false]) {
    const e = fixture(); alter(e); assert.equal(decide(e).allowed, false);
  }
});
test('partial deployment cannot satisfy complete backend provenance', () => {
  const e = fixture(); e.jobs[0].steps.pop();
  assert.equal(decide(e).allowed, false);
});
test('matching completed deployment evidence and runtime reconciliation pass', () => {
  assert.equal(decide(fixture()).allowed, true);
});
