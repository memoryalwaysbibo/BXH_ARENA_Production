'use strict';

function createDemoSeed() {
  const code = 'BXH-DEMO2026';
  const registrations = [];
  const players = [];
  const waitlistPlayers = [];
  const start = 1791511200000;
  for (let index = 1; index <= 32; index++) {
    const id = 'accepted_' + String(index).padStart(2, '0');
    const name = '正取選手 ' + String(index).padStart(2, '0');
    registrations.push({registrationId: id, uid: id, displayName: name, status: 'confirmed', createdAt: start + index,
      cancelledAt: null, cancelledBy: null});
    players.push({id: 'reg_' + id, name, registrationId: id, registrationUid: id, source: 'online', checkedIn: index <= 20,
      preservedMetadata: '既有正取不可被抽選改寫'});
  }
  for (let index = 1; index <= 20; index++) {
    const child = index === 2;
    const id = index === 1 ? 'demo_guardian_01' : child ? 'family_demo_child_01' : 'wait_' + String(index).padStart(2, '0');
    const name = index === 1 ? '林家長（本人）' : child ? '林小宇（子女）' : '現場候補 ' + String(index).padStart(2, '0');
    const row = {registrationId: id, uid: id, displayName: name, status: 'waitlist', createdAt: start + 100 + index,
      waitRank: index, onsiteWaitlistEligibility: {eligible: false}, cancelledAt: null, cancelledBy: null};
    const player = {id: child ? 'family_demo_child_01' : 'reg_' + id, name, registrationId: id,
      registrationUid: child ? 'demo_guardian_01' : id, source: 'online', checkedIn: false, waitRank: index};
    if (child) {
      Object.assign(row, {familyPlayerId: 'demo_child_01', participantId: 'demo_child_01', guardianUid: 'demo_guardian_01'});
      Object.assign(player, {familyPlayerId: 'demo_child_01', participantId: 'demo_child_01', guardianUid: 'demo_guardian_01'});
    }
    registrations.push(row);
    waitlistPlayers.push(player);
  }
  const state = {meta: {name: '現場候補抽選 · 合成資料', registrationCapacity: 42, registrationStatus: 'closed', checkinRequired: true,
    registrationAutoFillEnabled: false, registrationOnsiteWaitlistEnabled: true}, players, waitlistPlayers, matches: [], registrationRosterRevision: 0};
  const tournament = {name: state.meta.name, capacity: 42, confirmedCount: 32, waitlistCount: 20, tournamentPhase: 'waiting',
    registrationStatus: 'closed', assignedStaffUids: ['demo-staff', 'demo-staff-2'], onsiteWaitlistDrawEnabled: true,
    onsiteWaitlistDraw: {enabled: true, status: 'open', revision: 0, roundNumber: 0}, data: JSON.stringify(state)};
  const publicTournament = {capacity: 42, confirmedCount: 32, waitlistCount: 20, tournamentPhase: 'waiting', registrationStatus: 'closed',
    onsiteWaitlistDrawEnabled: true, bracketView: JSON.stringify({meta: {registrationStatus: 'closed'}, players: players.map(p => ({id: p.id, name: p.name, checkedIn: p.checkedIn}))})};
  return {schemaVersion: 1, synthetic: true, users: {
    'demo-staff': {active: true, role: 'staff'},
    'demo-staff-2': {active: true, role: 'staff'},
    'demo-viewer': {active: true, role: 'player'},
  }, events: {[code]: {tournament, publicTournament, registrations, operations: {}, rounds: []}}};
}

module.exports = {createDemoSeed};
