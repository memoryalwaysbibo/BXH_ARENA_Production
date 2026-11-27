'use strict';

const { GROUPS, scoreCompletedEvent } = require('./core.cjs');

function check(condition, code) {
  if (!condition) throw Object.assign(new Error(code), { code });
}

// Challonge omits opening-round BYEs. Verify the recorded progression without
// creating extra matches or requiring fictional scores for unrecorded contests.
function verifyRounds(key, players, rows, survivorCount) {
  check(Array.isArray(rows) && rows.length === players.length - survivorCount, 'history-match-count');
  const remaining = new Set(players.map(player => player.id));
  check(remaining.size === players.length, 'history-duplicate-player');
  const rounds = Math.ceil(Math.log2(players.length));
  const lastRound = rounds - Math.log2(survivorCount) - 1;
  const allIds = new Set(), winners = new Map(), previousWinners = new Set(), matched = new Set();
  const countByRound = Array(lastRound + 1).fill(0);
  const matches = [];
  let previousRound = -1;
  for (const row of [...rows].sort((a, b) => a.round - b.round || a.number - b.number)) {
    const { number, round, a, b, winner, fromA, fromB } = row;
    check(Number.isSafeInteger(number) && number > 0 && !allIds.has(number) &&
      Number.isSafeInteger(round) && round >= 0 && round <= lastRound, 'history-match-key');
    if (previousRound !== round) {
      matched.clear();
      previousRound = round;
    }
    check(a !== b && remaining.has(a) && remaining.has(b) && !matched.has(a) && !matched.has(b) &&
      (winner === a || winner === b), 'history-match-result');
    for (const [entrant, source] of [[a, fromA], [b, fromB]]) {
      if (source == null) {
        check(round <= 1 && !previousWinners.has(entrant),
          'history-advancement-source');
      } else {
        const prior = winners.get(source);
        check(prior?.winner === entrant && prior.round === round - 1 && !prior.used, 'history-advancement-source');
        prior.used = true;
      }
    }
    const loser = winner === a ? b : a;
    matched.add(a);
    matched.add(b);
    allIds.add(number);
    winners.set(number, { winner, round, used: false });
    previousWinners.add(winner);
    remaining.delete(loser);
    countByRound[round]++;
    matches.push({
      id: key + ':' + number, round, bracket: 'SE',
      a: { playerId: a }, b: { playerId: b },
      winnerId: winner, loserId: loser, completed: true, resultMethod: null, forfeit: false,
    });
  }
  check(countByRound[0] === players.length - 2 ** (rounds - 1) &&
    countByRound.slice(1).every((count, index) => count === 2 ** (rounds - index - 2)) &&
    remaining.size === survivorCount, 'history-round-count');
  return { matches, survivors: [...remaining], finalRound: rounds - 1 };
}

function buildHistoricalTopEight({ groups, groupMatches, finalMatches, finalPlaces }) {
  const roster = GROUPS.flatMap(key => groups[key] || []);
  check(GROUPS.every(key => groups[key]?.length >= 4 && groups[key].length <= 96) &&
    roster.every(player => typeof player.id === 'string' && player.id.length > 0) &&
    new Set(roster.map(player => player.id)).size === roster.length, 'history-roster');
  const event = { groups, results: {} };
  for (const key of GROUPS) {
    const result = verifyRounds(key, groups[key], groupMatches[key], 2);
    event.results[key] = { matches: result.matches, places: result.survivors, finalRound: result.finalRound };
  }
  const qualifiers = new Set(GROUPS.flatMap(key => event.results[key].places));
  const finalists = roster.filter(player => qualifiers.has(player.id));
  const final = verifyRounds('final-eight', finalists, finalMatches, 1);
  const rounds = [0, 1, 2].map(round => final.matches.filter(match => match.round === round));
  const titleMatch = rounds[2][0];
  const semifinalLosers = new Set(rounds[1].map(match => match.loserId));
  const firstRoundLosers = new Set(rounds[0].map(match => match.loserId));
  check(Array.isArray(finalPlaces) && finalPlaces.length === 8 &&
    new Set(finalPlaces).size === 8 &&
    finalPlaces[0] === titleMatch.winnerId && finalPlaces[1] === titleMatch.loserId &&
    finalPlaces.slice(2, 4).every(id => semifinalLosers.has(id)) &&
    finalPlaces.slice(4).every(id => firstRoundLosers.has(id)), 'history-placement-mismatch');
  event.results['final-eight'] = { matches: final.matches, places: [...finalPlaces], finalRound: final.finalRound };
  return { event, settlement: scoreCompletedEvent(event, ['final-eight']) };
}

module.exports = { buildHistoricalTopEight };
