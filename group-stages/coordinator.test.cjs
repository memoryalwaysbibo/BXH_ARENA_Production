'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createCoordinator } = require('./coordinator.cjs');
const { createGroupStageCommand } = require('./command.cjs');
const { roster, finish } = require('./test-fixtures.cjs');

const project = 'demo-bxh-group-stages';
assert.equal(process.env.GCLOUD_PROJECT, project);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8199');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

test('320-player master routes six Firestore child rooms and reads a single settlement input', async () => {
  const app = initializeApp({ projectId: project });
  const db = getFirestore(app);
  try {
    const { groupStageCommand } = require('./firebase-entry.cjs');
    assert(groupStageCommand.__endpoint.callableTrigger);
    const parentCode = 'BXH-PARENT';
    const parent = db.doc('tournaments/' + parentCode);
    const players = [...roster(320), {
      id: 'unchecked', name: 'Unchecked', source: 'online', registrationUid: 'absent', checkedIn: false,
    }];
    const parentData = {
      eventAuthority: 'official', ladderMode: 'ranked', createdBy: 'operator',
      data: JSON.stringify({
        id: 'original-room',
        meta: { name: 'Test', formatType: 'single', battleMode: 'individual', playMode: 'standard', checkinRequired: true },
        players, matches: [], startedAt: null,
      }),
    };
    await parent.set(parentData);
    await db.doc('users/operator').set({ active: true, role: 'admin' });
    await db.doc('users/outside').set({ active: true, role: 'player' });
    const registrations = db.batch(), profiles = db.batch();
    for (const player of players) {
      const uid = player.registrationUid;
      profiles.set(db.doc('users/' + uid), { active: true, role: 'player' });
      if (player.checkedIn) {
        registrations.set(parent.collection('registrations').doc(player.registrationId), { uid, status: 'confirmed' });
      }
    }
    await Promise.all([registrations.commit(), profiles.commit()]);
    const operator = 'operator';
    const gate = db.doc('systemConfig/groupStages');
    let codes = 0;
    const coordinator = createCoordinator(db, {
      clock: () => 1,
      drawSeed: () => 'isolated-fixture',
      newCode: () => 'BXH-' + String(++codes).padStart(6, '0'),
    });
    const command = createGroupStageCommand(coordinator);
    await assert.rejects(command({ data: { action: 'prepare', parentCode, actorUid: operator } }),
      { code: 'group-auth-required' });
    await assert.rejects(groupStageCommand.run({ data: { action: 'prepare', parentCode, actorUid: operator } }),
      { code: 'unauthenticated' });
    await assert.rejects(coordinator.prepare(parentCode, operator), { code: 'group-room-disabled' });
    await gate.set({ enabled: true, parentCodes: [parentCode] });
    await assert.rejects(coordinator.prepare(parentCode, 'outside'), { code: 'group-permission-denied' });
    const badEntry = parent.collection('registrations').doc(players[0].registrationId);
    await badEntry.update({ status: 'waitlist' });
    await assert.rejects(coordinator.prepare(parentCode, operator), { code: 'group-registration-mismatch' });
    await badEntry.update({ status: 'confirmed' });
    const groupSizes = [96, 80, 80, 64];
    const prepared = await command({ auth: { uid: operator }, data: { action: 'prepare', parentCode, groupSizes } });
    assert.deepEqual(prepared.groups.map(group => group.count), groupSizes);
    const routing = db.doc('groupStageRoutes/' + parentCode);
    assert.equal((await routing.collection('players').get()).size, 320);
    assert(JSON.stringify((await routing.get()).data()).length < 1000);
    const clientRead = await fetch('http://127.0.0.1:8199/v1/projects/' + project +
      '/databases/(default)/documents/' + routing.path);
    assert.equal(clientRead.status, 403);
    assert.deepEqual(await coordinator.prepare(parentCode, operator), prepared);
    assert.deepEqual(await coordinator.prepare(parentCode, operator, groupSizes), prepared);
    await assert.rejects(coordinator.prepare(parentCode, operator, [80, 80, 80, 80]),
      { code: 'group-plan-already-prepared' });
    await assert.rejects(coordinator.openNext(parentCode, 'B', operator), { code: 'group-stage-order' });
    await assert.rejects(db.runTransaction(tx => coordinator.readSettlement(tx, parentCode)),
      { code: 'group-stage-incomplete' });

    const steps = ['A', 'B', 'C', 'D', 'champions', 'runners-up'];
    for (const [index, key] of steps.entries()) {
      const status = await coordinator.openNext(parentCode, key, operator);
      assert.equal(status.current.key, key);
      assert.deepEqual(await coordinator.openNext(parentCode, key, operator), status);
      const code = status.current.code;
      const privateRoom = db.doc('tournaments/' + code);
      const publicRoom = db.doc('publicTournaments/' + code);
      const [room, mirror] = await db.getAll(privateRoom, publicRoom);
      const state = JSON.parse(room.data().data);
      assert.equal(state.players.length, index < 4 ? groupSizes[index] : 4);
      assert.equal(state.meta.stations, index < 4 ? 12 : 2);
      assert.equal(room.data().ladderMode, 'general');
      assert.equal(mirror.data().registrationEnabled, false);
      assert(!JSON.stringify(mirror.data()).includes('user-'));

      const viewer = await coordinator.readRouting(parentCode, state.players[0].registrationUid);
      assert.equal(viewer.roomCode, code);
      assert.deepEqual(await groupStageCommand.run({
        auth: { uid: state.players[0].registrationUid }, data: { action: 'routing', parentCode },
      }), viewer);
      assert.equal(viewer.assignedGroups.length, 1);
      assert.equal((await coordinator.readRouting(parentCode, 'outside')).roomCode, null);
      await assert.rejects(coordinator.collect(parentCode, key, code, operator), { code: 'group-stage-not-complete' });

      const done = finish({ players: state.players, bronzeMatch: state.meta.bronzeMatch });
      await privateRoom.update({ data: JSON.stringify({ ...state, ...done, meta: state.meta }) });
      const collected = await coordinator.collect(parentCode, key, code, operator);
      assert.equal(collected.next, steps[index + 1] || null);
      assert.deepEqual(await coordinator.collect(parentCode, key, code, operator), collected);
      assert.deepEqual(await coordinator.openNext(parentCode, key, operator), collected);
    }

    const input = await db.runTransaction(tx => coordinator.readSettlement(tx, parentCode));
    assert.equal(input.effectiveCount, 320);
    assert.equal(input.participants.length, 320);
    assert.equal(input.topEight.length, 8);
    assert.equal((await db.collection('tournaments').get()).size, 7);
    assert.equal((await db.collection('ladderTransactions').get()).size, 0);
    assert.deepEqual((await parent.get()).data(), parentData);
    await badEntry.update({ status: 'cancelled' });
    await assert.rejects(db.runTransaction(tx => coordinator.readSettlement(tx, parentCode)),
      { code: 'group-registration-mismatch' });
    await badEntry.update({ status: 'confirmed' });
    await parent.update({ data: JSON.stringify({ ...JSON.parse(parentData.data), players: players.slice(1) }) });
    await assert.rejects(db.runTransaction(tx => coordinator.readSettlement(tx, parentCode)),
      { code: 'group-parent-roster-changed' });
  } finally {
    await db.terminate();
    await deleteApp(app);
  }
});
