'use strict';

const { randomBytes } = require('node:crypto');
const buckets = require('../referee-seats/functions/bucket-state.cjs');
const { GROUPS, groupKeys, prepare, nextStage, collect, settlementInput } = require('./core.cjs');
const { drawGroup } = require('./draw.cjs');
const courtPool = require('./court-pool.cjs');

const ROOM_CODE = /^BXH-[A-Z0-9]{6}$/;
function stageTitle(stage) {
  if (GROUPS.includes(stage.key)) return stage.key + ' 組';
  const count = stage.players.length;
  return stage.key === 'champions' ? '第 1～' + count + ' 名賽' :
    '第 ' + (count + 1) + '～' + (count * 2) + ' 名賽';
}

function check(condition, code) {
  if (!condition) throw Object.assign(new Error(code), { code });
}

function roomState(document) {
  return typeof document?.data === 'string' ? JSON.parse(document.data) : document?.data;
}

function startingRoster(parent, rehearsal = false) {
  const state = roomState(parent);
  const allowedMode = rehearsal
    ? parent?.ladderMode === 'general' && state?.meta?.ladderMode === 'general' &&
      parent.visibility === 'private' && state.meta.registrationVisibility === 'private' &&
      parent.registrationEnabled === false && state.meta.registrationEnabled === false
    : parent?.ladderMode === 'ranked';
  check(parent?.eventAuthority === 'official' && allowedMode &&
    typeof state?.id === 'string' && state.id.length > 0 && Array.isArray(state.players) &&
    state.meta?.formatType === 'single' && state.meta.battleMode === 'individual' &&
    state.meta.playMode === 'standard' && !state.startedAt && !state.matches?.length &&
    state.archiveStatus !== 'completed' && !parent.ladderPointsAwarded && !state.testMode && !state.meta.eventCancelled,
  'group-parent-unavailable');
  if (rehearsal) {
    check(state.players.every(player => player.source === 'onsite' && player.participantType === 'onsite_guest' &&
      player.accountLinked === false && player.ladderEligible === false && player.activityEligible === false &&
      ![player.registrationId, player.regId, player.familyPlayerId, player.guardianUid, player.registrationUid,
        player.accountUid, player.playerUid, player.uid, player.userUid, player.authUid, player.playerId].some(Boolean)),
    'group-rehearsal-linked-roster');
  }
  return state.players.filter(player => !state.meta.checkinRequired || player.checkedIn === true);
}

function publicStatus(plan) {
  const running = plan.parallel && plan.groupDrawAll
    ? groupKeys(plan.event).filter(key => !Object.hasOwn(plan.event.results, key)) : [];
  return {
    groups: groupKeys(plan.event).map(key => ({ key, count: plan.event.groups[key].length })),
    completed: Object.keys(plan.event.results),
    current: plan.active ? { ...plan.active } : null,
    next: plan.active || running.length ? null : nextStage(plan.event)?.key || null,
    drawAllPending: !plan.active && !Object.keys(plan.roomCodes).length &&
      !Object.keys(plan.event.results).length,
    readyForSettlement: !nextStage(plan.event),
    ...(plan.rehearsal ? { rehearsal: true } : {}),
    ...(plan.parallel ? { parallel: true, runningGroups: running.map(key => ({ key, code: plan.roomCodes[key] })) } : {}),
  };
}

function operatorStatus(plan) {
  const status = publicStatus(plan);
  if (plan.groupDrawAll !== true) return status;
  return { ...status, ...(plan.courts ? { courts: plan.courts } : {}), preDrawnRooms: Object.fromEntries(
    groupKeys(plan.event).filter(key => plan.roomCodes[key])
      .map(key => [key, plan.roomCodes[key]])) };
}

function onlineAccount(player) {
  return player.source === 'online'
    ? (player.familyPlayerId ? player.guardianUid : player.registrationUid)
    : null;
}

