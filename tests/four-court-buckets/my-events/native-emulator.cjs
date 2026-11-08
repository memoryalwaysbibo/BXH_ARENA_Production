'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const candidate = process.env.BXH_MY_EVENTS_CANDIDATE_DIR;
if (!candidate) throw Error('BXH_MY_EVENTS_CANDIDATE_DIR-required');
const repo = path.resolve(__dirname, '../../..');
const fromCandidate = name => require(require.resolve(name, {paths: [candidate]}));
const {initializeApp, deleteApp} = fromCandidate('firebase-admin/app');
const {getFirestore, FieldPath} = fromCandidate('firebase-admin/firestore');
const {fixture, code} = require(path.join(repo, 'tests/four-court-buckets/settlement/probe.cjs'));
const {readRoomLifecycle} = require(path.join(candidate, 'vendor/backend/bucket-lifecycle.cjs'));
const {normalizeLifecycle} = require(path.join(candidate, 'vendor/backend/lifecycle.js'));
const {createAdminBridge} = require(path.join(candidate, 'vendor/backend/service.cjs'));
const {createBootstrap, PATHS} = require(path.join(candidate, 'vendor/backend/bootstrap.cjs'));
const {createAuthenticatedReader} = require(path.join(candidate, 'vendor/reader/auth-reader.cjs'));
const {createDetailReader} = require(path.join(candidate, 'vendor/details/detail-reader.cjs'));

async function main() {
  assert.equal(process.env.GCLOUD_PROJECT, 'demo-bxh-my-events-review');
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8189');
  const app = initializeApp({projectId: process.env.GCLOUD_PROJECT});
  const db = getFirestore(app);
  try {
    const f = fixture({courts: 6});
    const rootPath = 'tournaments/' + code;
    const pubPath = 'publicTournaments/' + code;
    await db.doc(rootPath).set(f.m.rows.get(rootPath));
    await db.doc(pubPath).set(f.m.rows.get(pubPath));
    for (const [p, data] of f.m.rows) {
      if (p.startsWith(rootPath + '/matchBuckets/')) await db.doc(p).set(data);
    }
    const lifecycle = () => db.runTransaction(async tx => {
      const room = await tx.get(db.doc(rootPath));
      return readRoomLifecycle({db, tx, room, code, normalizeRoom: normalizeLifecycle});
    }, {readOnly: true});
    let life = await lifecycle();
    assert.equal(life.status, 'supported', JSON.stringify(life));
    assert.equal(life.source, 'verified-buckets');
    assert.equal(life.phase, 'settling');
    assert.equal(life.active, true);
    const bridge = createAdminBridge(db);
    const queued = [];
    const bootstrap = createBootstrap({
      bridge, enabled: true, documentId: FieldPath.documentId(),
      resolveRoomLifecycle: readRoomLifecycle,
      rebuilder: {beginRoom: async input => {queued.push(input); return {status: 'queued'};}},
    });
    assert.equal((await bootstrap.beginRun({runId: 'native-six'})).status, 'started');
    const page = await bootstrap.processPage('native-six');
    assert.equal(page.status, 'page', JSON.stringify(page));
    assert.equal(page.rows, 1);
    assert.equal(queued.length, 1);
    assert.equal(queued[0].code, code);
    assert.equal(queued[0].expectedTarget, 'active');
    const run = (await db.doc(PATHS.runs + '/native-six').get()).data();
    assert.equal(run.roomDiscoveryCursor, code);
    const root = await db.doc(rootPath).get();
    const uid = 'native-reader';
    await db.doc('users/' + uid).set({active: true});
    await db.doc(rootPath + '/registrations/' + uid).set({
      uid, tournamentCode: code, status: 'confirmed', displayName: 'Native Reader',
    });
    await db.doc('users/' + uid + '/myEventRooms/' + code).set({
      code, ownerUid: uid, schemaVersion: 24, release: 'individual-family-v24',
      candidate: true, state: 'ready', roomIncarnation: root.createTime,
      counts: {selfConfirmed: 1, selfWaitlist: 0, familyConfirmed: 0, familyWaitlist: 0, unsupported: 0},
    });
    await db.doc('myEventBootstrapRunsV26/native-reader').set({
      schemaVersion: 26, runId: 'native-reader', engineVersion: 'membership-v26-generation-1',
      scope: 'individual-family', state: 'complete', phase: 'complete', pending: false,
      roomDiscoveryDone: true, summaryDiscoveryDone: true, queuedRooms: 1, completedRooms: 1,
      failedRooms: 0, rebuiltRooms: 1, quarantinedRooms: 0, disposition: 'clean',
      completedAt: 1, captureMode: 'same-service-engine',
    });
    await db.doc('myEventsMembershipControl/rollout').set({
      schemaVersion: 24, release: 'individual-family-v24', scope: 'individual-family',
      enabled: true, baselineComplete: true,
      bootstrap: {schemaVersion: 26, runId: 'native-reader', engineVersion: 'membership-v26-generation-1'},
    });
    const reader = createAuthenticatedReader({
      enabled: true, bridge, verifyAuth: async () => ({uid}),
      resolveRoomLifecycle: readRoomLifecycle,
    });
    const started = performance.now();
    const list = await reader({data: {}});
    const readerMs = Math.round(performance.now() - started);
    assert.equal(list.status, 'ready', JSON.stringify(list));
    assert.deepEqual(list.cards.map(x => [x.code, x.phase]), [[code, 'settling']]);
    const detail = createDetailReader({
      enabled: true, bridge, verifyAuth: async () => ({uid}),
      resolveRoomLifecycle: readRoomLifecycle,
    });
    const detailResult = await detail({data: {code}});
    assert.equal(detailResult.status, 'ready', JSON.stringify(detailResult));
    assert.equal(detailResult.phase, 'settling');
    assert.deepEqual(detailResult.rows.map(x => x.registrationId), [uid]);
    await db.doc(rootPath).update({tournamentPhase: 'done'});
    life = await lifecycle();
    assert.equal(life.status, 'invalid');
    assert.equal(life.reason, 'bucket-phase-conflict');
    await db.doc(rootPath).update({tournamentPhase: 'live'});
    await db.doc(rootPath + '/matchBuckets/court-2').delete();
    life = await lifecycle();
    assert.equal(life.status, 'invalid');
    assert.equal(life.reason, 'bucket-lifecycle-unverified');
    const missingReader = createAuthenticatedReader({
      enabled: true, bridge, verifyAuth: async () => ({uid}),
      resolveRoomLifecycle: readRoomLifecycle,
    });
    const missingList = await missingReader({data: {}});
    assert.equal(missingList.status, 'synchronizing', JSON.stringify(missingList));
    assert.equal(missingList.cards.length, 0);
    assert.ok(missingList.notices.includes('room-unavailable'));
    const missingDetail = createDetailReader({
      enabled: true, bridge, verifyAuth: async () => ({uid}),
      resolveRoomLifecycle: readRoomLifecycle,
    });
    const missingDetailResult = await missingDetail({data: {code}});
    assert.equal(missingDetailResult.status, 'synchronizing', JSON.stringify(missingDetailResult));
    assert.ok(missingDetailResult.notices.includes('unsupported-room'));
    console.log(JSON.stringify({checks: 27, project: process.env.GCLOUD_PROJECT, sixCourtLifecycle: true, bootstrapCursor: run.roomDiscoveryCursor, nativeReaderMs: readerMs, phaseConflictRejected: true, missingBucketRejected: true, productionWrites: 0}));
  } finally { await deleteApp(app); }
}
main().catch(e => {console.error(e); process.exitCode = 1;});
