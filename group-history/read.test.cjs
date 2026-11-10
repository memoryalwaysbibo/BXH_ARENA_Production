'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHistoryReader } = require('./read.cjs');
const { createGroupStageCommand } = require('../group-stages/command.cjs');
const { prepareRelease } = require('../group-stages/prepare-release.cjs');
const buckets = require('../referee-seats/functions/bucket-state.cjs');
const { fixture, state, updateState } = require('./test-fixtures.cjs');

const read = item => createHistoryReader(item.db)(item.parentCode, 'user-0');

test('authenticated history returns six safe trees and only viewer matches, without writes', async () => {
  const item = await fixture({ complete: true, family: true });
  const before = structuredClone([...item.db.rows]);
  const result = await read(item);
  assert.deepEqual(result.stages.map(stage => stage.key), ['A', 'B', 'C', 'D', 'runners-up', 'champions']);
  assert(result.stages.every(stage => stage.status === 'completed' && stage.matches.length));
  assert.equal(result.ownPlayerIds.length, 2);
  assert(result.ownPlayerIds.every(id => /^hp_[a-f0-9]{32}$/.test(id)));
  assert.deepEqual([...new Set(result.stages.flatMap(stage => stage.players).filter(player => result.ownPlayerIds.includes(player.id)).map(player => player.name))].sort(), ['Synthetic 0', 'Synthetic 1']);
  assert(result.ownMatches.every(match => result.ownPlayerIds.includes(match.a?.playerId) || result.ownPlayerIds.includes(match.b?.playerId)));
  assert.equal(result.placements.length, 2);
  assert(result.placements.every(row => result.ownPlayerIds.includes(row.playerId) && Number.isInteger(row.placement) && row.points === null));
  assert.equal(result.points, null); assert.equal(result.pointsStatus, 'unverified');
  assert.equal(result.needsReview, false);
  const serialized = JSON.stringify(result);
  for (const secret of ['registrationUid', 'guardianUid', 'familyPlayerId', 'registrationId', 'user-0',
    'SENSITIVE-PHONE', 'SENSITIVE-EMAIL', 'PRIVATE-SEED', 'SECRET-REFEREE', 'PRIVATE-LOG', 'roomCodes', 'ownerUid']) assert(!serialized.includes(secret), secret);
  assert(result.stages.every(stage => stage.players.every(player => Object.keys(player).sort().join(',') === 'id,name')));
  assert.deepEqual([...item.db.rows], before);
  assert.deepEqual(item.db.writes, []);
  assert(item.db.transactions.every(options => options?.readOnly === true));
  assert(item.db.reads.every(target => !target.startsWith('publicTournaments/') && !target.startsWith('ladderTransactions/')));
});

test('one draw publishes all group brackets and the viewer assignment before each child opens', async () => {
  const item = await fixture();
  for (const uid of ['user-0', 'operator']) {
    item.db.reads.length = 0;
    const result = await createHistoryReader(item.db)(item.parentCode, uid);
    assert.equal(result.stages[0].status, 'ready');
    assert(result.stages.slice(1, 4).every(stage => stage.status === 'scheduled' && stage.matches.length && stage.players.length));
    assert(result.stages.slice(4).every(stage => stage.status === 'unpublished' && !stage.matches.length));
    for (const key of ['B', 'C', 'D']) assert(item.db.reads.includes('tournaments/' + item.plan().roomCodes[key]));
    const ownKey = Object.keys(item.plan().event.groups).find(key => item.plan().event.groups[key]
      .some(player => player.registrationUid === uid));
    assert.deepEqual(result.assignedGroups, ownKey ? [ownKey] : []);
  }
  const bPlayer = item.players.find(player => item.plan().event.groups.B.some(row => row.id === player.id));
  const bResult = await createHistoryReader(item.db)(item.parentCode, bPlayer.registrationUid);
  assert.deepEqual(bResult.assignedGroups, ['B']);
  assert.equal(bResult.stages[1].status, 'scheduled');
});