function stageRoom(parent, stage, parentCode, code, now, rehearsal, sharedCourts = false) {
  const { meta: source } = roomState(parent);
  const meta = {
    name: source.name + '｜' + stageTitle(stage),
    date: source.date || '',
    location: source.location || '',
    format: '單淘汰賽',
    formatType: 'single',
    battleMode: 'individual',
    playMode: 'standard',
    scoringMode: 'standard',
    roundScoringModes: {},
    eventAuthority: 'official',
    ladderMode: 'general',
    roomAccessMode: 'public',
    stations: GROUPS.includes(stage.key) ? 12 : 2,
    bronzeMatch: stage.bronzeMatch,
    registrationEnabled: false,
    ...(rehearsal ? { registrationVisibility: 'private' } : {}),
    checkinRequired: false,
    assignedStaffUids: source.assignedStaffUids || [],
  };
  const link = { parentCode, key: stage.key, ...(sharedCourts ? { sharedCourts: true } : {}) };
  const id = parentCode + ':' + stage.key;
  const data = {
    id, meta, cloudCode: code, createdAt: now, updatedAt: now, archiveStatus: 'ongoing',
    settlementPhase: 'idle', createdBy: parent.createdBy, ownerUid: parent.ownerUid || parent.createdBy,
    players: stage.players, matches: [], registrations: [], teams: [], courtAssignments: {}, groupStage: link,
    bracketSize: 0, startedAt: null, drawnAt: null, currentMatchId: null, rosterLocked: false,
  };
  const shared = {
    name: meta.name, location: meta.location, eventDate: meta.date, updatedAt: now,
    visibility: rehearsal ? 'private' : 'public',
    ...(rehearsal ? { registrationVisibility: 'private' } : {}),
    tournamentPhase: 'waiting', eventAuthority: 'official', ladderMode: 'general',
    formatType: 'single', battleMode: 'individual', playMode: 'standard',
    registrationEnabled: false, registrationStatus: 'closed', groupStage: link,
    confirmedCount: 0, waitlistCount: 0,
  };
  return {
    privateDocument: { ...shared, createdBy: data.createdBy, ownerUid: data.ownerUid,
      assignedStaffUids: meta.assignedStaffUids, data: JSON.stringify(data) },
    publicDocument: { ...shared, bracketView: JSON.stringify({
      meta: { name: meta.name, date: meta.date, location: meta.location, stations: meta.stations,
        bronzeMatch: meta.bronzeMatch, formatType: 'single', ladderMode: 'general' },
      players: [], matches: [], archiveStatus: 'ongoing',
    }) },
  };
}

function publicDraw(state) {
  return {
    meta: { name: state.meta.name, date: state.meta.date, location: state.meta.location,
      stations: state.meta.stations, bronzeMatch: false, formatType: 'single',
      ladderMode: 'general', eventAuthority: 'official' },
    players: state.players.map(player => ({ id: player.id, name: player.name,
      checkedIn: !!player.checkedIn })),
    matches: state.matches.map(match => ({
      id: match.id, seq: match.seq, bracket: match.bracket, round: match.round,
      indexInRound: match.indexInRound, station: match.station,
      a: match.a ? { playerId: match.a.playerId } : null,
      b: match.b ? { playerId: match.b.playerId } : null,
      isBye: match.isBye, scoreA: 0, scoreB: 0, log: [],
      winnerId: match.winnerId, loserId: null, completed: match.completed,
      status: match.status,
    })),
    courtAssignments: Object.fromEntries(Object.entries(state.courtAssignments).map(([key, court]) =>
      [key, { currentMatchId: court.currentMatchId,
        nextMatchId: court.nextMatchId, status: court.status }])),
    bracketSize: state.bracketSize, drawnAt: state.drawnAt,
    archiveStatus: 'ongoing', startedAt: null,
  };
}

