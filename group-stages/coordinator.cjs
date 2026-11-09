'use strict';

const { randomBytes } = require('node:crypto');
const buckets = require('../referee-seats/functions/bucket-state.cjs');
const { GROUPS, groupKeys, prepare, nextStage, collect, settlementInput } = require('./core.cjs');

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
  return {
    groups: groupKeys(plan.event).map(key => ({ key, count: plan.event.groups[key].length })),
    completed: Object.keys(plan.event.results),
    current: plan.active ? { ...plan.active } : null,
    next: plan.active ? null : nextStage(plan.event)?.key || null,
    readyForSettlement: !nextStage(plan.event),
    ...(plan.rehearsal ? { rehearsal: true } : {}),
  };
}

function onlineAccount(player) {
  return player.source === 'online'
    ? (player.familyPlayerId ? player.guardianUid : player.registrationUid)
    : null;
}

function stageRoom(parent, stage, parentCode, code, now, rehearsal) {
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
  const link = { parentCode, key: stage.key };
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
    return Array.isArray(settings.rehearsalParentCodes) && settings.rehearsalParentCodes.includes(parentCode);
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

  function checkRoster(plan, parent) {
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
        const rehearsal = await authorize(tx, parentCode, actorUid, true);
        const [plan, room] = await tx.getAll(parent.plan, parent.room);
        const parentData = room.data();
        if (plan.exists) {
          const current = plan.data();
          check((current.rehearsal === true) === rehearsal, 'group-parent-unavailable');
          checkRoster(current, parentData);
          check(groupCount === undefined || groupCount === groupKeys(current.event).length,
            'group-count-locked');
          return publicStatus(current);
        }
        const players = startingRoster(parentData, rehearsal);
        const event = prepare(players, seed, groupCount);
        await checkRegistrations(tx, parent.room, players);
        const next = { parentRoomId: roomState(parentData).id, event, active: null, roomCodes: {}, rehearsal };
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

    async openNext(parentCode, expectedKey, actorUid) {
      const parent = refs(parentCode), code = makeCode(), now = clock();
      return db.runTransaction(async tx => {
        await authorize(tx, parentCode, actorUid, true);
        const [plan, room] = await tx.getAll(parent.plan, parent.room);
        check(plan.exists, 'group-plan-required');
        const current = plan.data(), parentData = room.data();
        checkRoster(current, parentData);
        if (Object.hasOwn(current.roomCodes, expectedKey)) return publicStatus(current);
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
        return status;
      });
    },

    async readOperatorStatus(parentCode, actorUid) {
      const parent = refs(parentCode);
      return db.runTransaction(async tx => {
        await authorize(tx, parentCode, actorUid, true);
        const snapshot = await tx.get(parent.routing);
        if (!snapshot.exists) return null;
        const { eligibleUids, ...status } = snapshot.data();
        return status;
      }, { readOnly: true });
    },

    async publishDraw(parentCode, key, code, actorUid) {
      const parent = refs(parentCode), child = refs(code);
      return db.runTransaction(async tx => {
        await authorize(tx, parentCode, actorUid, true);
        const [plan, room, source] = await tx.getAll(parent.plan, parent.room, child.room);
        check(plan.exists, 'group-plan-required');
        const current = plan.data();
        checkRoster(current, room.data());
        check(!GROUPS.includes(key) && current.active?.key === key && current.active.code === code,
          'group-stage-source');
        if (!current.active.drawPending) return publicStatus(current);

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
        return status;
      });
    },

    async readRouting(parentCode, viewerUid) {
      const parent = refs(parentCode);
      return db.runTransaction(async tx => {
        await authorize(tx, parentCode, viewerUid, false);
        const [route, assignment] = await tx.getAll(parent.routing, parent.routing.collection('players').doc(viewerUid));
        if (!route.exists) return null;
        const { eligibleUids, current, ...status } = route.data();
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
        await authorize(tx, parentCode, actorUid, true);
        const [plan, room, source] = await tx.getAll(parent.plan, parent.room, child.room);
        check(plan.exists, 'group-plan-required');
        const current = plan.data();
        if (Object.hasOwn(current.event.results, key) && current.roomCodes[key] === code) {
          return publicStatus(current);
        }
        checkRoster(current, room.data());
        check(current.active?.key === key && current.active.code === code, 'group-stage-source');
        check(!current.active.drawPending, 'group-draw-not-published');
        const document = source.data(), state = roomState(document);
        check(document?.groupStage?.parentCode === parentCode && document.groupStage.key === key &&
          document.ladderMode === 'general' && state?.id === parentCode + ':' + key && state.cloudCode === code,
        'group-stage-source');
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
        const next = { ...current, active: null, event: collect(current.event, key, result) };
        tx.set(parent.plan, next);
        const status = publicStatus(next);
        tx.set(parent.routing, { ...status, eligibleUids: [] });
        return status;
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
