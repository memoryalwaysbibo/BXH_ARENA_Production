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
  assert.deepEqual(Object.values(prepare(roster(129), 'test-seed', 2).groups).map(group => group.length), [65, 64]);
  assert.throws(() => prepare(roster(193), 'test-seed', 2), { code: 'group-roster-size' });
  assert.throws(() => prepare(roster(512), 'test-seed', 4), { code: 'group-roster-size' });
  assert.throws(() => prepare(roster(64), 'test-seed', 3), { code: 'group-invalid-count' });
  assert.throws(() => prepare(roster(385), 'test-seed'), { code: 'group-roster-size' });
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

test('the upper boundary balances 383 entrants and supports a full 384-player settlement input', () => {
  const almostFull = prepare(roster(383), 'test-seed');
  assert.deepEqual(Object.values(almostFull.groups).map(group => group.length), [96, 96, 96, 95]);

  let event = prepare(roster(384), 'test-seed');
  assert.deepEqual(Object.values(event.groups).map(group => group.length), [96, 96, 96, 96]);
  for (let stage = nextStage(event); stage; stage = nextStage(event)) {
    event = collect(event, stage.key, finish(stage));
  }
  const input = settlementInput(event);
  assert.equal(input.effectiveCount, 384);
  assert.equal(input.multiplier, ladder.multiplier(384));
  assert.equal(input.participants.length, 384);
  assert.equal(input.matches.length, 388);
  assert.equal(input.topEight.length, 8);
  assert.equal(input.participants.filter(player => player.placement === 257).length, 128);
  assert.equal(input.participants.filter(player => player.placement === 9).length, 8);
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

test('the private rehearsal entry only appears for the approved admin session', async () => {
  const ui = require('../modules/main-app/group-stages.js');
  const state = {
    cloudCode: 'BXH-ENTRY1',
    meta: { registrationVisibility: 'private', registrationEnabled: false, ladderMode: 'general',
      formatType: 'single', battleMode: 'individual', playMode: 'standard' },
  };
  assert.match(ui.rehearsalProbe(state), /BXH-ENTRY1/);
  assert.equal(ui.rehearsalProbe({ ...state, meta: { ...state.meta, registrationVisibility: 'public' } }), '');
  assert.equal(ui.rehearsalProbe({ ...state, groupStage: { parentCode: 'BXH-PARENT' } }), '');
  const node = { dataset: { code: state.cloudCode }, isConnected: true };
  const requests = [];
  let release, renders = 0;
  const waiting = new Promise(resolve => { release = resolve; });
  const request = payload => { requests.push(payload); return waiting; };
  const refresh = () => { renders++; };
  ui.discover(node, 'operator', request, refresh);
  ui.discover(node, 'operator', request, refresh);
  assert.equal(ui.drawButton(state.cloudCode, false, 'operator'), '');
  release({ unprepared: true, rehearsal: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(requests, [{ action: 'status', parentCode: state.cloudCode }]);
  assert.equal(renders, 1);
  assert.match(ui.drawButton(state.cloudCode, false, 'operator'), /分組抽籤/);
  assert.equal(ui.slot(state.cloudCode, 'player'), '');
  ui.discover(node, 'other-admin', async () => { throw Error('group-room-disabled'); }, refresh);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ui.drawButton(state.cloudCode, false, 'other-admin'), '');
  assert.equal(ui.drawButton(state.cloudCode, false, 'operator'), '');
  assert.equal(renders, 1);
});

test('the rehearsal release packages only the group callable codebase', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { prepareRelease } = require('./prepare-release.cjs');
  const root = path.resolve(__dirname, '..');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bxh-group-release-'));
  try {
    assert.throws(() => prepareRelease(root, path.join(root, 'release')), /outside-checkout/);
    const output = path.join(temp, 'artifact');
    const manifest = prepareRelease(root, output);
    assert.deepEqual(manifest.functions, ['groupStageCommand']);
    assert.deepEqual(fs.readdirSync(output).sort(), ['firebase.json', 'functions']);
    const config = JSON.parse(fs.readFileSync(path.join(output, 'firebase.json'), 'utf8'));
    assert.deepEqual(config, { functions: [{ source: 'functions', codebase: 'arena-group-stages', runtime: 'nodejs22' }] });
    const source = path.join(output, 'functions');
    const deployedFiles = fs.readdirSync(source, { recursive: true, withFileTypes: true })
      .filter(item => item.isFile()).map(item => path.relative(source, path.join(item.parentPath, item.name))).sort();
    assert.deepEqual(deployedFiles, ['group-stages/command.cjs', 'group-stages/coordinator.cjs',
      'group-stages/core.cjs', 'group-stages/court-pool.cjs', 'group-stages/draw.cjs', 'group-stages/firebase-entry.cjs',
      'ladder-v1.js', 'package.json', 'referee-seats/functions/bucket-state.cjs', 'referee-seats/functions/core.cjs',
      'referee-seats/functions/engine/court-retirement.cjs', 'referee-seats/functions/engine/double-elimination.cjs',
      'referee-seats/functions/engine/index.cjs', 'referee-seats/functions/engine/match-utils.cjs',
      'referee-seats/functions/event-staff-core.cjs']);
    assert.equal(typeof require(path.join(source, 'group-stages/coordinator.cjs')).createCoordinator, 'function');
    assert.throws(() => prepareRelease(root, output), { code: 'EEXIST' });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('one server draw creates four complete, disjoint 80-player group brackets', () => {
  const { drawGroup } = require('./draw.cjs');
  const players = Array.from({ length: 320 }, (_, index) => ({ id: 'guest-' + index }));
  const { prepare } = require('./core.cjs');
  const event = prepare(players, 'group-assignment-seed', 4);
  const entrants = new Set();
  for (const key of ['A', 'B', 'C', 'D']) {
    const stage = { key, players: event.groups[key] };
    const drawn = drawGroup(stage, 'BXH-TEST' + key + '0', 'private-draw-seed', 12, 1);
    assert.equal(drawn.bracketSize, 128);
    assert.equal(drawn.matches.length, 127);
    assert.equal(drawn.matches.filter(match => match.isBye).length, 48);
    assert.equal(drawn.matches.filter(match => !match.isBye && match.round === 0).length, 16);
    const entry = drawn.matches.filter(match => match.round === 0)
      .flatMap(match => [match.a?.playerId, match.b?.playerId].filter(Boolean));
    assert.equal(entry.length, 80);
    for (const id of entry) { assert(!entrants.has(id)); entrants.add(id); }
    assert.deepEqual(drawGroup(stage, 'BXH-TEST' + key + '0', 'private-draw-seed', 12, 1), drawn);
    assert.equal(Object.keys(drawn.courtAssignments).length, 12);
  }
  assert.equal(entrants.size, 320);
});

test('a group can release an idle physical court with future matches and invalidate its old seat', () => {
  const pool = require('./court-pool.cjs');
  const { drawGroup } = require('./draw.cjs');
  const stage = { key: 'A', players: roster(4), bronzeMatch: false };
  const courts = pool.initialCourts(['A', 'B', 'C', 'D']);
  const state = { ...drawGroup(stage, 'BXH-POOL00', 'seed', [1, 2, 3], 1), players: stage.players,
    meta: { stations: 12, formatType: 'single', eventAuthority: 'official' }, archiveStatus: 'ongoing' };
  pool.initializeRoom(state, courts, 'A', 1);
  const document = { createdBy: 'host', refereeSeatsV1: { version: 1, revision: 5,
    courts: { 3: { revision: 4, main: { uid: 'old-judge', name: '裁判' } } },
    requests: { invite: { station: 3, status: 'pending' } } } };
  const final = state.matches.find(match => match.round === 1);
  assert.equal(final.station, 3);
  const projection = pool.changeRoom(state, document, courts, 'A', 3, false, 2);
  assert.equal(state.forcedCourtExits[3].closed, true);
  assert([1, 2].includes(final.station));
  assert(final.dispatchRevision > 0);
  assert.equal(projection.refereeSeatsV1.courts[3].revision, 5);
  assert.equal(projection.refereeSeatsV1.courts[3].main, null);
  assert.equal(projection.refereeSeatsV1.requests.invite.status, 'stale');
});