// The caller is a trusted server entry point. The client must never be allowed
// to create, edit, or read the private plan documents directly.
function createCoordinator(db, { clock = Date.now, newCode, drawSeed } = {}) {
  const makeCode = newCode || (() => 'BXH-' + randomBytes(3).toString('hex').toUpperCase());
  const makeSeed = drawSeed || (() => randomBytes(32).toString('hex'));

  function refs(code) {
    check(typeof code === 'string' && ROOM_CODE.test(code), 'group-room-code');
    return {
      plan: db.doc('groupStagePlans/' + code),
      routing: db.doc('groupStageRoutes/' + code),
      room: db.doc('tournaments/' + code),
      publicRoom: db.doc('publicTournaments/' + code),
    };
  }

  async function authorize(tx, parentCode, actorUid, operate) {
    check(typeof actorUid === 'string' && actorUid.length > 0 && !actorUid.includes('/'), 'group-auth-required');
    const [profile, gate] = await tx.getAll(db.doc('users/' + actorUid), db.doc('systemConfig/groupStages'));
    const user = profile.data(), settings = gate.data();
    check(user?.active === true && user.deleted !== true && user.isTestAccount !== true &&
      user.role !== 'tester' && (!operate || ['admin', 'super_admin'].includes(user.role)), 'group-permission-denied');
    check(settings?.enabled === true && Array.isArray(settings.parentCodes) &&
      settings.parentCodes.includes(parentCode), 'group-room-disabled');
    const rehearsal = Array.isArray(settings.rehearsalParentCodes) && settings.rehearsalParentCodes.includes(parentCode);
    return { rehearsal, parallelAllowed: rehearsal && Array.isArray(settings.parallelRehearsalParentCodes) &&
      settings.parallelRehearsalParentCodes.includes(parentCode) };
  }

  async function checkRegistrations(tx, parentRef, players) {
    const online = players.filter(player => player.source === 'online');
    const registrations = online.map(player => {
      check(typeof player.registrationId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(player.registrationId),
        'group-registration-mismatch');
      return parentRef.collection('registrations').doc(player.registrationId);
    });
    const snapshots = registrations.length ? await tx.getAll(...registrations) : [];
    snapshots.forEach((snapshot, index) => {
      const entry = snapshot.data(), player = online[index];
      const account = entry?.guardianUid || entry?.uid;
      check(entry?.status === 'confirmed' && typeof account === 'string' && account.length > 0 &&
        account === player.registrationUid &&
        (entry.familyPlayerId || null) === (player.familyPlayerId || null) &&
        (!player.familyPlayerId || player.guardianUid === account), 'group-registration-mismatch');
    });
  }

  function checkRoster(plan, parent, rehearsal = plan.rehearsal === true) {
    check((plan.rehearsal === true) === rehearsal, 'group-room-disabled');
    check(roomState(parent)?.id === plan.parentRoomId, 'group-parent-room-changed');
    const original = Object.values(plan.event.groups).flat();
    const current = startingRoster(parent, plan.rehearsal === true);
    const identity = player => JSON.stringify([
      player.id, player.registrationId || player.regId || null, player.familyPlayerId || null,
      player.registrationUid || player.accountUid || player.playerUid || player.uid || null,
      player.guardianUid || null, player.source || null, player.ladderEligible !== false,
    ]);
    const locked = new Set(original.map(identity));
    check(original.length === current.length && new Set(current.map(identity)).size === locked.size &&
      current.every(player => locked.has(identity(player))), 'group-parent-roster-changed');
  }

  return {
    async prepare(parentCode, actorUid, groupCount) {
      const parent = refs(parentCode), seed = makeSeed();
      return db.runTransaction(async tx => {
        const { rehearsal, parallelAllowed } = await authorize(tx, parentCode, actorUid, true);
        const [plan, room] = await tx.getAll(parent.plan, parent.room);
        const parentData = room.data();
        if (plan.exists) {
          const current = plan.data();
          checkRoster(current, parentData, rehearsal);
          check(groupCount === undefined || groupCount === groupKeys(current.event).length,
            'group-count-locked');
          return publicStatus(current);
        }
        const players = startingRoster(parentData, rehearsal);
        const event = prepare(players, seed, groupCount);
        await checkRegistrations(tx, parent.room, players);
        const next = { parentRoomId: roomState(parentData).id, event, active: null,
          roomCodes: {}, rehearsal, groupDrawSeed: seed,
          ...(parallelAllowed && groupKeys(event).length === 4 ? { parallel: true } : {}) };
        tx.create(parent.plan, next);
        const assignments = new Map();
        for (const group of groupKeys(event)) {
          for (const player of event.groups[group]) {
            const uid = onlineAccount(player);
            if (!uid) continue;
            if (!assignments.has(uid)) assignments.set(uid, new Set());
            assignments.get(uid).add(group);
          }
        }
        for (const [uid, groups] of assignments) {
          tx.create(parent.routing.collection('players').doc(uid), { assignedGroups: [...groups] });
        }
        const status = publicStatus(next);
        tx.create(parent.routing, { ...status, eligibleUids: [] });
        return status;
      });
    },

    async openAllGroups(parentCode, actorUid) {
      const parent = refs(parentCode), now = clock();
      // Allocate once outside the transaction callback. Firestore can retry a
      // callback, but retries must continue to target the same room codes.
      const candidateCodes = GROUPS.map(makeCode);
      return db.runTransaction(async tx => {
        const { rehearsal } = await authorize(tx, parentCode, actorUid, true);
        const [snapshot, room] = await tx.getAll(parent.plan, parent.room);
        check(snapshot.exists, 'group-plan-required');
        const current = snapshot.data();
        checkRoster(current, room.data(), rehearsal);
        const keys = groupKeys(current.event);
        if (current.groupDrawAll === true) return operatorStatus(current);
        check(!current.active && !keys.some(key => current.roomCodes[key]), 'group-stage-already-open');
        check(new Set(candidateCodes.slice(0, keys.length)).size === keys.length,
          'group-room-code-collision');
        const destinations = keys.map((key, index) => ({ key, code: candidateCodes[index],
          child: refs(candidateCodes[index]), stage: {
            key, players: current.event.groups[key], bronzeMatch: false,
          } }));
        const collisions = await tx.getAll(...destinations.flatMap(item =>
          [item.child.room, item.child.publicRoom]));
        check(collisions.every(item => !item.exists), 'group-room-code-collision');
        await checkRegistrations(tx, parent.room, destinations.flatMap(item => item.stage.players));
        const courts = current.parallel ? courtPool.initialCourts(keys) : null;
        for (const item of destinations) {
          const documents = stageRoom(room.data(), item.stage, parentCode, item.code, now, rehearsal, current.parallel);
          const seed = current.groupDrawSeed || parentCode + ':' + current.parentRoomId;
          const drawn = drawGroup(item.stage, item.code, seed, courts ? courtPool.ownedNumbers(courts, item.key) : 12, now);
          const state = { ...JSON.parse(documents.privateDocument.data), ...drawn };
          const fence = courts ? courtPool.initializeRoom(state, courts, item.key, now) : {};
          tx.create(item.child.room, { ...documents.privateDocument, ...fence, data: JSON.stringify(state) });
          // The mirror is published when the child room is opened. Keep the
          // future groups private while preserving their completed draw.
          tx.create(item.child.publicRoom, { ...documents.publicDocument,
            bracketView: JSON.stringify(courts ? courtPool.updateMirror(publicDraw(state), state) : publicDraw(state)) });
        }
        const first = destinations[0];
        const next = { ...current, groupDrawAll: true,
          active: courts ? null : { key: first.key, code: first.code, drawPending: false },
          ...(courts ? { courts } : {}),
          roomCodes: Object.fromEntries(destinations.map(item => [item.key, item.code])) };
        const status = publicStatus(next);
        tx.set(parent.plan, next);
        tx.set(parent.routing, { ...status,
          eligibleUids: courts ? [] : [...new Set(first.stage.players.map(onlineAccount).filter(Boolean))] });
        return operatorStatus(next);
      });
    },

    async openNext(parentCode, expectedKey, actorUid) {
      const parent = refs(parentCode), code = makeCode(), now = clock();
      return db.runTransaction(async tx => {
        const { rehearsal } = await authorize(tx, parentCode, actorUid, true);
        const [plan, room] = await tx.getAll(parent.plan, parent.room);
        check(plan.exists, 'group-plan-required');
        const current = plan.data(), parentData = room.data();
        checkRoster(current, parentData, rehearsal);
        check(!current.parallel || (current.groupDrawAll && !GROUPS.includes(expectedKey)), 'group-stage-order');
        if (Object.hasOwn(current.roomCodes, expectedKey)) {
          if (current.groupDrawAll === true && !current.active &&
            nextStage(current.event)?.key === expectedKey) {
            const code = current.roomCodes[expectedKey];
            const stage = nextStage(current.event);
            await checkRegistrations(tx, parent.room, stage.players);
            const next = { ...current, active: { key: expectedKey, code, drawPending: false } };
            const status = publicStatus(next);
            tx.set(parent.plan, next);
            tx.set(parent.routing, { ...status,
              eligibleUids: [...new Set(stage.players.map(onlineAccount).filter(Boolean))] });
            return operatorStatus(next);
          }
          return operatorStatus(current);
        }
        const stage = nextStage(current.event);
        check(!current.active && stage?.key === expectedKey, 'group-stage-order');
        const child = refs(code);
        const rooms = await tx.getAll(child.room, child.publicRoom);
        check(rooms.every(snapshot => !snapshot.exists) &&
          !Object.values(current.roomCodes).includes(code), 'group-room-code-collision');
        await checkRegistrations(tx, parent.room, stage.players);
        const documents = stageRoom(parentData, stage, parentCode, code, now, current.rehearsal === true);
        const drawPending = !GROUPS.includes(stage.key);
        const next = { ...current, active: { key: stage.key, code, drawPending },
          roomCodes: { ...current.roomCodes, [stage.key]: code } };
        tx.create(child.room, documents.privateDocument);
        tx.create(child.publicRoom, documents.publicDocument);
        tx.set(parent.plan, next);
        const status = publicStatus(next);
        tx.set(parent.routing, { ...status,
          eligibleUids: drawPending ? [] : [...new Set(stage.players.map(onlineAccount).filter(Boolean))] });
        return operatorStatus(next);
      });
    },

    async readOperatorStatus(parentCode, actorUid) {
      const parent = refs(parentCode);
      return db.runTransaction(async tx => {
        const { rehearsal, parallelAllowed } = await authorize(tx, parentCode, actorUid, true);
        if (rehearsal) {
          const room = await tx.get(parent.room);
          startingRoster(room.data(), true);
        }
        const [snapshot, plan] = await tx.getAll(parent.routing, parent.plan);
        if (!snapshot.exists) return { unprepared: true, rehearsal, ...(parallelAllowed ? { parallelAllowed } : {}) };
        const { eligibleUids, ...status } = snapshot.data();
        check((status.rehearsal === true) === rehearsal, 'group-room-disabled');
        return plan.exists ? operatorStatus(plan.data()) : status;
      }, { readOnly: true });
    },

    async changeCourt(parentCode, key, number, revision, claim, actorUid) {
      check(Number.isSafeInteger(number) && number >= 1 && number <= 12 &&
        Number.isSafeInteger(revision) && revision > 0 && GROUPS.includes(key), 'group-invalid-court');
      const parent = refs(parentCode);
      return db.runTransaction(async tx => {
        const { rehearsal } = await authorize(tx, parentCode, actorUid, true);
        const [plan, room] = await tx.getAll(parent.plan, parent.room);
        const current = plan.data();
        check(rehearsal && current?.parallel === true && current.groupDrawAll && !current.active &&
          !Object.hasOwn(current.event.results, key), 'group-court-unavailable');
        checkRoster(current, room.data(), rehearsal);
        const court = current.courts[number];
        check(court?.revision === revision && court.group === (claim ? null : key), 'group-court-stale');
        const code = current.roomCodes[key], child = refs(code);
        const [source, publicSource] = await tx.getAll(child.room, child.publicRoom);
        const document = source.data(), state = roomState(document), publicDocument = publicSource.data();
        check(document?.groupStage?.sharedCourts === true && document.groupStage.parentCode === parentCode &&
          document.groupStage.key === key && state?.id === parentCode + ':' + key && state.cloudCode === code &&
          state.groupStage?.sharedCourts === true && document.visibility === 'private' && publicDocument?.visibility === 'private' &&
          document.courtLifecycleEpoch === 1 && Number.isSafeInteger(document.courtLifecycleWriteSeq) &&
          document.courtLifecycleWriteSeq > 0 && !Object.hasOwn(document, 'scoreStorage') &&
          state.archiveStatus === 'ongoing' && !state.meta?.eventCancelled && !document.systemClosed &&
          !document.eventCancelled && !document.deletionStatus, 'group-court-unavailable');
        const mirror = JSON.parse(publicDocument.bracketView);
        const now = Math.max(clock(), Number(document.updatedAt || 0) + 1, Number(state.updatedAt || 0) + 1);
        const projection = courtPool.changeRoom(state, document, current.courts, key, number, claim, now);
        state.updatedAt = now;
        const next = { ...current, courts: { ...current.courts,
          [number]: { group: claim ? key : null, revision: revision + 1 } } };
        tx.update(child.room, { ...projection, data: JSON.stringify(state), updatedAt: now,
          courtLifecycleWriteSeq: document.courtLifecycleWriteSeq + 1 });
        tx.update(child.publicRoom, { bracketView: JSON.stringify(courtPool.updateMirror(mirror, state, projection)), updatedAt: now });
        tx.set(parent.plan, next);
        return operatorStatus(next);
      });
    },

    async publishDraw(parentCode, key, code, actorUid) {
      const parent = refs(parentCode), child = refs(code);
      return db.runTransaction(async tx => {
        const { rehearsal } = await authorize(tx, parentCode, actorUid, true);
        const [plan, room, source] = await tx.getAll(parent.plan, parent.room, child.room);
        check(plan.exists, 'group-plan-required');
        const current = plan.data();
        checkRoster(current, room.data(), rehearsal);
        check(!GROUPS.includes(key) && current.active?.key === key && current.active.code === code,
          'group-stage-source');
        if (!current.active.drawPending) return operatorStatus(current);

        const document = source.data(), state = roomState(document), stage = nextStage(current.event);
        check(document?.groupStage?.parentCode === parentCode && document.groupStage.key === key &&
          state?.id === parentCode + ':' + key && state.cloudCode === code, 'group-stage-source');
        const firstRound = Array.isArray(state.matches)
          ? state.matches.filter(match => match.bracket === 'SE' && match.round === 0 && !match.isBye)
          : [];
        const drawn = new Set(firstRound.flatMap(match => [match.a?.playerId, match.b?.playerId]));
        const count = stage.players.length;
        check(state.drawnAt && state.bracketSize === count && firstRound.length === count / 2 &&
          drawn.size === count && stage.players.every(player => drawn.has(player.id)), 'group-draw-not-ready');
        const next = { ...current, active: { ...current.active, drawPending: false } };
        const status = publicStatus(next);
        tx.set(parent.plan, next);
        tx.set(parent.routing, { ...status,
          eligibleUids: [...new Set(stage.players.map(onlineAccount).filter(Boolean))] });
        return operatorStatus(next);
      });
    },

    async readRouting(parentCode, viewerUid) {
      const parent = refs(parentCode);
      return db.runTransaction(async tx => {
        const { rehearsal } = await authorize(tx, parentCode, viewerUid, false);
        check(!rehearsal, 'group-room-disabled');
        const [route, assignment] = await tx.getAll(parent.routing, parent.routing.collection('players').doc(viewerUid));
        if (!route.exists) return { unprepared: true };
        const { eligibleUids, current, ...status } = route.data();
        check(!status.rehearsal, 'group-room-disabled');
        return {
          ...status,
          current: current?.key || null,
          drawPending: current?.drawPending === true,
          assignedGroups: assignment.data()?.assignedGroups || [],
          roomCode: current && eligibleUids.includes(viewerUid) ? current.code : null,
        };
      }, { readOnly: true });
    },

    async collect(parentCode, key, code, actorUid) {
      const parent = refs(parentCode), child = refs(code);
      return db.runTransaction(async tx => {
        const { rehearsal } = await authorize(tx, parentCode, actorUid, true);
        const [plan, room, source] = await tx.getAll(parent.plan, parent.room, child.room);
        check(plan.exists, 'group-plan-required');
        const current = plan.data();
        check((current.rehearsal === true) === rehearsal, 'group-room-disabled');
        if (Object.hasOwn(current.event.results, key) && current.roomCodes[key] === code) {
          return operatorStatus(current);
        }
        checkRoster(current, room.data(), rehearsal);
        const parallel = current.parallel === true && current.groupDrawAll === true && GROUPS.includes(key);
        check(parallel ? current.roomCodes[key] === code : current.active?.key === key && current.active.code === code,
          'group-stage-source');
        check(parallel || !current.active.drawPending, 'group-draw-not-published');
        const document = source.data(), state = roomState(document);
        check(document?.groupStage?.parentCode === parentCode && document.groupStage.key === key &&
          document.ladderMode === 'general' && state?.id === parentCode + ':' + key && state.cloudCode === code,
        'group-stage-source');
        check(!parallel || (document.groupStage.sharedCourts === true && state.groupStage?.sharedCourts === true &&
          document.visibility === 'private'), 'group-stage-source');
        let result = state;
        if (Object.hasOwn(document, 'scoreStorage')) {
          let manifest;
          try { manifest = buckets.context(document, state); }
          catch { check(false, 'group-stage-score-unavailable'); }
          check(manifest.courtCount <= 32, 'group-stage-score-unavailable');
          const refs = Array.from({ length: manifest.bucketCount },
            (_, index) => child.room.collection('matchBuckets').doc('court-' + (index + 1)));
          const scores = await tx.getAll(...refs);
          try { result = buckets.materialize(state, manifest, scores.map(snapshot => snapshot.data())); }
          catch { check(false, 'group-stage-score-unavailable'); }
        }
        const next = { ...current, active: null, event: collect(current.event, key, result, parallel),
          ...(parallel ? { courts: courtPool.releaseGroup(current.courts, key) } : {}) };
        tx.set(parent.plan, next);
        const status = publicStatus(next);
        tx.set(parent.routing, { ...status, eligibleUids: [] });
        return operatorStatus(next);
      });
    },

    async readSettlement(tx, parentCode) {
      const parent = refs(parentCode);
      const [plan, room] = await tx.getAll(parent.plan, parent.room);
      check(plan.exists, 'group-plan-required');
      const current = plan.data();
      check(current.rehearsal !== true, 'group-rehearsal-no-ladder');
      checkRoster(current, room.data());
      const input = settlementInput(current.event);
      await checkRegistrations(tx, parent.room, Object.values(current.event.groups).flat());
      return input;
    },
  };
}

module.exports = { createCoordinator };
