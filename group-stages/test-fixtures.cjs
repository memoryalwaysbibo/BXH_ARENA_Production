'use strict';

const roster = count => Array.from({ length: count }, (_, i) => ({
  id: 'p-' + i,
  name: 'Synthetic ' + i,
  registrationId: 'reg-' + i,
  registrationUid: 'user-' + i,
  checkedIn: true,
  source: 'online',
}));

function finish(stage) {
  const ids = stage.players.map(player => player.id);
  const size = 2 ** Math.ceil(Math.log2(ids.length));
  const matches = [];
  function match(a, b, round, indexInRound, bracket = 'SE') {
    const result = {
      id: bracket + '-' + round + '-' + indexInRound,
      round, indexInRound, bracket, completed: true, isBye: !b,
      a: { playerId: a }, b: b ? { playerId: b } : null,
      winnerId: a, loserId: b || null, resultMethod: 'score',
    };
    matches.push(result);
    return result;
  }
  let row = Array.from({ length: size / 2 }, (_, i) => match(ids[i], ids[i + size / 2], 0, i));
  let round = 1;
  while (row.length > 1) {
    row = Array.from({ length: row.length / 2 }, (_, i) =>
      match(row[i * 2].winnerId, row[i * 2 + 1].winnerId, round, i));
    round++;
  }
  const final = row[0];
  const state = {
    startedAt: 1, archiveStatus: 'completed', bracketSize: size, players: stage.players,
    meta: { formatType: 'single', ladderMode: 'general', bronzeMatch: stage.bronzeMatch },
    championId: final.winnerId, runnerUpId: final.loserId, matches,
  };
  if (stage.bronzeMatch) {
    const semis = matches.filter(item => item.round === round - 2);
    const bronze = match(semis[0].loserId, semis[1].loserId, round - 2, 0, 'BZ');
    state.bronzeMatchId = bronze.id;
    state.thirdId = bronze.winnerId;
    state.fourthId = bronze.loserId;
  }
  return state;
}

module.exports = { roster, finish };
