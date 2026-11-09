'use strict';

const { createEngine } = require('../referee-seats/functions/engine/index.cjs');
const { BXHCourtRetirement: retirement } = require('../referee-seats/functions/engine/court-retirement.cjs');
const { project } = require('../referee-seats/functions/core.cjs');

function requireCourt(condition, code) {
  if (!condition) throw Object.assign(new Error(code), { code });
}

function initialCourts(keys) {
  return Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, {
    group: keys[Math.floor(i / 3)], revision: 1,
  }]));
}

function ownedNumbers(courts, group) {
  return Object.keys(courts).map(Number).filter(number => courts[number].group === group);
}

function initializeRoom(state, courts, group, now) {
  state.forcedCourtExits = Object.fromEntries(Object.keys(courts).filter(number => courts[number].group !== group)
    .map(number => [number, { closed: true, revision: 1, at: now, matchId: null }]));
  state.courtLifecycleEpoch = 1;
  return { courtLifecycleEpoch: 1, courtLifecycleWriteSeq: 1 };
}

function releaseGroup(courts, group) {
  return Object.fromEntries(Object.entries(courts).map(([number, court]) => [number, court.group === group
    ? { group: null, revision: court.revision + 1 } : court]));
}

function changeRoom(state, document, courts, group, number, claim, now) {
  const owned = ownedNumbers(courts, group);
  requireCourt(state.meta.stations === 12 && !state.courtRetirementPlan && state.courtLifecycleEpoch === 1 &&
    Object.keys(courts).every(key => retirement.accepts(state, Number(key)) === owned.includes(Number(key))),
  'group-court-state-changed');
  const waiting = state.matches.filter(match => !match.isBye && !match.completed);
  const movable = retirement.movableQueuedMatches(state);
  const count = station => waiting.filter(match => match.station === station).length;
  const move = (match, station) => {
    match.station = station;
    match.dispatchRevision = Number(match.dispatchRevision || 0) + 1;
    match.updatedAt = now;
  };
  const exitRevision = state.forcedCourtExits?.[number]?.revision || 0;
  if (claim) {
    requireCourt(retirement.reopen(state, number, exitRevision, now).ok, 'group-court-state-changed');
    // Fill the new court from the busiest queues without moving the current or
    // announced next match, including when the new court is claimed pre-start.
    const target = Math.floor(waiting.length / (owned.length + 1));
    for (let i = 0; i < target; i++) {
      const donor = owned.slice().sort((a, b) => count(b) - count(a))
        .find(station => count(station) > count(number) + 1 && movable.some(match => match.station === station));
      if (!donor) break;
      move(movable.find(match => match.station === donor), number);
    }
  } else {
    const remaining = owned.filter(station => station !== number);
    const court = state.courtAssignments?.['court' + number];
    const assigned = waiting.filter(match => match.station === number);
    requireCourt(remaining.length || !waiting.length, 'group-court-last');
    requireCourt(!court?.currentMatchId && !court?.nextMatchId && assigned.every(match => movable.includes(match)),
      'group-court-busy');
    requireCourt(retirement.forceExit(state, number, null, 0, exitRevision, now).ok, 'group-court-state-changed');
    for (const match of assigned) {
      const target = remaining.reduce((least, station) => count(station) < count(least) ? station : least);
      move(match, target);
    }
  }
  createEngine(state, { uid: null, name: 'group-stage' }, now, 'court-pool').rebuildPropagationForState(state);

  // The next group must seat its own referee. Rotate the old seat revision so
  // commands saved before release cannot become valid after a later reclaim.
  const model = document.refereeSeatsV1;
  if (model?.version !== 1) return {};
  const seat = model.courts[number];
  model.courts[number] = { main: null, backup1: null, backup2: null, revision: Number(seat?.revision || 0) + 1 };
  model.revision++;
  for (const request of Object.values(model.requests || {})) {
    if (request.station === number && request.status === 'pending') request.status = 'stale';
  }
  const projection = project(model, document.createdBy, state.meta.stations);
  Object.assign(state.meta, projection, { refereeSeatsV1: model });
  return { ...projection, refereeSeatsV1: model };
}

function updateMirror(mirror, state, projection = {}) {
  const stations = new Map(state.matches.map(match => [match.id, match.station]));
  return { ...mirror, courtLifecycleEpoch: state.courtLifecycleEpoch, updatedAt: state.updatedAt,
    meta: { ...mirror.meta,
      ...(projection.refereeSeatNames ? { refereeSeatNames: projection.refereeSeatNames,
        refereeStationNames: projection.refereeStationNames } : {}) },
    matches: mirror.matches.map(match => ({ ...match, station: stations.get(match.id) ?? null })),
    forcedCourtExits: Object.fromEntries(Object.entries(state.forcedCourtExits)
      .map(([number, court]) => [number, { closed: court.closed === true }])),
    courtAssignments: Object.fromEntries(Object.entries(state.courtAssignments).map(([key, court]) => [key, {
      currentMatchId: court.currentMatchId, nextMatchId: court.nextMatchId, status: court.status,
    }])) };
}

module.exports = { initialCourts, ownedNumbers, initializeRoom, releaseGroup, changeRoom, updateMirror };
