'use strict';

const DIRECT_ELIMINATIONS = new Set(['burst', 'over', 'extreme']);
function startTeamMatch(lineups) {
  if (!Array.isArray(lineups) || lineups.length !== 2 ||
      lineups.some(order => !Array.isArray(order) || order.length < 3 || new Set(order).size !== order.length) ||
      new Set(lineups.flat()).size !== lineups.flat().length) throw Error('invalid-lineup');
  return {lineups:lineups.map(order=>order.slice()),life:lineups.map(order=>order.map(()=>2)),
    current:[0,0],winner:null,rounds:[]};
}

function applyRound(input, winnerSide, finish) {
  if (!input || input.winner !== null || ![0,1].includes(winnerSide) ||
      !['spin','burst','over','extreme'].includes(finish)) throw Error('invalid-round');
  const loser = 1 - winnerSide;
  const next = {...input,life:input.life.map(side=>side.slice()),current:input.current.slice(),rounds:input.rounds.slice()};
  const losingIndex = next.current[loser], winningIndex = next.current[winnerSide];
  if (losingIndex >= next.lineups[loser].length || winningIndex >= next.lineups[winnerSide].length ||
      next.life[loser][losingIndex] <= 0 || next.life[winnerSide][winningIndex] <= 0) throw Error('invalid-active-player');
  next.life[loser][losingIndex] = DIRECT_ELIMINATIONS.has(finish) ? 0 : next.life[loser][losingIndex] - 1;
  next.rounds.push({winnerSide,finish,winnerPlayerId:next.lineups[winnerSide][winningIndex],loserPlayerId:next.lineups[loser][losingIndex]});
  if (next.life[loser][losingIndex] === 0) {
    next.current[loser]++;
    if (next.current[loser] === next.lineups[loser].length) next.winner = winnerSide;
  }
  return next;
}
module.exports = {startTeamMatch,applyRound};
