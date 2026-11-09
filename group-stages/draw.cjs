'use strict';

const { createHmac } = require('node:crypto');

function seedOrder(size) {
  let order = [1];
  while (order.length < size) {
    const total = order.length * 2 + 1;
    order = order.flatMap(seed => [seed, total - seed]);
  }
  return order;
}

// Server-owned draw for the group rooms. The seed is retained in the private
// plan so a retried transaction cannot silently generate a different bracket.
function drawGroup(stage, code, seed, stations, now) {
  const players = stage.players;
  const shuffled = players.map(player => ({
    player,
    key: createHmac('sha256', seed).update(stage.key + ':' + player.id).digest('hex'),
  })).sort((a, b) => a.key.localeCompare(b.key) || a.player.id.localeCompare(b.player.id))
    .map(entry => entry.player);
  const size = 2 ** Math.ceil(Math.log2(shuffled.length));
  const slots = new Array(size).fill(null);
  seedOrder(size).forEach((seedNumber, position) => {
    slots[position] = shuffled[seedNumber - 1]?.id || null;
  });
  const matches = [];
  let seq = 0;
  for (let round = 0; round < Math.log2(size); round++) {
    const count = size / 2 ** (round + 1);
    for (let index = 0; index < count; index++) {
      const a = round === 0 ? slots[index * 2] : null;
      const b = round === 0 ? slots[index * 2 + 1] : null;
      const bye = round === 0 && (!a || !b);
      matches.push({
        id: code + '_m' + round + '_' + index,
        seq: seq++, bracket: 'SE', round, indexInRound: index,
        a: a ? { type: 'player', playerId: a } : null,
        b: b ? { type: 'player', playerId: b } : null,
        isBye: bye, scoreA: 0, scoreB: 0, log: [], faultActions: [],
        winnerId: bye ? a || b : null, loserId: null,
        completed: bye, status: bye ? 'completed' : a && b ? 'ready' : 'pending',
        station: null,
      });
    }
  }
  for (let round = 1; round < Math.log2(size); round++) {
    const previous = matches.filter(match => match.round === round - 1);
    for (const match of matches.filter(item => item.round === round)) {
      const left = previous[match.indexInRound * 2];
      const right = previous[match.indexInRound * 2 + 1];
      if (left.completed && left.winnerId) match.a = { type: 'player', playerId: left.winnerId };
      if (right.completed && right.winnerId) match.b = { type: 'player', playerId: right.winnerId };
      if (match.a && match.b) match.status = 'ready';
    }
  }
  let nextSeq = 0, playable = 0;
  for (let round = 0; round < Math.log2(size); round++) {
    const previous = matches.filter(match => match.round === round - 1);
    const tier = match => round === 0 ? 0 : [0, 1].filter(offset =>
      !previous[match.indexInRound * 2 + offset].isBye).length;
    for (const match of matches.filter(item => item.round === round)
      .sort((a, b) => tier(a) - tier(b) || a.indexInRound - b.indexInRound)) {
      match.seq = nextSeq++;
      match.scheduleTier = tier(match);
      if (!match.isBye) match.station = playable++ % stations + 1;
    }
  }
  const courts = Object.fromEntries(Array.from({ length: stations }, (_, index) => {
    const station = index + 1;
    const queue = matches.filter(match => match.station === station && match.a && match.b && !match.completed)
      .sort((a, b) => a.seq - b.seq);
    const current = queue[0], next = queue[1];
    return ['court' + station, {
      currentMatchId: current?.id || null, nextMatchId: next?.id || null,
      status: current?.status || 'idle', lockedBy: null, lockedAt: null, updatedAt: now,
    }];
  }));
  return { bracketSize: size, drawnAt: now, matches,
    currentMatchId: matches.filter(match => !match.isBye).sort((a, b) => a.seq - b.seq)[0]?.id || null,
    courtAssignments: courts };
}

module.exports = { drawGroup };
