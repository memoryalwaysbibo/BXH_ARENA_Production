'use strict';
const assert = require('node:assert/strict');
const { fixture, code } = require('../completion/fixture.cjs');

const projectId = 'demo-bxh-bucket-raffle';
assert.equal(process.env.GCLOUD_PROJECT, projectId);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8198');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9197');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const app = initializeApp({ projectId });
const db = getFirestore(app);
const roomPath = 'tournaments/' + code;
const preview = 'previewTournamentRaffle';
const draw = 'drawTournamentRaffle';
const update = 'updateTournamentRaffleWinner';

function post(url, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  return fetch(url, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'error',
    signal: AbortSignal.timeout(15000) });
}

async function signIn(email) {
  const authUrl = 'http://127.0.0.1:9197/identitytoolkit.googleapis.com/v1/accounts:';
  const credentials = { email, password: 'raffle-emulator-only-2026', returnSecureToken: true };
  const signup = await post(authUrl + 'signUp?key=demo-key', credentials);
  assert.equal(signup.status, 200, 'create emulator-only account');
  const login = await post(authUrl + 'signInWithPassword?key=demo-key', credentials);
  assert.equal(login.status, 200, 'sign in to Auth Emulator with email and password');
  const { idToken, localId } = await login.json();
  assert(idToken && localId);
  return { idToken, uid: localId };
}

async function invoke(method, data, token) {
  const response = await post('http://127.0.0.1:5097/' + projectId + '/asia-east1/' + method,
    { data: { code, mode: 'general', ...data } }, token);
  return { status: response.status, body: await response.json() };
}

async function accepted(method, data, token) {
  const { status, body } = await invoke(method, data, token);
  assert.equal(status, 200, method + ' ' + JSON.stringify(body.error ?? {}));
  assert.equal(body.result?.ok, true);
  return body.result;
}

async function main() {
  try {
    const [manager, player, inactive] = await Promise.all([
      signIn('manager@example.invalid'), signIn('player@example.invalid'), signIn('inactive@example.invalid')
    ]);
    const { m } = fixture({ bucket: true, courts: 6 });
    const room = m.rows.get(roomPath);
    const state = JSON.parse(room.data);
    state.players[1].registrationUid = state.players[0].registrationUid;
    state.players[1].name = state.players[0].name;
    m.put(roomPath, { ...room, createdBy: manager.uid, data: JSON.stringify(state) });
    m.put('users/' + manager.uid, { active: true, role: 'admin' });
    m.put('users/' + player.uid, { active: true, role: 'player' });
    m.put('users/' + inactive.uid, { active: false, role: 'super_admin' });
    const seed = db.batch();
    for (const [path, value] of m.rows) seed.set(db.doc(path), value);
    await seed.commit();

    const drawInput = { operationId: 'auth-draw', prizes: [{ name: 'Demo prize', quantity: 3 }] };
    const updateInput = { operationId: 'auth-claim', action: 'claim', raffleId: 'auth-draw', winnerKey: 'placeholder' };
    let denied = 0;
    for (const [method, data] of [[preview, {}], [draw, drawInput], [update, updateInput]]) {
      for (const [token, status, code, reason] of [
        [undefined, 401, 'UNAUTHENTICATED', 'auth-required'],
        ['invalid-token', 401, 'UNAUTHENTICATED'],
        [player.idToken, 403, 'PERMISSION_DENIED', 'tournament-access-denied'],
        [inactive.idToken, 403, 'PERMISSION_DENIED', 'inactive-account']
      ]) {
        const result = await invoke(method, { ...data, auth: { uid: manager.uid } }, token);
        assert.equal(result.status, status, method + ' ' + JSON.stringify(result.body.error ?? {}));
        assert.equal(result.body.error.status, code);
        if (reason) assert.equal(result.body.error.message, reason);
        denied++;
      }
    }
    assert.equal((await db.doc(roomPath + '/raffleControl/current').get()).exists, false);
    assert.equal((await db.collection(roomPath + '/raffles').get()).size, 0);
    assert.equal((await db.collection(roomPath + '/operationLog').get()).size, 0);
    assert.equal((await db.doc('tournamentActivity/' + code).get()).exists, false);

    const pool = await accepted(preview, {}, manager.idToken);
    assert.equal(pool.count, 4);
    assert.notEqual(pool.candidates.find(p => p.playerId === 'p1').key,
      pool.candidates.find(p => p.playerId === 'p2').key);
    const payload = { ...drawInput, candidateHash: pool.candidateHash };
    const raffle = await accepted(draw, payload, manager.idToken);
    assert.equal(raffle.createdBy, manager.uid);
    assert.equal((await accepted(draw, payload, manager.idToken)).replayed, true);
    const winner = raffle.winners.find(p => ['p1', 'p2'].includes(p.playerId));
    assert(winner);
    const winnerData = { raffleId: raffle.id, winnerKey: winner.key, reason: 'emulator test' };
    await accepted(update, { ...winnerData, action: 'forfeit', operationId: 'auth-forfeit' }, manager.idToken);
    await accepted(update, { ...winnerData, action: 'replace', operationId: 'auth-replace' }, manager.idToken);
    const record = db.doc(roomPath + '/raffles/' + raffle.id);
    const replacement = (await record.get()).data().winners.at(-1);
    assert.equal(replacement.replaces, winner.key);
    await accepted(update, { ...updateInput, winnerKey: replacement.key }, manager.idToken);
    const final = (await record.get()).data();
    assert.equal(final.winners.at(-1).status, 'claimed');
    assert.equal(final.revision, 3);
    assert.equal((await db.collection(roomPath + '/raffles').get()).size, 1);
    console.log(JSON.stringify({ nativeRaffleCallableEndpoints: 3, denied, emulatorPasswordSignIn: true,
      managerFlow: 'passed', sameOperationReplay: true, appCheckHeaderSent: false,
      productionRequests: 0, productionWrites: 0 }));
  } finally {
    await db.terminate();
    await deleteApp(app);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