test('draw-all plan rejects an inconsistent pending active stage and mismatched room', async () => {
  const item = await fixture();
  for (const drawPending of [true, undefined]) {
    item.plan().active.drawPending = drawPending;
    await assert.rejects(read(item), { code: 'group-stage-source' });
  }
  item.plan().active = { key: 'A', code: item.plan().roomCodes.B, drawPending: false };
  await assert.rejects(read(item), { code: 'group-stage-source' });
});

test('playoff pending draw stays hidden after all group results are collected', async () => {
  const item = await fixture();
  for (const key of ['A', 'B', 'C', 'D']) await item.finishStage(key);
  await item.coordinator.openNext(item.parentCode, 'runners-up', 'operator');
  const result = await read(item);
  assert(result.stages.slice(0, 4).every(stage => stage.status === 'completed'));
  assert.equal(result.stages[4].status, 'unpublished');
  assert.deepEqual(result.stages[4].players, []);
});

test('parallel rehearsal exposes all four published trees only to an admin', async () => {
  const item = await fixture({ rehearsal: true, parallel: true });
  const result = await createHistoryReader(item.db)(item.parentCode, 'operator');
  assert(result.stages.slice(0, 4).every(stage => stage.status === 'ready'));
  assert.deepEqual(result.ownPlayerIds, []); assert.deepEqual(result.placements, []);
  await assert.rejects(createHistoryReader(item.db)(item.parentCode, 'outside'), { code: 'group-permission-denied' });
  item.plan().groupDrawAll = false;
  assert((await createHistoryReader(item.db)(item.parentCode, 'operator')).stages.every(stage => stage.status === 'unpublished'));
});

test('two-group history retains six slots with C/D not applicable and correct playoff places', async () => {
  const item = await fixture({ count: 2, complete: true });
  const result = await read(item);
  assert.deepEqual(result.stages.filter(stage => stage.status === 'not-applicable').map(stage => stage.key), ['C', 'D']);
  assert.equal(result.stages[4].label, '第 3～4 名賽');
  assert.equal(result.stages[5].label, '第 1～2 名賽');
  const all = [];
  for (let index = 0; index < 8; index++) all.push(...(await createHistoryReader(item.db)(item.parentCode, 'user-' + index)).placements);
  assert.deepEqual(all.map(row => row.placement).sort((a, b) => a - b), [1, 2, 3, 4, 5, 5, 5, 5]);
});

test('completed and archived parents stay readable after started/awarded markers', async () => {
  const item = await fixture({ complete: true });
  for (const archiveStatus of ['completed', 'archived']) {
    updateState(item.db, item.parentCode, parent => Object.assign(parent, { archiveStatus, startedAt: 9, matches: [{ id: 'parent-result' }] }));
    Object.assign(item.db.rows.get('tournaments/' + item.parentCode), { ladderPointsAwarded: true, archiveStatus, systemClosed: true });
    const result = await read(item);
    assert.equal(result.parent.archiveStatus, archiveStatus); assert.equal(result.placements.length, 1);
  }
});

test('account, feature gate, and outsider permissions fail closed', async t => {
  for (const profile of [undefined, { active: false }, { active: true, deleted: true }, { active: true, isTestAccount: true },
    { active: true, role: 'tester' }, { active: true, isTestData: true }, { active: true, testAccount: true },
    { active: true, testMode: true }, { active: true, accountStatus: 'frozen' }]) await t.test(JSON.stringify(profile), async () => {
    const item = await fixture(); item.db.rows.set('users/user-0', profile);
    await assert.rejects(read(item), { code: 'group-permission-denied' });
  });
  const item = await fixture();
  await assert.rejects(createHistoryReader(item.db)(item.parentCode, 'outside'), { code: 'group-permission-denied' });
  for (const gate of [{ enabled: false, parentCodes: [item.parentCode] }, { enabled: true, parentCodes: [] }]) {
    item.db.rows.set('systemConfig/groupStages', gate);
    await assert.rejects(read(item), { code: 'group-room-disabled' });
  }
});

