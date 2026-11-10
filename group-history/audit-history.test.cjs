'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createHistoryReader } = require('./read.cjs');
const { createGroupStageCommand } = require('../group-stages/command.cjs');
const { prepare, nextStage, collect, settlementInput } = require('../group-stages/core.cjs');
const { roster, finish } = require('../group-stages/test-fixtures.cjs');
const clone = value => structuredClone(value);
const parentCode = 'BXH-AUDPAR';
const publicId = raw => 'hp_' + createHash('sha256').update(JSON.stringify(['group-history-player-v1', parentCode, 'audit-parent', raw])).digest('hex').slice(0, 32);

function fixture({ count = 4, complete = true, family = false, realIds = false } = {}) {
  const players = roster(count * 4);
  if (family) for (const i of [0, 1]) Object.assign(players[i], { registrationUid: 'guardian', guardianUid: 'guardian', familyPlayerId: 'child-' + i });
  if (realIds) for (const player of players) player.id = player.familyPlayerId ? 'family_' + player.familyPlayerId : 'reg_' + player.registrationUid;
  let event = prepare(players, 'independent-audit', count);
  const records = new Map(), roomCodes = {};
  const stages = [...Object.keys(event.groups), ...(count === 4 ? ['runners-up', 'champions'] : ['champions', 'runners-up'])];
  const parent = { eventAuthority: 'official', ladderMode: 'ranked', ladderPointsAwarded: true, data: {
    id: 'audit-parent', cloudCode: parentCode, archiveStatus: 'archived', startedAt: 1, matches: [{ id: 'parent-result' }], ladderPointsAwarded: true,
    meta: { name: 'Synthetic audit', formatType: 'single', battleMode: 'individual', playMode: 'standard', checkinRequired: true }, players,
  } };
  records.set('tournaments/' + parentCode, parent);
  for (const [index, key] of stages.entries()) {
    const stage = nextStage(event, key), done = finish(stage), code = 'BXH-AUDIT' + index;
    for (const match of done.matches) if (!match.isBye) Object.assign(match, { scoreA: 4, scoreB: 1, privateNote: 'DO NOT RETURN' });
    const state = { ...done, id: parentCode + ':' + key, cloudCode: code, groupStage: { parentCode, key } };
    records.set('tournaments/' + code, { groupStage: { parentCode, key }, ladderMode: 'general', data: clone(state) });
    roomCodes[key] = code;
    event = collect(event, key, state);
  }
  if (!complete) event = { ...event, results: {} };
  const plan = { parentRoomId: 'audit-parent', event, roomCodes, active: complete ? null : { key: 'A', code: roomCodes.A, drawPending: false } };
  records.set('groupStagePlans/' + parentCode, plan);
  const gate = { enabled: true, parentCodes: [parentCode] };
  records.set('systemConfig/groupStages', gate);
  records.set('users/admin', { active: true, role: 'admin' });
  records.set('users/outsider', { active: true, role: 'player' });
  for (const player of players) {
    records.set('users/' + player.registrationUid, { active: true, role: 'player' });
    records.set('tournaments/' + parentCode + '/registrations/' + player.registrationId,
      { uid: player.registrationUid, status: 'confirmed', ...(player.familyPlayerId ? { guardianUid: player.guardianUid, familyPlayerId: player.familyPlayerId } : {}) });
  }
  const reads = [], options = [];
  const ref = path => ({ path, collection: collection => ({ doc: id => ref(path + '/' + collection + '/' + id) }) });
  const snapshot = reference => { reads.push(reference.path); return { exists: records.has(reference.path), data: () => clone(records.get(reference.path)) }; };
  const db = { doc: ref, runTransaction: async (callback, option) => { options.push(option); return callback({ get: async r => snapshot(r), getAll: async (...refs) => refs.map(snapshot) }); } };
  return { players, parent, plan, gate, records, reads, options, read: createHistoryReader(db), child: key => records.get('tournaments/' + roomCodes[key]).data };
}

