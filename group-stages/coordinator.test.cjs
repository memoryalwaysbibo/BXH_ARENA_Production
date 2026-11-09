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

test('group-stage rehearsal covers full and almost-full events', async t => {
  const app = initializeApp({ projectId: project });
  const db = getFirestore(app);
  try {
    const { groupStageCommand } = require('./firebase-entry.cjs');
    assert(groupStageCommand.__endpoint.callableTrigger);
    for (const eligibleCount of [384, 383]) {
      await t.test(eligibleCount + ' checked-in players', async t => {
        const parentCode = eligibleCount === 384 ? 'BXH-FULL01' : 'BXH-ALMOST';
        const parent = db.doc('tournaments/' + parentCode);
        const players = [...roster(eligibleCount), {
          id: 'unchecked', name: 'Unchecked', source: 'online',
          registrationId: 'reg-absent', registrationUid: 'absent', checkedIn: false,
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
          registrations.set(parent.collection('registrations').doc(player.registrationId), { uid, status: 'confirmed' });
        }
        await Promise.all([registrations.commit(), profiles.commit()]);
        const operator = 'operator';
        const gate = db.doc('systemConfig/groupStages');
        let codes = eligibleCount * 100;
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
        const prepared = await command({ auth: { uid: operator }, data: { action: 'prepare', parentCode } });
        const expectedSizes = eligibleCount === 384 ? [96, 96, 96, 96] : [96, 96, 96, 95];
        assert.deepEqual(prepared.groups.map(group => group.count), expectedSizes);
        const routing = db.doc('groupStageRoutes/' + parentCode);
        assert.equal((await routing.collection('players').get()).size, eligibleCount);
        assert(JSON.stringify((await routing.get()).data()).length < 1000);
        const clientRead = await fetch('http://127.0.0.1:8199/v1/projects/' + project +
          '/databases/(default)/documents/' + routing.path);
        assert.equal(clientRead.status, 403);
        assert.deepEqual(await coordinator.prepare(parentCode, operator), prepared);
        await assert.rejects(coordinator.openNext(parentCode, 'B', operator), { code: 'group-stage-order' });
        await assert.rejects(db.runTransaction(tx => coordinator.readSettlement(tx, parentCode)),
          { code: 'group-stage-incomplete' });

        const lateCheckIn = JSON.parse(parentData.data);
        lateCheckIn.players.at(-1).checkedIn = true;
        await parent.update({ data: JSON.stringify(lateCheckIn) });
        await assert.rejects(coordinator.openNext(parentCode, 'A', operator),
          { code: 'group-parent-roster-changed' });
        await parent.set(parentData);

        const plan = (await db.doc('groupStagePlans/' + parentCode).get()).data();
        const firstGroupEntry = parent.collection('registrations').doc(plan.event.groups.A[0].registrationId);
        await firstGroupEntry.update({ status: 'cancelled' });
        await assert.rejects(coordinator.openNext(parentCode, 'A', operator),
          { code: 'group-registration-mismatch' });
        await firstGroupEntry.update({ status: 'confirmed' });

        const childRooms = db.collection('tournaments').where('groupStage.parentCode', '==', parentCode);
        assert.equal((await childRooms.get()).size, 0);
        const steps = ['A', 'B', 'C', 'D', 'champions', 'runners-up'];
        const openTimes = [], collectTimes = [];
        for (const [index, key] of steps.entries()) {
          const openStarted = performance.now();
          const [status, repeatedOpen] = await Promise.all([
            coordinator.openNext(parentCode, key, operator),
            coordinator.openNext(parentCode, key, operator),
          ]);
          openTimes.push(performance.now() - openStarted);
          assert.deepEqual(repeatedOpen, status);
          assert.equal((await childRooms.get()).size, index + 1);
          assert.equal(status.current.key, key);
          assert.deepEqual(await coordinator.openNext(parentCode, key, operator), status);
          const code = status.current.code;
          const privateRoom = db.doc('tournaments/' + code);
          const publicRoom = db.doc('publicTournaments/' + code);
          const [room, mirror] = await db.getAll(privateRoom, publicRoom);
          const state = JSON.parse(room.data().data);
          assert.equal(state.players.length, index < 4 ? expectedSizes[index] : 4);
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
          if (index === 0 && eligibleCount === 384) {
            const groupAccounts = new Set(state.players.map(player => player.registrationUid));
            const started = performance.now();
            const timings = await Promise.all(players.filter(player => player.checkedIn).map(async player => {
              const result = await groupStageCommand.run({
                auth: { uid: player.registrationUid }, data: { action: 'routing', parentCode },
              });
              assert.equal(result.current, 'A');
              assert.equal(result.roomCode, groupAccounts.has(player.registrationUid) ? code : null);
              assert.equal(result.assignedGroups.length, 1);
              assert.equal('eligibleUids' in result, false);
              return performance.now() - started;
            }));
            timings.sort((a, b) => a - b);
            t.diagnostic(JSON.stringify({
              requests: timings.length,
              admitted: groupAccounts.size,
              waiting: timings.length - groupAccounts.size,
              p95Ms: Math.round(timings[Math.ceil(timings.length * 0.95) - 1]),
              totalMs: Math.round(timings.at(-1)),
            }));
          }
          await assert.rejects(coordinator.collect(parentCode, key, code, operator), { code: 'group-stage-not-complete' });

          const done = finish({ players: state.players, bronzeMatch: state.meta.bronzeMatch });
          await privateRoom.update({ data: JSON.stringify({ ...state, ...done, meta: state.meta }) });
          const collectStarted = performance.now();
          const [collected, repeatedCollect] = await Promise.all([
            coordinator.collect(parentCode, key, code, operator),
            coordinator.collect(parentCode, key, code, operator),
          ]);
          collectTimes.push(performance.now() - collectStarted);
          assert.deepEqual(repeatedCollect, collected);
          assert.equal((await coordinator.readRouting(parentCode, state.players[0].registrationUid)).roomCode, null);
          assert.equal(collected.next, steps[index + 1] || null);
          assert.deepEqual(await coordinator.collect(parentCode, key, code, operator), collected);
          assert.deepEqual(await coordinator.openNext(parentCode, key, operator), collected);
        }

        const input = await db.runTransaction(tx => coordinator.readSettlement(tx, parentCode));
        assert.equal(input.effectiveCount, eligibleCount);
        assert.equal(input.participants.length, eligibleCount);
        assert.equal(input.matches.length, eligibleCount + 4);
        assert.equal(new Set(input.matches.map(match => match.id)).size, input.matches.length);
        assert.equal(input.topEight.length, 8);
        assert.equal((await childRooms.get()).size, 6);
        assert.equal((await db.collection('ladderTransactions').get()).size, 0);
        t.diagnostic(JSON.stringify({
          eligibleCount,
          groupSizes: expectedSizes,
          matches: input.matches.length,
          slowestConcurrentOpenMs: Math.round(Math.max(...openTimes)),
          slowestConcurrentCollectMs: Math.round(Math.max(...collectTimes)),
        }));
        assert.deepEqual((await parent.get()).data(), parentData);
        await badEntry.update({ status: 'cancelled' });
        await assert.rejects(db.runTransaction(tx => coordinator.readSettlement(tx, parentCode)),
          { code: 'group-registration-mismatch' });
        await badEntry.update({ status: 'confirmed' });
        await parent.update({ data: JSON.stringify({ ...JSON.parse(parentData.data), players: players.slice(1) }) });
        await assert.rejects(db.runTransaction(tx => coordinator.readSettlement(tx, parentCode)),
          { code: 'group-parent-roster-changed' });
      });
    }
  } finally {
    await db.terminate();
    await deleteApp(app);
  }
});
