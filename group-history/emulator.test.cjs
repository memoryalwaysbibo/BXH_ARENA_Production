'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, updateState } = require('./test-fixtures.cjs');
const { createHistoryReader } = require('./read.cjs');

const project = 'demo-bxh-group-history';
assert.equal(process.env.GCLOUD_PROJECT, project);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8200');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

test('isolated SDK history is private, authenticated, archived-readable, and read-only', async () => {
  const app = initializeApp({ projectId: project });
  const db = getFirestore(app);
  try {
    const item = await fixture({ complete: true, family: true });
    updateState(item.db, item.parentCode, state => { state.archiveStatus = 'completed'; state.startedAt = 10; state.archivedAt = 11; });
    const seed = db.batch();
    for (const [target, value] of item.db.rows) seed.set(db.doc(target), value);
    await seed.commit();
    const refs = [...item.db.rows.keys()].map(target => db.doc(target));
    const before = (await db.getAll(...refs)).map(snapshot => snapshot.data());
    const reader = createHistoryReader(db);
    const { groupStageCommand } = require('../group-stages/firebase-entry.cjs');
    assert(groupStageCommand.__endpoint.callableTrigger);
    await assert.rejects(groupStageCommand.run({ data: { action: 'history', parentCode: item.parentCode, actorUid: 'operator' } }), { code: 'unauthenticated' });
    await assert.rejects(groupStageCommand.run({ auth: { uid: 'outside' }, data: { action: 'history', parentCode: item.parentCode, viewerUid: 'user-0' } }), { code: 'permission-denied' });
    const result = await groupStageCommand.run({ auth: { uid: 'user-0' }, data: { action: 'history', parentCode: item.parentCode } });
    assert.equal(result.parent.archiveStatus, 'completed');
    assert.equal(result.stages.length, 6); assert.equal(result.needsReview, false);
    assert.equal(result.ownPlayerIds.length, 2);
    assert(result.ownPlayerIds.every(id => /^hp_[a-f0-9]{32}$/.test(id)));
    assert.equal(result.placements.length, 2);
    assert.deepEqual(result, await reader(item.parentCode, 'user-0'));
    const after = (await db.getAll(...refs)).map(snapshot => snapshot.data());
    assert.deepEqual(after, before);
    assert.equal((await db.collection('ladderTransactions').get()).size, 0);
    for (const target of ['groupStagePlans/' + item.parentCode, 'tournaments/' + item.parentCode,
      'tournaments/' + item.parentCode + '/registrations/reg-1']) {
      const response = await fetch('http://127.0.0.1:8200/v1/projects/' + project + '/databases/(default)/documents/' + target);
      assert.equal(response.status, 403, target + ' must remain private');
    }
    await db.doc('tournaments/' + item.parentCode + '/registrations/reg-1').update({ guardianUid: 'outside' });
    await assert.rejects(reader(item.parentCode, 'user-0'), { code: 'group-registration-mismatch' });
  } finally { await deleteApp(app); }
});
