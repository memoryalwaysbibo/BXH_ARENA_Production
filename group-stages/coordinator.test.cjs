'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createCoordinator } = require('./coordinator.cjs');
const { createGroupStageCommand } = require('./command.cjs');
const { createGroupSettlement } = require('./settlement.cjs');
const { roster, finish } = require('./test-fixtures.cjs');
const buckets = require('../referee-seats/functions/bucket-state.cjs');

const project = 'demo-bxh-group-stages';
assert.equal(process.env.GCLOUD_PROJECT, project);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8199');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

test('group-stage rehearsal covers two and four groups', async t => {
  const app = initializeApp({ projectId: project });
  const db = getFirestore(app);
  try {
    const { groupStageCommand } = require('./firebase-entry.cjs');
    assert(groupStageCommand.__endpoint.callableTrigger);
    const scenarios = [
      { parentCode: 'BXH-FULL01', sizes: [96, 96, 96, 96] },
      { parentCode: 'BXH-ALMOST', sizes: [96, 96, 96, 95], manualChampionsFirst: true },
      { parentCode: 'BXH-TWO128', sizes: [64, 64] },
    ];
    for (const { parentCode, sizes: expectedSizes, manualChampionsFirst } of scenarios) {
      const groupCount = expectedSizes.length;
      const eligibleCount = expectedSizes.reduce((total, size) => total + size, 0);
      await t.test(eligibleCount + ' checked-in players in ' + groupCount + ' groups', async t => {
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
        const prepared = await command({
          auth: { uid: operator },
          data: { action: 'prepare', parentCode, ...(groupCount === 2 ? { groupCount } : {}) },
        });
        assert.deepEqual(prepared.groups.map(group => group.count), expectedSizes);
        await assert.rejects(coordinator.prepare(parentCode, operator, groupCount === 2 ? 4 : 2),
          { code: 'group-count-locked' });
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
        await assert.rejects(command({ auth: { uid: operator },
          data: { action: 'settlement-preview', parentCode } }), { code: 'group-stage-incomplete' });

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
        const playoffs = groupCount === 4 && !manualChampionsFirst
          ? ['runners-up', 'champions'] : ['champions', 'runners-up'];
        const steps = [...prepared.groups.map(group => group.key), ...playoffs];
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
          const isPlayoff = index >= groupCount;
          assert.equal(state.players.length, isPlayoff ? groupCount : expectedSizes[index]);
          assert.equal(state.meta.stations, isPlayoff ? 2 : 12);
          assert.equal(state.meta.bronzeMatch, isPlayoff && groupCount === 4);
          if (isPlayoff && groupCount === 2) {
            assert.match(state.meta.name, key === 'champions' ? /第 1～2 名賽$/ : /第 3～4 名賽$/);
          }
          assert.equal(room.data().ladderMode, 'general');
          assert.equal(mirror.data().registrationEnabled, false);
          assert(!JSON.stringify(mirror.data()).includes('user-'));

          const done = finish({ players: state.players, bronzeMatch: state.meta.bronzeMatch });
          const viewerUid = state.players[0].registrationUid;
          if (isPlayoff) {
            if (index === groupCount) {
              await assert.rejects(coordinator.openNext(parentCode, playoffs[1], operator),
                { code: 'group-stage-order' });
            }
            assert.equal((await coordinator.readOperatorStatus(parentCode, operator)).current.drawPending, true);
            const waiting = await coordinator.readRouting(parentCode, viewerUid);
            assert.equal(waiting.drawPending, true);
            assert.equal(waiting.roomCode, null);
            await assert.rejects(coordinator.publishDraw(parentCode, key, code, operator),
              { code: 'group-draw-not-ready' });
            await assert.rejects(coordinator.collect(parentCode, key, code, operator),
              { code: 'group-draw-not-published' });
            const matches = done.matches.filter(match => match.bracket === 'SE').map(match => ({
              ...match, completed: false, winnerId: null, loserId: null,
            }));
            await privateRoom.update({ data: JSON.stringify({ ...state, drawnAt: 1, bracketSize: done.bracketSize, matches }) });
            await groupStageCommand.run({
              auth: { uid: operator }, data: { action: 'publish-draw', parentCode, stage: key, roomCode: code },
            });
          }

          const viewer = await coordinator.readRouting(parentCode, viewerUid);
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

          await privateRoom.update({ data: JSON.stringify({ ...state, ...done, meta: state.meta }) });
          const collectStarted = performance.now();
          const [collected, repeatedCollect] = await Promise.all([
            coordinator.collect(parentCode, key, code, operator),
            coordinator.collect(parentCode, key, code, operator),
          ]);
          collectTimes.push(performance.now() - collectStarted);
          assert.deepEqual(repeatedCollect, collected);
          assert.equal((await coordinator.readRouting(parentCode, state.players[0].registrationUid)).roomCode, null);
          if (index === groupCount - 1 && groupCount === 4) {
            assert.equal(collected.next, 'runners-up');
            assert.deepEqual(collected.openChoices, ['runners-up', 'champions']);
            await routing.update({ next: 'champions' });
            assert.deepEqual(await coordinator.readOperatorStatus(parentCode, operator), collected);
          } else {
            assert.equal(collected.next, steps[index + 1] || null);
            assert.equal(collected.openChoices, undefined);
          }
          assert.deepEqual(await coordinator.collect(parentCode, key, code, operator), collected);
          assert.deepEqual(await coordinator.openNext(parentCode, key, operator), collected);
        }

        const input = await db.runTransaction(tx => coordinator.readSettlement(tx, parentCode));
        assert.equal(input.effectiveCount, eligibleCount);
        assert.equal(input.participants.length, eligibleCount);
        assert.equal(input.matches.length, groupCount === 4 ? eligibleCount + 4 : eligibleCount);
        assert.equal(new Set(input.matches.map(match => match.id)).size, input.matches.length);
        assert.equal(input.topEight.length, groupCount * 2);
        assert.equal((await childRooms.get()).size, steps.length);
        assert.equal(input.participants.filter(player => player.placement === groupCount * 2 + 1).length, groupCount * 2);
        assert.equal((await db.collection('ladderTransactions').where('eventCode', '==', parentCode).get()).size, 0);
        const preview = await command({ auth: { uid: operator },
          data: { action: 'settlement-preview', parentCode } });
        assert.equal(preview.eventCode, parentCode);
        assert.equal(preview.eligibleCount, eligibleCount);
        assert.equal(preview.effectiveCount, eligibleCount);
        assert.equal(preview.matchCount, input.matches.length);
        assert.equal(Object.values(preview.placements).reduce((a, b) => a + b, 0), eligibleCount);
        assert.equal(preview.pointsTotal, input.participants.reduce((a, p) => a + p.pointsEarned, 0));
        assert.equal(preview.previewOnly, true);
        assert(!JSON.stringify(preview).includes('user-'));
        await assert.rejects(command({ auth: { uid: 'outside' },
          data: { action: 'settlement-preview', parentCode } }), { code: 'group-permission-denied' });
        assert.equal((await db.collection('ladderTransactions').where('eventCode', '==', parentCode).get()).size, 0);
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
        await parent.set(parentData);
        if (eligibleCount === 384) {
          const mirror = db.doc('publicTournaments/' + parentCode);
          await mirror.set({ bracketView: '{invalid' });
          await db.doc('ladderSystem/current').set({ status: 'active', currentSeason: 'S1' });
          const settle = createGroupSettlement(db, coordinator, {
            clock: () => 1000, serverTimestamp: () => 1000,
          });
          await assert.rejects(settle(parentCode, 'outside'), { code: 'group-permission-denied' });
          await assert.rejects(settle(parentCode, operator), { code: 'group-public-view-invalid' });
          assert.equal((await db.collection('ladderTransactions').where('eventCode', '==', parentCode).get()).size, 0);
          assert.equal((await db.collection('ladderPlayers').get()).size, 0);
          assert.equal((await parent.get()).data().ladderPointsAwarded, undefined);
          await mirror.set({ bracketView: JSON.stringify({ status: 'ready' }) });
          const [awarded, repeated] = await Promise.all([
            settle(parentCode, operator), settle(parentCode, operator),
          ]);
          assert.equal(awarded.ok, true);
          assert.equal(awarded.effectiveCount, 384);
          assert.equal(awarded.creditedCount, 384);
          assert.equal((await db.collection('ladderTransactions').where('eventCode', '==', parentCode).get()).size, 384);
          assert.equal((await db.collection('ladderPlayers').get()).size, 384);
          const champion = input.participants.find(row => row.placement === 1);
          const championUid = champion.player.registrationUid;
          const ledger = (await db.doc('ladderTransactions/' + parentCode + '_' + championUid).get()).data();
          assert.equal(ledger.pointsEarned, champion.pointsEarned);
          assert.equal(ledger.eventCode, parentCode);
          assert.equal((await db.doc('ladderPlayers/' + championUid).get()).data().seasonPoints, champion.pointsEarned);
          assert.equal((await db.doc('groupStagePlans/' + parentCode).get()).data().settlement.creditedCount, 384);
          assert.equal((await parent.get()).data().archiveStatus, 'completed');
          assert.equal(JSON.parse((await mirror.get()).data().bracketView).archiveStatus, 'completed');
          assert.equal(awarded.alreadyAwarded || repeated.alreadyAwarded, true);
          const replay = await settle(parentCode, operator);
          assert.equal(replay.alreadyAwarded, true);
          assert.equal((await db.collection('ladderTransactions').where('eventCode', '==', parentCode).get()).size, 384);
        }
      });
    }
  } finally {
    await db.terminate();
    await deleteApp(app);
  }
});