test('callable dispatcher ignores all client supplied identity fields', async () => {
  const item = await fixture();
  const command = createGroupStageCommand(item.coordinator, createHistoryReader(item.db));
  await assert.rejects(command({ data: { action: 'history', parentCode: item.parentCode, uid: 'operator', actorUid: 'operator' } }), { code: 'group-auth-required' });
  await assert.rejects(command({ auth: { uid: 'outside' }, data: { action: 'history', parentCode: item.parentCode, uid: 'operator', viewerUid: 'user-0' } }), { code: 'group-permission-denied' });
  assert.deepEqual((await command({ auth: { uid: 'user-0' }, data: { action: 'history', parentCode: item.parentCode, actorUid: 'outside' } })).ownPlayerIds, (await read(item)).ownPlayerIds);
});

test('parent incarnation and stable identities cannot be replaced or matched by name', async t => {
  for (const [name, mutate, code] of [
    ['incarnation', parent => { parent.id = 'replacement'; }, 'group-parent-room-changed'],
    ['same-name imposter', parent => { parent.players[0].registrationUid = 'outside'; }, 'group-parent-roster-changed'],
    ['missing roster', parent => { parent.players.pop(); }, 'group-parent-roster-changed'],
    ['test player', parent => { parent.players[0].isTestData = true; }, 'group-parent-roster-changed'],
  ]) await t.test(name, async () => {
    const item = await fixture(); updateState(item.db, item.parentCode, mutate);
    await assert.rejects(read(item), { code });
  });
});

test('confirmation, exact registration id, and family guardian are revalidated on every read', async t => {
  for (const [name, mutate] of [
    ['cancelled', row => { row.status = 'cancelled'; }],
    ['wrong guardian', row => { row.guardianUid = 'outside'; }],
    ['wrong family', row => { row.familyPlayerId = 'different-child'; }],
    ['wrong registration', row => { row.registrationId = 'reg-2'; }],
  ]) await t.test(name, async () => {
    const item = await fixture({ family: true });
    mutate(item.db.rows.get('tournaments/' + item.parentCode + '/registrations/reg-1'));
    await assert.rejects(read(item), { code: 'group-registration-mismatch' });
  });
});

test('child identity, linkage and ladder modes fail closed', async t => {
  for (const mutate of [
    (doc, child) => { child.id = 'different-room'; },
    (doc, child) => { child.groupStage.parentCode = 'BXH-OTHER1'; },
    (doc, child) => { child.players[0].registrationUid = 'outside'; },
    doc => { doc.ladderMode = 'ranked'; },
    doc => { doc.ladderPointsAwarded = true; },
  ]) await t.test(String(mutate), async () => {
    const item = await fixture(), code = item.plan().roomCodes.A, doc = item.db.rows.get('tournaments/' + code), child = state(item.db, code);
    mutate(doc, child); doc.data = JSON.stringify(child);
    await assert.rejects(read(item), error => ['group-stage-source', 'group-roster-changed'].includes(error.code));
  });
});

test('collected/live winner mismatch returns current tree but suppresses all stale placements', async () => {
  const item = await fixture({ complete: true }), code = item.plan().roomCodes.champions;
  updateState(item.db, code, child => {
    const final = child.matches.find(match => match.bracket === 'SE' && match.round === 1);
    [final.winnerId, final.loserId] = [final.loserId, final.winnerId];
    [final.scoreA, final.scoreB] = [final.scoreB, final.scoreA];
    child.championId = final.winnerId; child.runnerUpId = final.loserId;
  });
  const result = await read(item);
  assert.equal(result.needsReview, true); assert.deepEqual(result.placements, []);
  assert.equal(result.stages[5].status, 'needs-review');
  assert.equal(result.stages[5].matches.find(match => match.bracket === 'SE' && match.round === 1).scoreB, 4);
});

test('score/winner contradiction and explicitly saved score changes need review', async () => {
  const item = await fixture({ complete: true }), code = item.plan().roomCodes.A;
  updateState(item.db, code, child => { child.matches[0].scoreA = 0; child.matches[0].scoreB = 4; });
  assert.equal((await read(item)).stages[0].status, 'needs-review');
  updateState(item.db, code, child => { child.matches[0].scoreA = 5; child.matches[0].scoreB = 0; });
  item.plan().event.results.A.matches[0].scoreA = 4;
  assert.equal((await read(item)).stages[0].status, 'needs-review');
});

