'use strict';

const { createHash } = require('node:crypto');
const buckets = require('../referee-seats/functions/bucket-state.cjs');
const { GROUPS, matchesFor } = require('../group-stages/core.cjs');
const STAGES = Object.freeze([...GROUPS, 'runners-up', 'champions']);
const ROOM_CODE = /^BXH-[A-Z0-9]{6}$/;
const REGISTRATION_ID = /^[A-Za-z0-9_-]{1,128}$/;
const METHODS = new Set(['score', 'quick_decision', 'forfeit', 'bye']);

function check(condition, code) {
  if (!condition) throw Object.assign(new Error(code), { code });
}
function stateOf(document) {
  try {
    const state = typeof document?.data === 'string' ? JSON.parse(document.data) : document?.data;
    check(state && typeof state === 'object' && !Array.isArray(state), 'group-history-state-invalid');
    return state;
  } catch { check(false, 'group-history-state-invalid'); }
}
function text(value, maximum = 160) { return typeof value === 'string' ? value.slice(0, maximum) : ''; }
function validId(value) { return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x1f]/.test(value); }
function identity(player) {
  return JSON.stringify(['id', 'registrationId', 'regId', 'familyPlayerId', 'registrationUid',
    'accountUid', 'playerUid', 'uid', 'guardianUid', 'source'].map(key => player[key] || null)
    .concat([player.ladderEligible !== false]));
}
function safePlayer(player) { return { id: player.id, name: text(player.name) }; }
function validPlayer(player) {
  return player && validId(player.id) && player.source !== 'test' && !player.isTestData && !player.testPlayerKey;
}
function sameRoster(expected, actual, code) {
  check(Array.isArray(actual) && actual.length === expected.length && actual.every(validPlayer), code);
  const locked = new Set(expected.map(identity));
  check(locked.size === expected.length && new Set(actual.map(identity)).size === locked.size &&
    actual.every(player => locked.has(identity(player))), code);
}
function planRoster(plan, parent, state, rehearsal) {
  check(plan && (plan.rehearsal === true) === rehearsal, 'group-room-disabled');
  check(validId(plan.parentRoomId) && state.id === plan.parentRoomId, 'group-parent-room-changed');
  // History deliberately does not use startingRoster: completion, archived state,
  // parent matches and already-awarded parent points are legitimate history.
  check(parent.eventAuthority === 'official' && !parent.groupStage && !state.groupStage &&
    !state.testMode && !state.meta?.eventCancelled && !parent.eventCancelled &&
    state.meta?.formatType === 'single' && state.meta.battleMode === 'individual' &&
    state.meta.playMode === 'standard', 'group-parent-unavailable');
  check(rehearsal ? parent.ladderMode === 'general' && state.meta.ladderMode === 'general' &&
    parent.visibility === 'private' && state.meta.registrationVisibility === 'private' &&
    parent.registrationEnabled === false && state.meta.registrationEnabled === false
    : parent.ladderMode === 'ranked', 'group-parent-unavailable');
  const groups = plan.event?.groups, results = plan.event?.results;
  check(groups && results && typeof groups === 'object' && typeof results === 'object' &&
    !Array.isArray(groups) && !Array.isArray(results), 'group-history-plan-invalid');
  const keys = Object.keys(groups);
  check([2, 4].includes(keys.length) && GROUPS.slice(0, keys.length).every(key => keys.includes(key)) &&
    Object.keys(results).every(key => STAGES.includes(key) && (!GROUPS.includes(key) || keys.includes(key))),
  'group-history-plan-invalid');
  check(keys.every(key => Array.isArray(groups[key]) && groups[key].length >= 4 && groups[key].length <= 96),
    'group-history-plan-invalid');
  const players = GROUPS.filter(key => keys.includes(key)).flatMap(key => groups[key]);
  check(players.every(validPlayer) && new Set(players.map(player => player.id)).size === players.length,
    'group-parent-roster-changed');
  const registrations = players.map(player => player.registrationId || player.regId).filter(Boolean);
  const people = players.map(player => player.familyPlayerId ? 'family:' + player.familyPlayerId :
    (player.registrationUid || player.accountUid || player.playerUid || player.uid) &&
      'account:' + (player.registrationUid || player.accountUid || player.playerUid || player.uid)).filter(Boolean);
  check(new Set(registrations).size === registrations.length && new Set(people).size === people.length,
    'group-parent-roster-changed');
  check(Array.isArray(state.players), 'group-parent-roster-changed');
  sameRoster(players, state.players.filter(player => !state.meta.checkinRequired || player.checkedIn === true),
    'group-parent-roster-changed');
  check(plan.roomCodes && typeof plan.roomCodes === 'object' && !Array.isArray(plan.roomCodes) &&
    Object.entries(plan.roomCodes).every(([key, code]) => STAGES.includes(key) &&
      (!GROUPS.includes(key) || keys.includes(key)) && ROOM_CODE.test(code) && code !== state.cloudCode) &&
    new Set(Object.values(plan.roomCodes)).size === Object.values(plan.roomCodes).length,
  'group-history-plan-invalid');
  check(!plan.active || STAGES.includes(plan.active.key) && plan.roomCodes[plan.active.key] === plan.active.code,
    'group-stage-source');
  if (rehearsal) check(players.every(player => player.source === 'onsite' && player.participantType === 'onsite_guest' &&
    player.accountLinked === false && player.ladderEligible === false && player.activityEligible === false &&
    !['registrationId', 'regId', 'familyPlayerId', 'guardianUid', 'registrationUid', 'accountUid',
      'playerUid', 'uid', 'userUid', 'authUid', 'playerId'].some(key => player[key])), 'group-rehearsal-linked-roster');
  return players;
}

