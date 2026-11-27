'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, updateState } = require('./test-fixtures.cjs');
const { createHistoryReader } = require('./read.cjs');

const project = 'demo-bxh-group-history';
assert.equal(process.env.GCLOUD_PROJECT, project);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8199');
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
      const response = await fetch('http://127.0.0.1:8199/v1/projects/' + project + '/databases/(default)/documents/' + target);
      assert.equal(response.status, 403, target + ' must remain private');
    }
    await db.doc('tournaments/' + item.parentCode + '/registrations/reg-1').update({ guardianUid: 'outside' });
    await assert.rejects(reader(item.parentCode, 'user-0'), { code: 'group-registration-mismatch' });
  } finally { await deleteApp(app); }
});

test('285-player historical import previews, archives, and settles through Firestore exactly once', async () => {
  const { createCoordinator } = require('../group-stages/coordinator.cjs');
  const { createGroupSettlement } = require('../group-stages/settlement.cjs');
  const { finish } = require('../group-stages/test-fixtures.cjs');
  const app = initializeApp({ projectId: project }, 'historical-import-emulator');
  const db = getFirestore(app);
  try {
    const parentCode = 'BXH-HST285';
    const parent = db.doc('tournaments/' + parentCode);
    const plan = db.doc('groupStagePlans/' + parentCode);
    const actor = 'historical-operator';
    const sizes = [['A', 72], ['B', 75], ['C', 69], ['D', 69]];
    const groups = Object.fromEntries(sizes.map(([key, size]) => [key,
      Array.from({ length: size }, (_, i) => {
        const id = key + (i + 1);
        const binding = key === 'A' && i === 2 ? { guardianOf: 'A1' }
          : key === 'D' && i >= size - 31 ? { hold: true } : {};
        return { id, name: 'Fixture ' + id, gameId: 'Game ' + id, ...binding };
      }),
    ]));
    // Compress completed single-elimination trees the same way Challonge
    // does: opening BYEs have no match record or prerequisite number.
    function sourceRows(players, stopAtTwo) {
      const { matches } = finish({ players, bronzeMatch: false });
      const final = matches.at(-1);
      const numbers = new Map(matches.flatMap((match, index) =>
        match.isBye ? [] : [[match.id, index + 1]]));
      return matches.filter(match => !match.isBye && (!stopAtTwo || match !== final)).map(match => {
        const source = side => match.round === 0 ? null
          : numbers.get('SE-' + (match.round - 1) + '-' + (match.indexInRound * 2 + side)) || null;
        return { number: numbers.get(match.id), round: match.round, a: match.a.playerId,
          b: match.b.playerId, winner: match.winnerId, fromA: source(0), fromB: source(1) };
      });
    }
    const groupMatches = Object.fromEntries(sizes.map(([key]) => [key, sourceRows(groups[key], true)]));
    const finalists = sizes.flatMap(([key]) => groupMatches[key].slice(-2).map(row => ({ id: row.winner })));
    const finalMatches = sourceRows(finalists, false);
    const loser = row => row.winner === row.a ? row.b : row.a;
    const finalPlaces = [finalMatches[6].winner, loser(finalMatches[6]),
      ...finalMatches.slice(4, 6).map(loser), ...finalMatches.slice(0, 4).map(loser)];
    const payload = { type: 'bxh-historical-top-eight-v1', parentCode, groups, groupMatches, finalMatches, finalPlaces };
    const parentData = {
      eventAuthority: 'official', ladderMode: 'ranked', archiveStatus: 'ongoing',
      data: JSON.stringify({ id: 'history-import-incarnation', cloudCode: parentCode,
        meta: { name: 'Historical 285-player fixture', formatType: 'single', battleMode: 'individual', playMode: 'standard' },
        players: [], matches: [], startedAt: null, archiveStatus: 'ongoing' }),
    };
    const dataBatch = db.batch(), profiles = db.batch();
    dataBatch.set(parent, parentData);
    dataBatch.set(db.doc('publicTournaments/' + parentCode), { bracketView: JSON.stringify({ players: [], matches: [] }) });
    dataBatch.set(db.doc('ladderSystem/current'), { status: 'active', currentSeason: 'S1' });
    dataBatch.set(db.doc('systemConfig/groupStages'), { enabled: true, parentCodes: [parentCode] });
    profiles.set(db.doc('users/' + actor), { active: true, role: 'super_admin' });
    for (const player of Object.values(groups).flat()) {
      if (player.guardianOf || player.hold) continue;
      const uid = 'historical-' + player.id;
      dataBatch.set(parent.collection('registrations').doc('reg-' + player.id),
        { uid, realName: player.name, gameId: player.gameId, status: player.id === 'A2' ? 'waitlist' : 'confirmed' });
      profiles.set(db.doc('users/' + uid), { active: true, role: 'player', realName: player.name });
    }
    await Promise.all([dataBatch.commit(), profiles.commit()]);
    const coordinator = createCoordinator(db, { clock: () => 1 });
    const preview = await coordinator.historicalImport(parentCode, actor, payload);
    assert.deepEqual([preview.entrantCount, preview.matchCount, preview.eligibleCount, preview.familyCount, preview.unlinked.length],
      [285, 284, 253, 1, 31]);
    assert.equal((await plan.get()).exists, false);
    assert.deepEqual((await parent.get()).data(), parentData);

    const imports = await Promise.all([1, 2].map(() =>
      coordinator.historicalImport(parentCode, actor, payload, preview.digest)));
    assert.deepEqual(imports[0], imports[1]);
    const importedParent = (await parent.get()).data();
    const importedRoster = JSON.parse(importedParent.data).players;
    assert.equal(importedRoster.length, 285);
    assert.equal(importedParent.registrationEnabled, false);
    assert.equal((await db.doc('publicTournaments/' + parentCode).get()).data().registrationEnabled, false);
    assert.equal(JSON.parse((await db.doc('publicTournaments/' + parentCode).get()).data().bracketView).players.length, 285);
    const history = await createHistoryReader(db)(parentCode, 'historical-A1');
    assert.deepEqual(history.stages.map(stage => [stage.key, stage.matches.length]),
      [['A', 70], ['B', 73], ['C', 67], ['D', 67], ['final-eight', 7]]);
    assert.equal(history.ownPlayerIds.length, 2);
    assert(history.stages.flatMap(stage => stage.matches).every(match => match.scoreA === null && match.scoreB === null));

    const settle = createGroupSettlement(db, coordinator, { clock: () => 1 });
    const settlements = await Promise.all([1, 2].map(() => settle(parentCode, actor)));
    assert.equal(settlements.filter(result => result.alreadyAwarded).length, 1);
    assert(settlements.every(result => result.creditedCount === 253));
    assert.equal((await db.collection('ladderTransactions').where('eventCode', '==', parentCode).get()).size, 253);
    assert.equal((await parent.get()).data().archiveStatus, 'completed');
    assert.equal((await db.doc('ladderPlayers/historical-A1').get()).data().totalEvents, 1);
    assert.equal((await db.doc('ladderPlayers/historical-D69').get()).exists, false);
  } finally { await deleteApp(app); }
});