test('bucket scores are authoritative and stale/missing buckets never fall back', async () => {
  const item = await fixture({ complete: true }), code = item.plan().roomCodes.A;
  const doc = item.db.rows.get('tournaments/' + code), child = state(item.db, code);
  const manifest = buckets.makeManifest(child, 'synthetic-epoch');
  doc.scoreStorage = manifest;
  const encoded = buckets.encode(child, manifest);
  encoded.forEach(bucket => item.db.rows.set('tournaments/' + code + '/matchBuckets/' + bucket.bucketId, bucket));
  updateState(item.db, code, base => base.matches.forEach(match => { match.scoreA = 99; match.scoreB = 98; }));
  const result = await read(item);
  assert(result.stages[0].matches.every(match => match.scoreA === 4 && match.scoreB === 0));
  const first = item.db.rows.get('tournaments/' + code + '/matchBuckets/court-1');
  first.epoch = 'stale-epoch';
  await assert.rejects(read(item), { code: 'group-stage-score-unavailable' });
  first.epoch = manifest.epoch;
  item.db.rows.delete('tournaments/' + code + '/matchBuckets/court-1');
  await assert.rejects(read(item), { code: 'group-stage-score-unavailable' });
});

test('release package contains history reader and only exports the existing callable', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'group-history-release-'));
  const output = path.join(directory, 'candidate');
  try {
    const result = prepareRelease(path.resolve(__dirname, '..'), output);
    assert.deepEqual(result.functions, ['groupStageCommand']);
    assert.equal(fs.readFileSync(path.join(output, 'functions/group-history/read.cjs'), 'utf8'), fs.readFileSync(path.join(__dirname, 'read.cjs'), 'utf8'));
    assert(!fs.existsSync(path.join(output, 'functions/group-history/test-fixtures.cjs')));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('unchanged archived children preserve collected placements', async () => {
  const item = await fixture({ complete: true });
  for (const code of Object.values(item.plan().roomCodes)) updateState(item.db, code, child => { child.archiveStatus = 'archived'; });
  const result = await read(item);
  assert.equal(result.needsReview, false); assert.equal(result.placements.length, 1);
});

test('malformed scores cannot silently turn a collected result into verified placement', async () => {
  const item = await fixture({ complete: true });
  updateState(item.db, item.plan().roomCodes.A, child => { child.matches[0].scoreA = 'secret'; child.matches[0].scoreB = -1; });
  const result = await read(item);
  assert.equal(result.stages[0].matches[0].scoreA, null);
  assert.equal(result.stages[0].matches[0].scoreB, null);
  assert.equal(result.needsReview, true); assert.deepEqual(result.placements, []);
});

test('response IDs never expose embedded UID, family profile ID, or child room codes', async () => {
  const item = await fixture({ family: true, privateIds: true, complete: true });
  const first = await read(item), second = await read(item), serialized = JSON.stringify(first);
  for (const privateValue of ['user-0', 'synthetic-child', ...Object.values(item.plan().roomCodes), ...item.players.map(player => player.id)]) {
    assert(!serialized.includes(privateValue), privateValue);
  }
  assert.deepEqual(first, second);
  assert(first.ownPlayerIds.every(id => /^hp_[a-f0-9]{32}$/.test(id)));
  for (const stage of first.stages) {
    const ids = new Set(stage.players.map(player => player.id));
    for (const match of stage.matches) {
      assert.equal(match.id, [stage.key, match.bracket, match.round, match.indexInRound].join(':'));
      assert([match.a?.playerId, match.b?.playerId, match.winnerId, match.loserId].filter(Boolean).every(id => ids.has(id)));
    }
  }
  assert(first.placements.every(row => first.ownPlayerIds.includes(row.playerId)));
});

test('uncollected completed outcomes must refer to their actual opponents even without scores', async () => {
  const item = await fixture(), code = item.plan().roomCodes.A;
  updateState(item.db, code, child => {
    const first = child.matches[0];
    const third = child.players.find(player => ![first.a.playerId, first.b.playerId].includes(player.id));
    Object.assign(first, { completed: true, winnerId: third.id, loserId: first.b.playerId, scoreA: null, scoreB: null });
  });
  const result = await read(item);
  assert.equal(result.stages[0].status, 'needs-review'); assert.equal(result.needsReview, true);
  assert.deepEqual(result.placements, []);
});
