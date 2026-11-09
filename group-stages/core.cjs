'use strict';

const { createHmac } = require('node:crypto');
const ladder = require('../ladder-v1.js');

const GROUPS = Object.freeze(['A', 'B', 'C', 'D']);
const STAGES = Object.freeze([...GROUPS, 'champions', 'runners-up']);
const MAX_PER_GROUP = 80;

function check(condition, code) {
  if (!condition) throw Object.assign(new Error(code), { code });
}

function accountId(player) {
  return player.familyPlayerId
    ? null
    : player.registrationUid || player.accountUid || player.playerUid || player.uid || null;
}

function prepare(players, seed) {
  check(Array.isArray(players) && players.length >= GROUPS.length * 4 &&
    players.length <= GROUPS.length * MAX_PER_GROUP, 'group-roster-size');
  check(typeof seed === 'string' && seed.length > 0, 'group-draw-seed');

  const ids = new Set(), registrations = new Set(), identities = new Set();
  const draw = players.map(player => {
    check(typeof player?.id === 'string' && player.id.length > 0 &&
      player.source !== 'test' && !player.isTestData && !player.testPlayerKey, 'group-invalid-player');
    check(!ids.has(player.id), 'group-duplicate-player');
    ids.add(player.id);
    const registration = player.registrationId || player.regId;
    check(!registration || !registrations.has(registration), 'group-duplicate-registration');
    if (registration) registrations.add(registration);
    const identity = player.familyPlayerId || accountId(player);
    check(!identity || !identities.has(identity), 'group-duplicate-identity');
    if (identity) identities.add(identity);
    return {
      player: { ...player },
      drawKey: createHmac('sha256', seed).update(player.id).digest('hex'),
    };
  });
  draw.sort((a, b) => a.drawKey.localeCompare(b.drawKey) || a.player.id.localeCompare(b.player.id));

  const groups = Object.fromEntries(GROUPS.map(group => [group, []]));
  draw.forEach(({ player }, index) => groups[GROUPS[index % GROUPS.length]].push(player));
  return { groups, results: {} };
}

function nextStage(event) {
  const stage = STAGES.find(key => !Object.hasOwn(event.results, key));
  if (!stage) return null;
  if (GROUPS.includes(stage)) {
    return { key: stage, players: event.groups[stage], bronzeMatch: false };
  }
  const place = stage === 'champions' ? 0 : 1;
  return {
    key: stage,
    players: GROUPS.map(group => {
      const id = event.results[group].places[place];
      return event.groups[group].find(player => player.id === id);
    }),
    bronzeMatch: true,
  };
}