test('independent audit: archived parents, final placements, sanitization, and read-only transaction', async () => {
  const f = fixture(), result = await f.read(parentCode, 'user-0');
  assert.equal(result.parent.archiveStatus, 'archived');
  assert.equal(result.needsReview, false);
  assert.equal(result.stages.length, 6);
  assert(result.stages.every(stage => stage.status === 'completed'));
  assert.deepEqual(result.ownPlayerIds, [publicId('p-0')]);
  assert(result.ownMatches.every(match => [match.a?.playerId, match.b?.playerId].includes(publicId('p-0'))));
  assert.deepEqual(result.placements.map(p => p.playerId), [publicId('p-0')]);
  assert.equal(result.points, null);
  assert.equal(result.pointsStatus, 'unverified');
  assert.deepEqual(f.options, [{ readOnly: true }]);
  const output = JSON.stringify(result);
  for (const secret of ['registrationUid', 'registrationId', 'guardianUid', 'DO NOT RETURN', 'BXH-AUDIT0', 'user-0']) assert.equal(output.includes(secret), false, secret);
});

test('independent audit: inactive/unlisted parent and outsider are denied', async () => {
  for (const mutation of [f => f.gate.enabled = false, f => f.gate.parentCodes = []]) {
    const f = fixture(); mutation(f); await assert.rejects(f.read(parentCode, 'user-0'), { code: 'group-room-disabled' });
  }
  const f = fixture();
  await assert.rejects(f.read(parentCode, 'outsider'), { code: 'group-permission-denied' });
  await assert.rejects(f.read(parentCode, ''), { code: 'group-auth-required' });
  await assert.rejects(f.read('BXH-../../', 'user-0'), { code: 'group-room-code' });
});

for (const mutation of [{ active: false }, { deleted: true }, { accountStatus: 'frozen' }, { accountStatus: 'disabled' }, { role: 'tester' }, { isTestAccount: true }]) test('independent audit: rejected profile ' + JSON.stringify(mutation), async () => {
  const f = fixture(); Object.assign(f.records.get('users/user-0'), mutation);
  await assert.rejects(f.read(parentCode, 'user-0'), { code: 'group-permission-denied' });
});

test('independent audit: locked group draws reveal opponents, but unseeded playoffs remain private', async () => {
  const f = fixture({ complete: false }); f.plan.groupDrawAll = true;
  const result = await f.read(parentCode, 'user-0');
  assert.equal(result.stages[0].status, 'in-progress');
  for (const stage of result.stages.slice(1, 4)) {
    assert.equal(stage.status, 'scheduled'); assert(stage.players.length); assert(stage.matches.length);
    assert.equal(f.reads.includes('tournaments/' + f.plan.roomCodes[stage.key]), true);
  }
  for (const stage of result.stages.slice(4)) {
    assert.equal(stage.status, 'unpublished'); assert.deepEqual(stage.players, []); assert.deepEqual(stage.matches, []);
    assert.equal(f.reads.includes('tournaments/' + f.plan.roomCodes[stage.key]), false);
  }
  assert.deepEqual(result.assignedGroups, [Object.keys(f.plan.event.groups).find(key => f.plan.event.groups[key]
    .some(player => player.registrationUid === 'user-0'))]);
  f.plan.active.drawPending = true;
  await assert.rejects(f.read(parentCode, 'user-0'), { code: 'group-stage-source' });
});

test('independent audit: guardian receives both stable child identities and no namesake identity', async () => {
  const f = fixture({ family: true }); f.players[2].name = f.players[0].name;
  const result = await f.read(parentCode, 'guardian');
  assert.deepEqual(new Set(result.ownPlayerIds), new Set(['p-0', 'p-1'].map(publicId)));
  assert(result.ownMatches.every(match => [match.a?.playerId, match.b?.playerId].some(id => ['p-0', 'p-1'].map(publicId).includes(id))));
  f.records.get('tournaments/' + parentCode + '/registrations/reg-0').guardianUid = 'someone-else';
  await assert.rejects(f.read(parentCode, 'guardian'), { code: 'group-registration-mismatch' });
});

test('independent audit: identity changes cannot be accepted using copied names', async () => {
  const f = fixture(); f.child('A').players[0].registrationUid = 'different-account';
  await assert.rejects(f.read(parentCode, 'user-0'), { code: 'group-roster-changed' });
});

test('independent audit: collected outcome mismatch withholds all final placements', async () => {
  const f = fixture(), child = f.child('A'), final = child.matches.at(-1);
  [final.winnerId, final.loserId] = [final.loserId, final.winnerId];
  [final.scoreA, final.scoreB] = [final.scoreB, final.scoreA];
  [child.championId, child.runnerUpId] = [child.runnerUpId, child.championId];
  const result = await f.read(parentCode, 'user-0');
  assert.equal(result.needsReview, true);
  assert.equal(result.stages.find(stage => stage.key === 'A').status, 'needs-review');
  assert.deepEqual(result.placements, []);
});

