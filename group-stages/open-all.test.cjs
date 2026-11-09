'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCoordinator } = require('./coordinator.cjs');
const { finish } = require('./test-fixtures.cjs');
const { signature } = require('../modules/main-app/bracket-commit.js');

function memoryDb() {
  const rows = new Map();
  const ref = path => ({ path, collection: name => ({
    doc: id => ref(path + '/' + name + '/' + id),
  }) });
  const snapshot = path => ({ exists: rows.has(path), data: () => rows.get(path) });
  return {
    rows,
    doc: ref,
    async runTransaction(callback) {
      const writes = [];
      const tx = {
        get: async target => snapshot(target.path),
        getAll: async (...targets) => targets.map(target => snapshot(target.path)),
        create: (target, value) => writes.push([target.path, value, true]),
        set: (target, value) => writes.push([target.path, value, false]),
      };
      const result = await callback(tx);
      for (const [path, value, create] of writes) {
        if (create) assert(!rows.has(path), 'create must not replace existing document');
        rows.set(path, value);
      }
      return result;
    },
  };
}

test('one operator action prepares every group bracket while only A opens', async () => {
  const db = memoryDb(), parentCode = 'BXH-BATCH1', actor = 'admin';
  const players = Array.from({ length: 16 }, (_, index) => ({
    id: 'guest-' + index, name: 'Guest ' + index, source: 'onsite',
    participantType: 'onsite_guest', checkedIn: true, accountLinked: false,
    ladderEligible: false, activityEligible: false,
  }));
  const parent = {
    eventAuthority: 'official', ladderMode: 'general', createdBy: actor,
    visibility: 'private', registrationEnabled: false,
    data: JSON.stringify({ id: 'parent-room', players, matches: [],
      meta: { name: 'Batch lab', formatType: 'single', battleMode: 'individual',
        playMode: 'standard', ladderMode: 'general', registrationEnabled: false,
        registrationVisibility: 'private' } }),
  };
  db.rows.set('tournaments/' + parentCode, parent);
  db.rows.set('users/' + actor, { active: true, role: 'admin' });
  db.rows.set('systemConfig/groupStages', {
    enabled: true, parentCodes: [parentCode], rehearsalParentCodes: [parentCode],
  });
  let id = 0;
  const coordinator = createCoordinator(db, {
    clock: () => 123, drawSeed: () => 'private-seed',
    newCode: () => 'BXH-BT' + String(++id).padStart(4, '0'),
  });
  const prepared = await coordinator.prepare(parentCode, actor, 4);
  assert.equal(prepared.drawAllPending, true);
  const opened = await coordinator.openAllGroups(parentCode, actor);
  assert.equal(opened.current.key, 'A');
  assert.equal(opened.drawAllPending, false);
  assert.equal(db.rows.get('groupStagePlans/' + parentCode).groupDrawAll, true);
  const codes = db.rows.get('groupStagePlans/' + parentCode).roomCodes;
  assert.equal(new Set(Object.values(codes)).size, 4);
  for (const [key, code] of Object.entries(codes)) {
    const doc = db.rows.get('tournaments/' + code), state = JSON.parse(doc.data);
    const publicDoc = db.rows.get('publicTournaments/' + code);
    assert.equal(state.groupStage.key, key);
    assert.equal(state.players.length, 4);
    assert.equal(state.matches.length, 3);
    assert.equal(state.startedAt, null);
    assert.equal(state.drawnAt, 123);
    const mirror = JSON.parse(publicDoc.bracketView);
    assert.equal(mirror.matches.length, 3);
    assert.equal(signature(mirror), signature(state));
    assert(!publicDoc.bracketView.includes('ladderEligible'));
  }
  assert.deepEqual(await coordinator.openAllGroups(parentCode, actor), opened);
  const aCode = codes.A;
  const aDoc = db.rows.get('tournaments/' + aCode);
  const aState = JSON.parse(aDoc.data);
  const completed = finish({ players: aState.players, bronzeMatch: false });
  db.rows.set('tournaments/' + aCode, {
    ...aDoc, data: JSON.stringify({ ...aState, ...completed, meta: aState.meta }),
  });
  const collected = await coordinator.collect(parentCode, 'A', aCode, actor);
  assert.equal(collected.next, 'B');
  const next = await coordinator.openNext(parentCode, 'B', actor);
  assert.equal(next.current.code, codes.B);
  assert.equal(db.rows.get('tournaments/' + codes.B).groupStage.key, 'B');
  assert.equal(db.rows.get('tournaments/' + codes.B).data.includes('"drawnAt":123'), true);
});