function matchesFor(stage, state) {
  check(state?.startedAt && state.archiveStatus === 'completed' &&
    state.meta?.formatType === 'single' && state.meta?.ladderMode === 'general' &&
    state.meta.bronzeMatch === stage.bronzeMatch &&
    !state.testMode && !state.meta.eventCancelled, 'group-stage-not-complete');

  const roster = new Set(stage.players.map(player => player.id));
  check(Array.isArray(state.players) && state.players.length === roster.size &&
    new Set(state.players.map(player => player?.id)).size === roster.size &&
    state.players.every(player => roster.has(player?.id)), 'group-roster-changed');

  const rounds = Math.ceil(Math.log2(roster.size));
  const size = 2 ** rounds;
  check(state.bracketSize === size && Array.isArray(state.matches) &&
    state.matches.length === size - 1 + Number(stage.bronzeMatch), 'group-invalid-bracket');

  const rows = Array.from({ length: rounds }, (_, round) => Array(size / 2 ** (round + 1)).fill(null));
  const matchIds = new Set();
  let bronze = null;
  for (const match of state.matches) {
    check(typeof match?.id === 'string' && match.id.length > 0 &&
      !matchIds.has(match.id) && match.completed === true, 'group-invalid-match');
    matchIds.add(match.id);
    if (match.bracket === 'BZ' && stage.bronzeMatch && !bronze) {
      bronze = match;
      continue;
    }
    const row = rows[match.round];
    check(match.bracket === 'SE' && row && Number.isInteger(match.indexInRound) &&
      match.indexInRound >= 0 && match.indexInRound < row.length &&
      !row[match.indexInRound], 'group-invalid-bracket');
    row[match.indexInRound] = match;
  }

  const entrants = new Set(), played = [];
  function readPair(match, expected) {
    const a = match.a?.playerId || null, b = match.b?.playerId || null;
    if (expected) {
      check(a && b && expected.includes(a) && expected.includes(b), 'group-invalid-advancement');
    } else {
      for (const id of [a, b].filter(Boolean)) {
        check(roster.has(id) && !entrants.has(id), 'group-invalid-entry');
        entrants.add(id);
      }
    }
    if (!a || !b) {
      check(!expected && (a || b) && match.isBye === true &&
        match.winnerId === (a || b) && !match.loserId, 'group-invalid-bye');
      return;
    }
    check(a !== b && !match.isBye && (match.winnerId === a || match.winnerId === b) &&
      match.loserId === (match.winnerId === a ? b : a), 'group-invalid-result');
    played.push({
      id: stage.key + ':' + match.id,
      round: match.round,
      bracket: match.bracket,
      a: { playerId: a },
      b: { playerId: b },
      winnerId: match.winnerId,
      loserId: match.loserId,
      completed: true,
      resultMethod: match.resultMethod || null,
      forfeit: match.forfeit === true || match.isForfeit === true,
    });
  }

  rows.forEach((row, round) => row.forEach((match, index) => {
    check(match, 'group-invalid-bracket');
    readPair(match, round === 0 ? null : [
      rows[round - 1][index * 2].winnerId,
      rows[round - 1][index * 2 + 1].winnerId,
    ]);
  }));
  check(entrants.size === roster.size, 'group-roster-changed');

  const final = rows.at(-1)[0];
  const places = [final.winnerId, final.loserId];
  check(state.championId === places[0] && state.runnerUpId === places[1], 'group-placement-mismatch');
  if (stage.bronzeMatch) {
    check(bronze && bronze.id === state.bronzeMatchId, 'group-missing-bronze');
    readPair(bronze, rows.at(-2).map(match => match.loserId));
    check(state.thirdId === bronze.winnerId && state.fourthId === bronze.loserId, 'group-placement-mismatch');
    places.push(bronze.winnerId, bronze.loserId);
  }
  return { places, matches: played, finalRound: rounds - 1 };
}

function collect(event, key, roomState) {
  const stage = nextStage(event);
  check(stage?.key === key, 'group-stage-order');
  return {
    ...event,
    results: { ...event.results, [key]: matchesFor(stage, roomState) },
  };
}

function settlementInput(event) {
  check(!nextStage(event), 'group-stage-incomplete');
  const places = new Map();
  for (const key of GROUPS) {
    const { matches, finalRound } = event.results[key];
    for (const match of matches) {
      // Four group semifinal losses tie at 9th, quarterfinal losses at 17th, and so on.
      places.set(match.loserId, GROUPS.length * 2 ** (finalRound - match.round) + 1);
    }
  }
  const topEight = ['champions', 'runners-up'].flatMap(key => event.results[key].places);
  topEight.forEach((id, index) => places.set(id, index + 1));

  const matches = STAGES.flatMap(key => event.results[key].matches);
  const actual = new Set(), wins = new Map(), losses = new Map();
  for (const match of matches.filter(ladder.isPlayed)) {
    actual.add(match.winnerId);
    actual.add(match.loserId);
    wins.set(match.winnerId, (wins.get(match.winnerId) || 0) + 1);
    losses.set(match.loserId, (losses.get(match.loserId) || 0) + 1);
  }
  check(actual.size >= 2, 'group-insufficient-effective-players');
  const effectiveCount = actual.size;
  const multiplier = ladder.multiplier(effectiveCount);
  const participants = Object.values(event.groups).flat().filter(player => actual.has(player.id)).map(player => {
    const placement = places.get(player.id);
    const winCount = wins.get(player.id) || 0;
    const placementBonus = ladder.bonus(placement, effectiveCount, winCount);
    const weightedBonus = Math.round(placementBonus * multiplier);
    return {
      player,
      placement,
      wins: winCount,
      losses: losses.get(player.id) || 0,
      pointsEarned: 10 + weightedBonus,
      scoring: {
        version: ladder.version, effectiveCount, multiplier, basePoints: 10,
        placementBonus, weightedBonus, placementBasis: placement,
      },
    };
  });
  return { effectiveCount, multiplier, topEight, participants, matches };
}

module.exports = { GROUPS, prepare, nextStage, collect, settlementInput };