test('private general-room rehearsal collects a 320-player event without a ladder input', async () => {
  const app = initializeApp({ projectId: project });
  const db = getFirestore(app);
  try {
    const parentCode = 'BXH-GROUPT', operator = 'rehearsal-admin';
    const parent = db.doc('tournaments/' + parentCode);
    const gate = db.doc('systemConfig/groupStages');
    const coordinator = createCoordinator(db);
    const players = Array.from({ length: 320 }, (_, index) => ({
      id: 'guest-' + index,
      name: 'Fixture ' + index,
      source: 'onsite',
      participantType: 'onsite_guest',
      checkedIn: true,
      accountLinked: false,
      activityEligible: false,
      ladderEligible: false,
    }));
    const parentState = {
      id: 'private-rehearsal',
      meta: { name: 'Rehearsal', formatType: 'single', battleMode: 'individual',
        playMode: 'standard', ladderMode: 'general', registrationVisibility: 'private',
        registrationEnabled: false },
      players, matches: [],
    };
    const parentData = {
      eventAuthority: 'official', ladderMode: 'general', createdBy: operator,
      registrationEnabled: false, visibility: 'private', data: JSON.stringify(parentState),
    };
    const enabled = { enabled: true, parentCodes: [parentCode] };
    await Promise.all([
      parent.set(parentData),
      db.doc('users/' + operator).set({ active: true, role: 'admin' }),
      gate.set(enabled),
    ]);
    await assert.rejects(coordinator.prepare(parentCode, operator, 4), { code: 'group-parent-unavailable' });
    await gate.set({ ...enabled, rehearsalParentCodes: [parentCode] });
    await parent.update({ visibility: 'public' });
    await assert.rejects(coordinator.prepare(parentCode, operator, 4), { code: 'group-parent-unavailable' });
    await parent.set({ ...parentData, data: JSON.stringify({
      ...parentState, players: [{ ...players[0], playerUid: 'linked-account' }, ...players.slice(1)],
    }) });
    await assert.rejects(coordinator.prepare(parentCode, operator, 4), { code: 'group-rehearsal-linked-roster' });
    await parent.set(parentData);
    assert.deepEqual(await coordinator.readOperatorStatus(parentCode, operator),
      { unprepared: true, rehearsal: true });
    await assert.rejects(coordinator.readRouting(parentCode, operator), { code: 'group-room-disabled' });

    let status = await coordinator.prepare(parentCode, operator, 4);
    await gate.set(enabled);
    await assert.rejects(coordinator.readOperatorStatus(parentCode, operator), { code: 'group-room-disabled' });
    await assert.rejects(coordinator.openNext(parentCode, 'A', operator), { code: 'group-room-disabled' });
    await gate.set({ ...enabled, rehearsalParentCodes: [parentCode] });
    assert.equal(status.rehearsal, true);
    assert.deepEqual(status.groups.map(group => group.count), [80, 80, 80, 80]);
    while (status.next) {
      const key = status.next;
      const { current } = await coordinator.openNext(parentCode, key, operator);
      const child = db.doc('tournaments/' + current.code);
      const mirror = db.doc('publicTournaments/' + current.code);
      const [childSnap, mirrorSnap] = await db.getAll(child, mirror);
      const room = childSnap.data(), state = JSON.parse(room.data);
      assert.equal(room.ladderMode, 'general');
      assert.equal(room.visibility, 'private');
      assert.equal(mirrorSnap.data().visibility, 'private');
      assert.equal(state.meta.registrationVisibility, 'private');
      assert(state.players.every(player => player.ladderEligible === false));
      const done = finish({ players: state.players, bronzeMatch: state.meta.bronzeMatch });
      if (current.drawPending) {
        await child.update({ data: JSON.stringify({ ...state, drawnAt: 1, bracketSize: done.bracketSize,
          matches: done.matches.filter(match => match.bracket === 'SE').map(match => ({
            ...match, completed: false, winnerId: null, loserId: null,
          })) }) });
        await coordinator.publishDraw(parentCode, key, current.code, operator);
      }
      const archived = { ...state, ...done, meta: state.meta };
      if (key === 'A') {
        archived.matches.filter(match => !match.isBye).forEach((match, index) => { match.station = index % 12 + 1; });
        const manifest = buckets.makeManifest(archived, 'rehearsal-scores');
        const canonical = buckets.encode(archived, manifest);
        const staleMatch = archived.matches.find(match => !match.isBye);
        staleMatch.winnerId = null;
        await child.update({ scoreStorage: manifest, data: JSON.stringify(archived) });
        await assert.rejects(coordinator.collect(parentCode, key, current.code, operator),
          { code: 'group-stage-score-unavailable' });
        await Promise.all(canonical.map(bucket => child.collection('matchBuckets').doc(bucket.bucketId).set(bucket)));
      } else {
        await child.update({ data: JSON.stringify(archived) });
      }
      status = await coordinator.collect(parentCode, key, current.code, operator);
    }
    assert.equal(status.readyForSettlement, true);
    assert.equal(status.completed.length, 6);
    await assert.rejects(db.runTransaction(tx => coordinator.readSettlement(tx, parentCode)),
      { code: 'group-rehearsal-no-ladder' });
    await assert.rejects(coordinator.previewSettlement(parentCode, operator),
      { code: 'group-rehearsal-no-ladder' });
    assert.deepEqual((await parent.get()).data(), parentData);
    assert.equal((await db.collection('ladderTransactions').where('eventCode', '==', parentCode).get()).size, 0);
  } finally {
    await deleteApp(app);
  }
});

