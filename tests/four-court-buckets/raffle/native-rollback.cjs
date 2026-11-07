'use strict';
const assert = require('node:assert/strict');
const project = 'demo-bxh-bucket-raffle';
assert.equal(process.env.GCLOUD_PROJECT, project, 'isolated demo project required');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8198', 'loopback emulator required');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { fixture, code, NOW } = require('../completion/fixture.cjs');
const core = require('../operations/fixtures/5/operations-core.js');
const { createRafflePreview } = require('../../../release/buckets/raffle/preview.cjs');
const { createRaffleWriters } = require('../../../release/buckets/raffle/writers.cjs');
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
const app = initializeApp({ projectId: project }), db = getFirestore(app);
const root = `tournaments/${code}`, pub = `publicTournaments/${code}`;
const request = data => ({ auth: { uid: 'admin' }, data: { code, mode: 'general', ...data } });
const services = (version, database = db) => {
  const options = { db: database, core, HttpsError, now: () => NOW,
    newIdentityVersion: version, select: (pool, count) => core.draw(pool, count, min => min) };
  return { preview: createRafflePreview(options), ...createRaffleWriters(options) };
};
let checks = 0;
async function seed(courts) {
  const response = await fetch(`http://127.0.0.1:8198/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
  assert.equal(response.status, 200);
  const f = fixture({ bucket: courts !== 0, courts: courts || 6 }), batch = db.batch();
  for (const [path, value] of f.m.rows) batch.set(db.doc(path), value);
  await batch.commit();
}
async function snapshot(protectedOnly = false) {
  const paths = protectedOnly ? [root, pub] : [root, pub, 'users/admin', `tournamentActivity/${code}`, `${root}/raffleControl/current`];
  const docs = await db.getAll(...paths.map(path => db.doc(path)));
  for (const name of protectedOnly ? ['matchBuckets'] : ['matchBuckets', 'raffles', 'operationLog']) {
    docs.push(...(await db.collection(`${root}/${name}`).get()).docs);
  }
  return JSON.stringify(docs.map(s => [s.ref.path, s.exists, s.data(), s.createTime, s.updateTime]).sort((a, b) => a[0].localeCompare(b[0])));
}
async function unchanged(work, pattern) {
  const before = await snapshot();
  if (pattern) await assert.rejects(work, pattern); else await work();
  assert.equal(await snapshot(), before); checks++;
}
(async () => { try {
  for (const courts of [0, 4, 6, 12]) for (const version of ['legacy', 'participant-v1']) {
    for (const action of ['claim', 'forfeit', 'replace']) {
      await seed(courts);
      const protectedBefore = await snapshot(true), source = services(version), fallback = services(version === 'legacy' ? 'participant-v1' : 'legacy');
      const pool = await source.preview(request({}));
      const payload = { operationId: 'draw-switch', prizes: [{ name: 'Prize', quantity: 1 }], candidateHash: pool.candidateHash };
      const draw = await source.draw(request(payload));
      const update = request({ raffleId: draw.id, action, winnerKey: draw.winners[0].key, operationId: `op-${action}`, reason: 'native isolated test' });
      if (action === 'replace') await source.update(request({ ...update.data, action: 'forfeit', operationId: 'before-replace' }));
      await source.update(update);
      await unchanged(async () => {
        assert.equal((await fallback.update(update)).replayed, true);
        assert.equal((await fallback.draw(request(payload))).replayed, true);
      });
      const saved = (await db.doc(`${root}/raffles/${draw.id}`).get()).data();
      assert.equal(saved.identityVersion, version);
      assert((await fallback.preview(request({}))).candidates.every(p => !saved.winners.some(w => w.key === p.key)));
      assert.equal(await snapshot(true), protectedBefore); checks++;
      await db.doc('users/admin').update({ role: 'player' });
      await unchanged(() => fallback.update(update), /tournament-access-denied/);
      await unchanged(() => fallback.draw(request(payload)), /tournament-access-denied/);
      await db.doc('users/admin').update({ role: 'super_admin' });
      await db.doc(root).update({ systemClosed: true });
      await unchanged(async () => assert.equal((await fallback.update(update)).replayed, true));
      await unchanged(() => fallback.update(request({ ...update.data, operationId: 'new-after-close' })), /system-closed/);
      const old = (await db.doc(pub).get()).data(); await db.doc(pub).delete(); await db.doc(pub).set(old);
      await unchanged(() => fallback.update(update), /room-generation-changed/);
      await unchanged(() => fallback.draw(request(payload)), /room-generation-changed/);
    }
    // Winner updates must recheck authority and room identity after SDK retry too.
    // The first callback queues its writes, then ABORTED discards all of them.
    for (const action of ['claim', 'forfeit', 'replace']) for (const interruption of ['revoke', 'recreate']) {
      await seed(courts);
      const original = services(version), pool = await original.preview(request({}));
      const draw = await original.draw(request({ operationId: 'before-interruption',
        prizes: [{ name: 'Prize', quantity: 1 }], candidateHash: pool.candidateHash }));
      const update = request({ raffleId: draw.id, action, winnerKey: draw.winners[0].key,
        operationId: 'interrupted-update', reason: 'native retry interruption' });
      if (action === 'replace') await original.update(request({ ...update.data,
        action: 'forfeit', operationId: 'before-interruption-forfeit' }));
      let attempts = 0, afterInterruption;
      const interrupted = { doc: db.doc.bind(db), runTransaction: callback => db.runTransaction(async tx => {
        attempts++;
        if (attempts === 2) {
          if (interruption === 'revoke') await db.doc('users/admin').update({ role: 'player' });
          else {
            const current = (await db.doc(pub).get()).data();
            await db.doc(pub).delete(); await db.doc(pub).set(current);
          }
          afterInterruption = await snapshot();
        }
        const result = await callback(tx);
        if (attempts === 1) throw Object.assign(Error('test-only-aborted'), { code: 10 });
        return result;
      }) };
      const fallback = services(version === 'legacy' ? 'participant-v1' : 'legacy', interrupted);
      await assert.rejects(fallback.update(update), interruption === 'revoke'
        ? /tournament-access-denied/ : /room-generation-changed|raffle-room-changed/);
      assert.equal(attempts, 2);
      assert.equal(await snapshot(), afterInterruption);
      assert.equal((await db.doc(`${root}/operationLog/interrupted-update`).get()).exists, false);
      const saved = (await db.doc(`${root}/raffles/${draw.id}`).get()).data();
      assert.equal(saved.revision, action === 'replace' ? 1 : 0);
      assert.equal(saved.winners.length, 1);
      assert.equal(saved.winners[0].status, action === 'replace' ? 'forfeited' : 'pending');
      assert.equal((await db.doc(`${root}/raffleControl/current`).get()).data().winnerKeys.length, 1);
      checks++;
    }
    // Explicit SDK ABORTED, then revoke before the next callback acquires locks.
    await seed(courts);
    const pool = await services(version).preview(request({}));
    let callbacks = 0;
    const bound = { doc: db.doc.bind(db), runTransaction: callback => db.runTransaction(async tx => {
      callbacks++;
      if (callbacks === 2) await db.doc('users/admin').update({ active: false });
      const result = await callback(tx);
      if (callbacks === 1) throw Object.assign(Error('test-only-aborted'), { code: 10 });
      return result;
    }) };
    await assert.rejects(services(version, bound).draw(request({ operationId: 'retry-revoke', prizes: [{ name: 'P', quantity: 1 }], candidateHash: pool.candidateHash })), /inactive-account/);
    assert.equal(callbacks, 2);
    for (const name of ['raffles', 'operationLog']) assert.equal((await db.collection(`${root}/${name}`).get()).size, 0);
    assert.equal((await db.doc(`${root}/raffleControl/current`).get()).exists, false);
    assert.equal((await db.doc(`tournamentActivity/${code}`).get()).exists, false); checks++;
  }
  console.log(JSON.stringify({ nativeRollbackChecks: checks, storage: ['legacy', 4, 6, 12], productionRequests: 0, productionWrites: 0, auth: 'fixture', retries: 'deterministic SDK ABORTED' }));
} finally { await db.terminate(); await deleteApp(app); }
})().catch(error => { console.error(error); process.exitCode = 1; });