test('independent audit: retained frozen score mismatch is not shown as verified', async () => {
  const f = fixture(); f.plan.event.results.A.matches[0].scoreA = 3;
  const result = await f.read(parentCode, 'user-0');
  assert.equal(result.needsReview, true); assert.deepEqual(result.placements, []);
});

test('independent audit: swapped child source fails closed', async () => {
  const f = fixture(); f.child('A').groupStage.parentCode = 'BXH-OTHER1';
  await assert.rejects(f.read(parentCode, 'user-0'), { code: 'group-stage-source' });
});

test('independent audit: callable never trusts client actorUid for history', async () => {
  const f = fixture(), command = createGroupStageCommand({}, f.read);
  await assert.rejects(command({ data: { action: 'history', parentCode, actorUid: 'admin' } }), { code: 'group-auth-required' });
  await assert.rejects(command({ auth: { uid: 'outsider' }, data: { action: 'history', parentCode, actorUid: 'admin' } }), { code: 'group-permission-denied' });
});

test('independent audit: two-group historical labels and placements remain compatible', async () => {
  const f = fixture({ count: 2 }), result = await f.read(parentCode, 'user-0');
  assert.equal(result.needsReview, false);
  assert.equal(result.stages.find(stage => stage.key === 'champions').label, '第 1～2 名賽');
  assert.equal(result.stages.find(stage => stage.key === 'runners-up').label, '第 3～4 名賽');
  assert(result.stages.filter(stage => ['C', 'D'].includes(stage.key)).every(stage => stage.status === 'not-applicable'));
});

test('independent audit: merged scheduler choice keeps identical settlement places', () => {
  function settle(order) {
    let event = prepare(roster(16), 'scheduler-audit', 4);
    for (const key of ['A', 'B', 'C', 'D', ...order]) event = collect(event, key, finish(nextStage(event, key)));
    return settlementInput(event);
  }
  assert.deepEqual(settle(['champions', 'runners-up']), settle(['runners-up', 'champions']));
});

test('independent audit: uncollected completed match cannot name a nonparticipant winner', async () => {
  const f = fixture({ complete: false }), child = f.child('A'), match = child.matches[0];
  match.winnerId = child.players.find(player => ![match.a?.playerId, match.b?.playerId].includes(player.id)).id;
  match.scoreA = null; match.scoreB = null;
  const result = await f.read(parentCode, 'user-0');
  assert.equal(result.stages[0].needsReview, true);
});

test('independent audit: real reg_UID/family_ID source identifiers are opaque consistently in every output', async () => {
  const f = fixture({ family: true, realIds: true });
  const result = await f.read(parentCode, 'guardian');
  const output = JSON.stringify(result);
  for (const player of f.players) assert.equal(output.includes(player.id), false, player.id);
  for (const secret of ['guardian', 'child-0', 'child-1', 'user-2', 'reg-0', 'registrationUid', 'familyPlayerId']) assert.equal(output.includes(secret), false, secret);
  const expected = new Set(f.players.map(player => publicId(player.id)));
  const own = new Set(['family_child-0', 'family_child-1'].map(publicId));
  assert.deepEqual(new Set(result.ownPlayerIds), own);
  for (const stage of result.stages) {
    for (const player of stage.players) { assert.match(player.id, /^hp_[0-9a-f]{32}$/); assert(expected.has(player.id)); }
    for (const match of stage.matches) {
      assert.equal(match.id, stage.key + ':' + match.bracket + ':' + match.round + ':' + match.indexInRound);
      for (const id of [match.a?.playerId, match.b?.playerId, match.winnerId, match.loserId].filter(Boolean)) assert(expected.has(id));
    }
  }
  assert(result.ownMatches.every(match => [match.a?.playerId, match.b?.playerId].some(id => own.has(id))));
  assert(result.placements.every(row => own.has(row.playerId)));
  assert.deepEqual(await f.read(parentCode, 'guardian'), result);
});

test('independent audit: null scores do not legitimize completed two-sided byes or missing winner', async () => {
  for (const mutate of [match => { match.isBye = true; }, match => { match.winnerId = null; }]) {
    const f = fixture({ complete: false }), match = f.child('A').matches[0];
    match.scoreA = null; match.scoreB = null; mutate(match);
    const result = await f.read(parentCode, 'user-0');
    assert.equal(result.stages[0].needsReview, true);
  }
});
