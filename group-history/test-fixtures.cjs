'use strict';

const assert = require('node:assert/strict');
const { createCoordinator } = require('../group-stages/coordinator.cjs');
const { roster, finish } = require('../group-stages/test-fixtures.cjs');
const clone = value => value === undefined ? undefined : structuredClone(value);

function memoryDb() {
  const rows = new Map(), reads = [], writes = [], transactions = [];
  const ref = path => ({ path, collection: name => ({ doc: id => ref(path + '/' + name + '/' + id) }) });
  const snapshot = target => {
    reads.push(target.path);
    return { exists: rows.has(target.path), data: () => clone(rows.get(target.path)) };
  };
  return { rows, reads, writes, transactions, doc: ref,
    async runTransaction(callback, options) {
      transactions.push(options);
      const pending = [];
      const write = (target, value, create = false) => {
        assert.notEqual(options?.readOnly, true, 'history must not write');
        if (create) assert(!rows.has(target.path));
        pending.push([target.path, clone(value)]);
      };
      const result = await callback({
        get: async target => snapshot(target), getAll: async (...targets) => targets.map(snapshot),
        create: (target, value) => write(target, value, true), set: write, update: write,
        delete: target => write(target, undefined),
      });
      pending.forEach(([path, value]) => { writes.push(path); rows.set(path, value); });
      return result;
    },
  };
}
function state(db, code) { return JSON.parse(db.rows.get('tournaments/' + code).data); }
function updateState(db, code, change) {
  const document = db.rows.get('tournaments/' + code);
  const next = state(db, code); change(next);
  document.data = JSON.stringify(next);
}
async function fixture({ count = 4, rehearsal = false, parallel = false, complete = false, family = false, privateIds = false } = {}) {
  const db = memoryDb(), parentCode = 'BXH-HIST01';
  const players = rehearsal ? roster(count * 4).map((player, index) => ({
    id: player.id, name: 'Synthetic guest ' + index, source: 'onsite', participantType: 'onsite_guest',
    accountLinked: false, ladderEligible: false, activityEligible: false, checkedIn: true,
  })) : roster(count * 4);
  if (family) {
    players[1].familyPlayerId = 'synthetic-child'; players[1].guardianUid = 'user-0';
    players[1].registrationUid = 'user-0'; players[1].ladderEligible = false;
  }
  if (privateIds) players.forEach(player => { player.id = player.familyPlayerId ? 'family_' + player.familyPlayerId : 'reg_' + player.registrationUid; });
  db.rows.set('tournaments/' + parentCode, {
    name: 'Synthetic private event', eventAuthority: 'official', ladderMode: rehearsal ? 'general' : 'ranked',
    visibility: rehearsal ? 'private' : 'public', registrationEnabled: !rehearsal,
    createdBy: 'operator', ownerUid: 'operator',
    data: JSON.stringify({ id: 'synthetic-parent-incarnation', cloudCode: parentCode,
      players, matches: [], archiveStatus: 'ongoing', startedAt: null,
      meta: { name: 'Synthetic history', formatType: 'single', battleMode: 'individual',
        playMode: 'standard', checkinRequired: true, ladderMode: rehearsal ? 'general' : 'ranked',
        registrationVisibility: rehearsal ? 'private' : 'public', registrationEnabled: !rehearsal },
    }),
  });
  db.rows.set('users/operator', { active: true, role: 'admin' });
  db.rows.set('users/outside', { active: true, role: 'player' });
  for (const player of players.filter(player => player.registrationUid)) {
    db.rows.set('users/' + player.registrationUid, { active: true, role: 'player' });
    db.rows.set('tournaments/' + parentCode + '/registrations/' + player.registrationId,
      { uid: player.familyPlayerId ? 'family_' + player.familyPlayerId : player.registrationUid,
        ...(player.familyPlayerId ? { guardianUid: player.guardianUid, familyPlayerId: player.familyPlayerId } : {}),
        status: 'confirmed', phone: 'SENSITIVE-PHONE', email: 'SENSITIVE-EMAIL' });
  }
  db.rows.set('systemConfig/groupStages', { enabled: true, parentCodes: [parentCode],
    rehearsalParentCodes: rehearsal ? [parentCode] : [], parallelRehearsalParentCodes: parallel ? [parentCode] : [] });
  let serial = 0;
  const coordinator = createCoordinator(db, { drawSeed: () => 'PRIVATE-SEED', clock: () => 1,
    newCode: () => 'BXH-H' + String(++serial).padStart(5, '0') });
  await coordinator.prepare(parentCode, 'operator', count);
  await coordinator.openAllGroups(parentCode, 'operator');
  if (parallel) {
    // The history reader accepts legacy parallel plans without requiring
    // the parallel scheduler in this release.
    const plan = db.rows.get('groupStagePlans/' + parentCode);
    plan.parallel = true;
    plan.active = null;
  }
  async function finishStage(key) {
    let plan = db.rows.get('groupStagePlans/' + parentCode);
    if (!plan.parallel || !['A', 'B', 'C', 'D'].includes(key)) await coordinator.openNext(parentCode, key, 'operator');
    plan = db.rows.get('groupStagePlans/' + parentCode);
    const code = plan.roomCodes[key];
    updateState(db, code, child => {
      const completed = finish({ players: child.players, bronzeMatch: child.meta.bronzeMatch });
      completed.matches.forEach((match, index) => Object.assign(match, { scoreA: match.isBye ? 0 : 4,
        scoreB: 0, station: index % 2 + 1, confirmedByUid: 'SECRET-REFEREE', log: [{ private: 'PRIVATE-LOG' }] }));
      Object.assign(child, completed, { meta: child.meta, drawnAt: 1 });
    });
    if (plan.active?.drawPending) await coordinator.publishDraw(parentCode, key, code, 'operator');
    await coordinator.collect(parentCode, key, code, 'operator');
  }
  if (complete) for (const key of [...['A', 'B', 'C', 'D'].slice(0, count),
    ...(count === 4 ? ['runners-up', 'champions'] : ['champions', 'runners-up'])]) await finishStage(key);
  db.reads.length = 0; db.writes.length = 0; db.transactions.length = 0;
  return { db, parentCode, coordinator, finishStage,
    plan: () => db.rows.get('groupStagePlans/' + parentCode), players };
}
module.exports = { fixture, state, updateState, memoryDb };