async function ownPlayers(tx, parentRef, players, uid) {
  const online = players.filter(player => player.source === 'online');
  check(online.every(player => typeof player.registrationId === 'string' && REGISTRATION_ID.test(player.registrationId) &&
    (!player.regId || player.regId === player.registrationId)), 'group-registration-mismatch');
  const rows = online.length ? await tx.getAll(...online.map(player =>
    parentRef.collection('registrations').doc(player.registrationId))) : [];
  const own = [];
  rows.forEach((snapshot, index) => {
    const row = snapshot.data(), player = online[index], family = player.familyPlayerId || null;
    const account = family ? row?.guardianUid : row?.uid;
    check(row?.status === 'confirmed' && validId(account) && account === player.registrationUid &&
      (row.familyPlayerId || null) === family &&
      (family ? player.guardianUid === account : !player.guardianUid && !row.guardianUid) &&
      (!row.registrationId || row.registrationId === player.registrationId) &&
      ['accountUid', 'playerUid', 'uid'].every(key => !player[key] || player[key] === account),
    'group-registration-mismatch');
    if (account === uid) own.push(player.id);
  });
  return own;
}
function stagePlayers(plan, key) {
  if (GROUPS.includes(key)) return plan.event.groups[key];
  const index = key === 'champions' ? 0 : 1;
  return GROUPS.filter(group => plan.event.groups[group]).map(group => {
    const id = plan.event.results[group]?.places?.[index];
    const player = plan.event.groups[group].find(item => item.id === id);
    check(player, 'group-history-plan-invalid');
    return player;
  });
}
function score(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null; }
function safeMatches(state, players, bronzeMatch) {
  check(Array.isArray(state.matches) && state.matches.length <= 128, 'group-history-state-invalid');
  const ids = new Set(players.map(player => player.id)), seen = new Set(), slots = new Set();
  const rounds = Math.ceil(Math.log2(players.length)), size = 2 ** rounds;
  check(state.matches.length === 0 ? !state.bracketSize : state.bracketSize === size &&
    state.matches.length === size - 1 + Number(bronzeMatch), 'group-history-state-invalid');
  return state.matches.map(match => {
    const a = match?.a?.playerId || null, b = match?.b?.playerId || null;
    const winnerId = match?.winnerId || null, loserId = match?.loserId || null;
    const slot = [match?.bracket, match?.round, match?.indexInRound].join(':');
    const se = match?.bracket === 'SE' && Number.isInteger(match.round) && match.round >= 0 &&
      match.round < rounds && Number.isInteger(match.indexInRound) && match.indexInRound >= 0 &&
      match.indexInRound < size / 2 ** (match.round + 1);
    const bz = bronzeMatch && match?.bracket === 'BZ' && match.round === rounds - 2 && match.indexInRound === 0;
    check(validId(match?.id) && !seen.has(match.id) && !slots.has(slot) && (se || bz) &&
      [a, b, winnerId, loserId].every(id => id === null || ids.has(id)) && (!a || a !== b),
    'group-history-state-invalid');
    seen.add(match.id); slots.add(slot);
    return {
      id: match.id, round: match.round, indexInRound: match.indexInRound, bracket: match.bracket,
      a: a ? { playerId: a } : null, b: b ? { playerId: b } : null,
      scoreA: match.isBye || match.resultMethod === 'quick_decision' ? null : score(match.scoreA),
      scoreB: match.isBye || match.resultMethod === 'quick_decision' ? null : score(match.scoreB),
      winnerId, loserId, completed: match.completed === true, isBye: match.isBye === true,
      resultMethod: METHODS.has(match.resultMethod) ? match.resultMethod : null,
      forfeit: match.forfeit === true || match.isForfeit === true,
    };
  });
}
function outcomesConsistent(matches) {
  return matches.every(match => {
    const a = match.a?.playerId || null, b = match.b?.playerId || null;
    if (match.isBye) return match.completed && Boolean(a) !== Boolean(b) &&
      match.winnerId === (a || b) && match.loserId === null;
    if (!match.completed) return match.winnerId === null && match.loserId === null;
    return a && b && a !== b && [a, b].includes(match.winnerId) &&
      match.loserId === (match.winnerId === a ? b : a);
  });
}
function scoresConsistent(matches) {
  return matches.every(match => {
    if (match.isBye || !match.completed || match.forfeit || match.resultMethod === 'quick_decision') return true;
    if (match.scoreA == null && match.scoreB == null) return true; // Legacy scores were not retained.
    return match.scoreA != null && match.scoreB != null && match.scoreA !== match.scoreB &&
      match.winnerId === (match.scoreA > match.scoreB ? match.a?.playerId : match.b?.playerId);
  });
}
function normalizeResult(result) {
  check(Array.isArray(result?.places) && Number.isInteger(result.finalRound) && Array.isArray(result.matches),
    'group-history-result-invalid');
  return {
    places: result.places, finalRound: result.finalRound,
    matches: result.matches.map(match => ({ id: match.id, round: match.round, bracket: match.bracket,
      a: match.a?.playerId || null, b: match.b?.playerId || null, winnerId: match.winnerId,
      loserId: match.loserId, completed: match.completed === true,
      resultMethod: match.resultMethod || null, forfeit: match.forfeit === true || match.isForfeit === true,
    })).sort((a, b) => String(a.id).localeCompare(String(b.id))),
  };
}
function verifyCollected(plan, key, state, matches) {
  try {
    const stage = {
      key,
      players: stagePlayers(plan, key),
      bronzeMatch: !GROUPS.includes(key) && Object.keys(plan.event.groups).length === 4,
    };
    const completed = state.archiveStatus === 'archived' ? { ...state, archiveStatus: 'completed' } : state;
    const current = matchesFor(stage, completed);
    const saved = plan.event.results[key];
    if (JSON.stringify(normalizeResult(current)) !== JSON.stringify(normalizeResult(saved)) || !scoresConsistent(matches)) return false;
    // Newer snapshots can include score fields; legacy core snapshots do not.
    // Never manufacture a historical score when the snapshot did not keep one.
    const live = new Map(matches.map(match => [key + ':' + match.id, match]));
    return saved.matches.every(match => ['scoreA', 'scoreB'].every(field =>
      !Object.hasOwn(match, field) || match[field] === live.get(match.id)?.[field]));
  } catch { return false; }
}
function placementsFor(plan, ownIds) {
  const results = plan.event.results, keys = GROUPS.filter(key => plan.event.groups[key]);
  if (![...keys, 'champions', 'runners-up'].every(key => Object.hasOwn(results, key))) return [];
  const placements = new Map(), eliminated = new Map();
  for (const key of keys) {
    for (const match of results[key].matches) {
      const distance = results[key].finalRound - match.round;
      if (distance <= 0) continue;
      if (!eliminated.has(distance)) eliminated.set(distance, []);
      eliminated.get(distance).push(match.loserId);
    }
  }
  let remaining = Object.values(plan.event.groups).flat().length;
  for (const distance of [...eliminated.keys()].sort((a, b) => b - a)) {
    remaining -= eliminated.get(distance).length;
    eliminated.get(distance).forEach(id => placements.set(id, remaining + 1));
  }
  [...results.champions.places, ...results['runners-up'].places].forEach((id, index) => placements.set(id, index + 1));
  return ownIds.filter(id => placements.has(id)).map(playerId => ({
    playerId, placement: placements.get(playerId), points: null, pointsStatus: 'unverified',
  }));
}

