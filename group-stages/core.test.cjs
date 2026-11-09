'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { GROUPS, prepare, nextStage, collect, settlementInput } = require('./core.cjs');
const ladder = require('../ladder-v1.js');

const { roster, finish } = require('./test-fixtures.cjs');

test('draw balances the locked roster and preserves each original identity', () => {
  const players = roster(318);
  const event = prepare(players, 'test-seed');
  assert.deepEqual(Object.values(event.groups).map(group => group.length), [80, 80, 79, 79]);
  assert.deepEqual(prepare([...players].reverse(), 'test-seed'), event);
  const original = new Map(players.map(player => [player.id, player]));
  for (const group of Object.values(event.groups)) {
    for (const player of group) assert.deepEqual(player, original.get(player.id));
  }
  assert.throws(() => prepare(roster(321), 'test-seed'), { code: 'group-roster-size' });
  assert.throws(() => prepare(roster(15), 'test-seed'), { code: 'group-roster-size' });
  players[0].registrationUid = players[1].registrationUid;
  assert.throws(() => prepare(players, 'test-seed'), { code: 'group-duplicate-identity' });
  players[0].familyPlayerId = 'child-a';
  players[1].familyPlayerId = 'child-b';
  assert.doesNotThrow(() => prepare(players, 'test-seed'));
});

test('four 80-player brackets and two playoffs produce one 320-player settlement input', () => {
  let event = prepare(roster(320), 'test-seed');
  const first = event;
  for (const group of GROUPS) {
    const stage = nextStage(event);
    assert.equal(stage.key, group);
    assert.equal(stage.players.length, 80);
    assert.equal(stage.bronzeMatch, false);
    event = collect(event, group, finish(stage));
  }
  assert.deepEqual(first.results, {});
  assert.throws(() => settlementInput(event), { code: 'group-stage-incomplete' });

  for (const [index, key] of ['champions', 'runners-up'].entries()) {
    const stage = nextStage(event);
    assert.equal(stage.key, key);
    assert.equal(stage.bronzeMatch, true);
    assert.deepEqual(stage.players.map(player => player.id), GROUPS.map(group => event.results[group].places[index]));
    event = collect(event, key, finish(stage));
  }
  assert.equal(nextStage(event), null);

  const input = settlementInput(event);
  assert.equal(input.effectiveCount, 320);
  assert.equal(input.multiplier, ladder.multiplier(320));
  assert.equal(input.matches.length, 4 * 79 + 8);
  assert.equal(new Set(input.matches.map(match => match.id)).size, input.matches.length);
  assert.equal(input.participants.length, 320);
  assert.equal(input.participants.reduce((sum, item) => sum + item.wins, 0), input.matches.length);
  for (const [i, id] of input.topEight.entries()) {
    assert.equal(input.participants.find(item => item.player.id === id).placement, i + 1);
  }
  assert.equal(input.participants.filter(item => item.placement === 9).length, 8);
  assert.equal(input.participants.filter(item => item.placement === 17).length, 16);
  const champion = input.participants.find(item => item.placement === 1);
  assert.equal(champion.pointsEarned, 10 + Math.round(90 * ladder.multiplier(320)));
});

test('result collection rejects out-of-order, altered rosters, and invalid propagation', () => {
  const event = prepare(roster(64), 'test-seed');
  const state = finish(nextStage(event));
  assert.throws(() => collect(event, 'B', state), { code: 'group-stage-order' });
  assert.throws(() => collect(event, 'A', { ...state, archiveStatus: 'ongoing' }), { code: 'group-stage-not-complete' });
  assert.throws(() => collect(event, 'A', { ...state, players: state.players.slice(1) }), { code: 'group-roster-changed' });

  const final = state.matches.at(-1);
  const other = state.players.find(player => player.id !== final.a.playerId && player.id !== final.b.playerId);
  const invalid = structuredClone(state);
  invalid.matches.at(-1).b.playerId = other.id;
  assert.throws(() => collect(event, 'A', invalid), { code: 'group-invalid-advancement' });

  const accepted = collect(event, 'A', state);
  assert.throws(() => collect(accepted, 'A', state), { code: 'group-stage-order' });
});