test('one server transaction pre-draws four 80-player child rooms', async () => {
  const app = initializeApp({ projectId: project });
  const db = getFirestore(app);
  try {
    const parentCode = 'BXH-ONEDRW', operator = 'batch-admin';
    const players = Array.from({ length: 320 }, (_, index) => ({
      id: 'batch-' + index, name: 'Guest ' + index, source: 'onsite',
      participantType: 'onsite_guest', accountLinked: false,
      ladderEligible: false, activityEligible: false,
    }));
    await Promise.all([
      db.doc('users/' + operator).set({ active: true, role: 'admin' }),
      db.doc('systemConfig/groupStages').set({ enabled: true,
        parentCodes: [parentCode], rehearsalParentCodes: [parentCode] }),
      db.doc('tournaments/' + parentCode).set({
        eventAuthority: 'official', ladderMode: 'general', createdBy: operator,
        visibility: 'private', registrationEnabled: false,
        data: JSON.stringify({ id: 'batch-parent', players, matches: [],
          meta: { name: 'Batch rehearsal', ladderMode: 'general', formatType: 'single',
            battleMode: 'individual', playMode: 'standard',
            registrationVisibility: 'private', registrationEnabled: false } }),
      }),
    ]);
    const coordinator = createCoordinator(db);
    assert.equal((await coordinator.prepare(parentCode, operator, 4)).drawAllPending, true);
    const opened = await coordinator.openAllGroups(parentCode, operator);
    assert.equal(opened.current.key, 'A');
    assert.deepEqual(opened.groups.map(group => group.count), [80, 80, 80, 80]);
    assert.deepEqual(await coordinator.openAllGroups(parentCode, operator), opened);
    const plan = (await db.doc('groupStagePlans/' + parentCode).get()).data();
    const entrants = new Set();
    for (const [key, code] of Object.entries(plan.roomCodes)) {
      const [child, mirror] = await db.getAll(
        db.doc('tournaments/' + code), db.doc('publicTournaments/' + code));
      const state = JSON.parse(child.data().data);
      assert.equal(state.groupStage.key, key);
      assert.equal(state.matches.length, 127);
      assert.equal(state.meta.stations, 12);
      assert(state.drawnAt && !state.startedAt);
      assert.equal(JSON.parse(mirror.data().bracketView).matches.length, 127);
      for (const player of state.players) {
        assert(!entrants.has(player.id));
        entrants.add(player.id);
      }
    }
    assert.equal(entrants.size, 320);
    let status = opened;
    for (const key of ['A', 'B', 'C', 'D']) {
      if (key !== 'A') status = await coordinator.openNext(parentCode, key, operator);
      assert.equal(status.current.code, plan.roomCodes[key]);
      const child = db.doc('tournaments/' + status.current.code);
      const state = JSON.parse((await child.get()).data().data);
      const done = finish({ players: state.players, bronzeMatch: false });
      await child.update({ data: JSON.stringify({ ...state, ...done, meta: state.meta }) });
      status = await coordinator.collect(parentCode, key, status.current.code, operator);
    }
    assert.equal(status.next, 'runners-up');
    assert.deepEqual(status.openChoices, ['runners-up', 'champions']);
    const chosen = await coordinator.openNext(parentCode, 'champions', operator);
    assert.equal(chosen.current.key, 'champions');
    assert.equal(chosen.current.drawPending, true);
    assert.equal((await db.collection('ladderTransactions').where('eventCode', '==', parentCode).get()).size, 0);
  } finally {
    await deleteApp(app);
  }
});