// Some legacy local player IDs contain Firebase UIDs (reg_<uid>) or family
// profile IDs. A field whitelist alone would still disclose those identifiers.
function opaqueResponse(result, players, parentCode, parentRoomId) {
  const ids = new Map(players.map(player => [player.id, 'hp_' + createHash('sha256')
    .update(JSON.stringify(['group-history-player-v1', parentCode, parentRoomId, player.id])).digest('hex').slice(0, 32)]));
  check(new Set(ids.values()).size === ids.size, 'group-history-state-invalid');
  const remap = id => id == null ? null : ids.get(id);
  const match = (row, key) => ({ ...row, id: [key, row.bracket, row.round, row.indexInRound].join(':'),
    a: row.a ? { playerId: remap(row.a.playerId) } : null,
    b: row.b ? { playerId: remap(row.b.playerId) } : null,
    winnerId: remap(row.winnerId), loserId: remap(row.loserId) });
  return { ...result,
    stages: result.stages.map(stage => ({ ...stage,
      players: stage.players.map(player => ({ ...player, id: remap(player.id) })),
      matches: stage.matches.map(row => match(row, stage.key)) })),
    ownPlayerIds: result.ownPlayerIds.map(remap),
    ownMatches: result.ownMatches.map(row => match(row, row.stageKey)),
    placements: result.placements.map(row => ({ ...row, playerId: remap(row.playerId) })),
  };
}

function createHistoryReader(db) {
  return async (parentCode, uid) => {
    check(typeof uid === 'string' && uid.length > 0 && !uid.includes('/'), 'group-auth-required');
    check(typeof parentCode === 'string' && ROOM_CODE.test(parentCode), 'group-room-code');
    return db.runTransaction(async tx => {
      const [profile, gate] = await tx.getAll(db.doc('users/' + uid), db.doc('systemConfig/groupStages'));
      const user = profile.data(), settings = gate.data();
      check(user?.active === true && user.deleted !== true && !['deleted', 'disabled', 'frozen'].includes(user.accountStatus) &&
        user.isTestAccount !== true && user.isTestData !== true && user.testAccount !== true &&
        user.testMode !== true && user.role !== 'tester', 'group-permission-denied');
      check(settings?.enabled === true && Array.isArray(settings.parentCodes) && settings.parentCodes.includes(parentCode),
        'group-room-disabled');
      const admin = ['admin', 'super_admin'].includes(user.role);
      const rehearsal = Array.isArray(settings.rehearsalParentCodes) && settings.rehearsalParentCodes.includes(parentCode);
      check(!rehearsal || admin, 'group-permission-denied');
      const parentRef = db.doc('tournaments/' + parentCode);
      const [parentSnapshot, planSnapshot] = await tx.getAll(parentRef, db.doc('groupStagePlans/' + parentCode));
      check(parentSnapshot.exists && planSnapshot.exists, 'group-plan-required');
      const parent = parentSnapshot.data(), state = stateOf(parent), plan = planSnapshot.data();
      const players = planRoster(plan, parent, state, rehearsal);
      check(!Object.values(plan.roomCodes).includes(parentCode), 'group-stage-source');
      const ownPlayerIds = await ownPlayers(tx, parentRef, players, uid);
      check(admin || ownPlayerIds.length > 0, 'group-permission-denied');
      check(!plan.parallel || rehearsal && Array.isArray(settings.parallelRehearsalParentCodes) &&
        settings.parallelRehearsalParentCodes.includes(parentCode), 'group-room-disabled');
      const count = Object.keys(plan.event.groups).length;
      // A single draw locks all group opponents at once. Opening a child room
      // controls scoring, not whether its already-drawn bracket can be seen.
      if (plan.groupDrawAll === true) check(!plan.active || !GROUPS.includes(plan.active.key) ||
        plan.active.drawPending === false,
        'group-stage-source');
      const assignedGroups = plan.groupDrawAll === true
        ? GROUPS.filter(key => plan.event.groups[key]?.some(player => ownPlayerIds.includes(player.id))) : [];
      const stages = [], ownMatches = [];
      for (const key of STAGES) {
        const stage = { key, label: GROUPS.includes(key) ? key + ' 組' : key === 'champions'
          ? '第 1～' + count + ' 名賽' : '第 ' + (count + 1) + '～' + (count * 2) + ' 名賽',
        status: 'unpublished', players: [], matches: [], needsReview: false };
        if (GROUPS.includes(key) && !plan.event.groups[key]) { stage.status = 'not-applicable'; stages.push(stage); continue; }
        const collected = Object.hasOwn(plan.event.results, key);
        const published = collected || plan.active?.key === key && plan.active.drawPending === false ||
          plan.groupDrawAll === true && GROUPS.includes(key);
        if (!published) { stages.push(stage); continue; }
        const code = plan.roomCodes[key];
        check(ROOM_CODE.test(code), 'group-stage-source');
        const childRef = db.doc('tournaments/' + code), snapshot = await tx.get(childRef);
        check(snapshot.exists, 'group-stage-source');
        const document = snapshot.data(), base = stateOf(document);
        check(document.groupStage?.parentCode === parentCode && document.groupStage.key === key &&
          base.groupStage?.parentCode === parentCode && base.groupStage.key === key &&
          base.id === parentCode + ':' + key && base.cloudCode === code &&
          document.ladderMode === 'general' && base.meta?.ladderMode === 'general' &&
          base.meta.formatType === 'single' && !base.testMode && !base.meta.eventCancelled && !document.eventCancelled &&
          !document.ladderPointsAwarded && !base.ladderPointsAwarded &&
          (!rehearsal || document.visibility === 'private'), 'group-stage-source');
        const expected = stagePlayers(plan, key), bronze = !GROUPS.includes(key) && count === 4;
        check(base.meta.bronzeMatch === bronze, 'group-stage-source');
        sameRoster(expected, base.players, 'group-roster-changed');
        let child = base;
        if (Object.hasOwn(document, 'scoreStorage')) {
          try {
            const manifest = buckets.context(document, base);
            check(manifest.courtCount <= 32, 'group-stage-score-unavailable');
            const scores = await tx.getAll(...Array.from({ length: manifest.bucketCount }, (_, index) =>
              childRef.collection('matchBuckets').doc('court-' + (index + 1))));
            child = buckets.materialize(base, manifest, scores.map(row => row.data()));
          } catch { check(false, 'group-stage-score-unavailable'); }
        }
        stage.players = expected.map(safePlayer);
        stage.matches = safeMatches(child, expected, bronze);
        const invalidScore = child.matches.some(match => ['scoreA', 'scoreB'].some(field =>
          match[field] != null && score(match[field]) === null));
        stage.needsReview = invalidScore || !outcomesConsistent(stage.matches) || !scoresConsistent(stage.matches) || collected && !verifyCollected(plan, key, child, stage.matches);
        const waitingToOpen = plan.groupDrawAll === true && !plan.parallel && GROUPS.includes(key) &&
          !collected && plan.active?.key !== key;
        stage.status = stage.needsReview ? 'needs-review' : collected ? 'completed' :
          waitingToOpen ? 'scheduled' : child.startedAt ? 'in-progress' : 'ready';
        for (const match of stage.matches) if (ownPlayerIds.includes(match.a?.playerId) || ownPlayerIds.includes(match.b?.playerId)) {
          ownMatches.push({ stageKey: key, ...match });
        }
        stages.push(stage);
      }
      const needsReview = stages.some(stage => stage.needsReview);
      return opaqueResponse({ parent: { code: parentCode, name: text(state.meta.name || parent.name),
        archiveStatus: ['completed', 'archived'].includes(state.archiveStatus) ? state.archiveStatus : 'ongoing', rehearsal },
      stages, ownPlayerIds, assignedGroups, ownMatches, placements: needsReview ? [] : placementsFor(plan, ownPlayerIds),
      points: null, pointsStatus: 'unverified', needsReview }, players, parentCode, plan.parentRoomId);
    }, { readOnly: true });
  };
}

module.exports = { createHistoryReader };
