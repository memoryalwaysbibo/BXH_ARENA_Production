'use strict';

const {createHash} = require('node:crypto');
const {inspect, matchesPlayer, parseState, MAX_REGISTRATIONS, SAFE_DOCUMENT_BYTES} = require('./onsite-waitlist/core');
const {onsiteWaitlistOwned, assertLegacyRosterWritable} = require('./onsite-waitlist/owned');

function runtime(tournament) {
  if (tournament?.data === undefined) return {};
  return parseState(tournament.data);
}

function autoPromotionBlocked(t, p = {}, s = runtime(t)) {
  if (onsiteWaitlistOwned(t, p, s)) return 'onsite-waitlist-managed';
  if ([t, p, s.meta || {}].some(d => d.registrationStatus === 'closed' || d.registrationAutoFillEnabled === false)) return 'registration-closed-or-autofill-disabled';
  if ([t, p, s].some(d => d.systemClosed || d.eventCancelled || d.rosterLocked === true || d.archiveStatus === 'completed' || d.archiveStatus === 'archived') ||
      s.meta?.eventCancelled || s.startedAt) return 'locked';
  return null;
}

async function readManagedRows(tx, tournamentRef) {
  const snapshot = await tx.get(tournamentRef.collection('registrations').limit(MAX_REGISTRATIONS + 1));
  if (snapshot.docs.length > MAX_REGISTRATIONS) throw Error('transaction-size-limit');
  return snapshot.docs.map(doc => ({...doc.data(), registrationId:doc.id}));
}

function managedContext(t, p, registrations) {
  const x = inspect({tournament:t, publicTournament:p, registrations});
  if (x.cfg.enabled !== true || !['open','closed'].includes(x.cfg.status)) throw Error('registration-state-conflict');
  if (!onsiteWaitlistOwned(t, p, x.s)) throw Error('onsite-waitlist-not-managed');
  if (x.rows.length > MAX_REGISTRATIONS) throw Error('transaction-size-limit');
  const fences = [t.onsiteWaitlistRuntimeRevision, p.onsiteWaitlistRuntimeRevision, x.s.onsiteWaitlistRuntimeRevision];
  if (fences.some(value => value !== undefined) &&
      !fences.every(value => Number.isSafeInteger(value) && value >= 1 && value === fences[0])) throw Error('runtime-state-conflict');
  if (t.systemClosed || p.systemClosed || t.eventCancelled || p.eventCancelled || x.s.meta.eventCancelled ||
      x.s.startedAt || ['completed','archived'].includes(x.s.archiveStatus) ||
      ['completed','archived'].includes(t.archiveStatus) || ['completed','archived'].includes(p.archiveStatus) ||
      t.tournamentPhase !== 'waiting' || ['live','settling','done','cancelled'].includes(p.tournamentPhase)) throw Error('tournament-started');
  return x;
}

function increment(value) {
  const n = value ?? 0;
  if (!Number.isSafeInteger(n) || n < 0 || n >= Number.MAX_SAFE_INTEGER) throw Error('registration-state-conflict');
  return n + 1;
}

// This creates patches only. The caller must read t/p/all bounded rows and apply
// the registration change and BOTH patches in its original transaction. It does
// not change the caller's authorization, cancellation deadline or penalty policy.
function projectManagedMutation(x, registrations, state, {uid, now, type, changedId}) {
  const cfg = {...x.cfg, revision:increment(x.revision), updatedAt:now, updatedBy:uid};
  if (cfg.activeLock?.registrationIds?.includes(changedId)) {
    cfg.activeLock = {...cfg.activeLock, invalidation:cfg.activeLock.invalidation || {
      reason:'selected-participant-changed', registrationId:changedId, at:now, by:uid
    }};
  }
  const registrationRosterRevision = increment(Math.max(x.s.registrationRosterRevision || 0,
    parseState(x.pub.bracketView, 'invalid-public-view').registrationRosterRevision || 0));
  const runtimeRevision = increment(x.t.onsiteWaitlistRuntimeRevision);
  state = {...state, meta:{...state.meta, registrationStatus:'closed', registrationAutoFillEnabled:false,
    registrationOnsiteWaitlistEnabled:cfg.enabled === true}, onsiteWaitlistServerOwned:true,
    onsiteWaitlistDrawRevision:cfg.revision, onsiteWaitlistDrawStatus:cfg.status,
    onsiteWaitlistRuntimeRevision:runtimeRevision, registrationRosterRevision, updatedAt:now};
  const view = parseState(x.pub.bracketView, 'invalid-public-view');
  view.players = state.players.map(player => ({id:player.id, name:player.name || '', checkedIn:player.checkedIn === true}));
  view.meta = {...view.meta, registrationStatus:'closed', registrationAutoFillEnabled:false};
  view.onsiteWaitlistServerOwned = true;
  if (state.onsiteWaitlistFinalized !== undefined) view.onsiteWaitlistFinalized = state.onsiteWaitlistFinalized;
  view.registrationRosterRevision = registrationRosterRevision;
  view.onsiteWaitlistRuntimeRevision = runtimeRevision;
  view.onsiteWaitlistDrawStatus = cfg.status;
  view.updatedAt = now;
  const common = {onsiteWaitlistServerOwned:true, onsiteWaitlistDrawEnabled:cfg.enabled === true,
    onsiteWaitlistRuntimeRevision:runtimeRevision, registrationStatus:'closed', registrationAutoFillEnabled:false,
    confirmedCount:registrations.filter(row => row.status === 'confirmed').length,
    waitlistCount:registrations.filter(row => row.status === 'waitlist').length, updatedAt:now};
  if (x.t.communityQuickRegistration === true) {
    const localCount = state.players.filter(player => !registrations.some(row => matchesPlayer(player, row))).length;
    common.communityParticipantCount = common.confirmedCount + localCount;
    state.communityParticipantCount = common.communityParticipantCount;
    view.communityParticipantCount = common.communityParticipantCount;
  }
  const privatePatch = {...common, onsiteWaitlistDraw:cfg, data:JSON.stringify(state),
    lastRegistrationMutationType:type, lastRegistrationMutationUid:changedId, lastRegistrationMutationBy:uid};
  const publicPatch = {...common, bracketView:JSON.stringify(view)};
  const next = {tournament:{...x.t,...privatePatch}, publicTournament:{...x.pub,...publicPatch}, registrations};
  const validated = inspect(next);
  if (validated.rows.length > MAX_REGISTRATIONS) throw Error('transaction-size-limit');
  for (const document of [next.tournament, next.publicTournament]) {
    if (Buffer.byteLength(JSON.stringify(document)) > SAFE_DOCUMENT_BYTES) throw Error('document-size-limit');
  }
  return {private:privatePatch, public:publicPatch};
}

function projectManagedCancellation(t, p, registrations, id, options) {
  const x = managedContext(t, p, registrations);
  const row = registrations.find(r => r.registrationId === id);
  if (!row || !['confirmed','waitlist'].includes(row.status)) throw Error('nothing-to-cancel');
  const next = registrations.map(r => r.registrationId === id ? {...r, status:'cancelled'} : r);
  const state = {...x.s, players:x.s.players.filter(player => !matchesPlayer(player, row)),
    waitlistPlayers:x.s.waitlistPlayers.filter(player => !matchesPlayer(player, row))};
  return projectManagedMutation(x, next, state, {...options, type:options.mutationType || 'onsite_waitlist_self_cancel', changedId:id});
}

// Used only by the existing manager-authorized companion cancellation route.
// Finalization returns normal roster editing, but not online admission or draws.
// The caller must retain its original actor, deadline and bracket checks.
function projectManagedLocalCancellation(t, p, registrations, localId, options) {
  const x = managedContext(t, p, registrations);
  if (t.onsiteWaitlistFinalized !== true || p.onsiteWaitlistFinalized !== true ||
      x.s.onsiteWaitlistFinalized !== true || x.cfg.status !== 'closed') throw Error('onsite-waitlist-not-finalized');
  if (typeof localId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(localId)) throw Error('invalid-participant');
  const row = x.rows.find(r => r.localId === localId && r.registrationId === 'local:' + localId);
  if (!row || !['confirmed','waitlist'].includes(row.status)) throw Error('not-local-player');
  const state = {...x.s, players:x.s.players.filter(player => !matchesPlayer(player, row)),
    waitlistPlayers:x.s.waitlistPlayers.filter(player => !matchesPlayer(player, row))};
  return projectManagedMutation(x, registrations, state, {...options,
    type:options.mutationType || 'onsite_waitlist_staff_cancel_local', changedId:row.registrationId});
}

function assertManagedAdmissionOpen(t, p, state = runtime(t)) {
  if (!onsiteWaitlistOwned(t, p, state)) return false;
  if (t.onsiteWaitlistDraw?.enabled !== true || t.onsiteWaitlistDraw.status !== 'open' ||
      p.onsiteWaitlistDraw?.status === 'closed' || state.onsiteWaitlistDrawStatus === 'closed') throw Error('onsite-waitlist-closed');
  return true;
}

function projectManagedInvitation(t, p, registrations, row, options) {
  assertManagedAdmissionOpen(t, p);
  const x = managedContext(t, p, registrations);
  if (row.status !== 'waitlist') throw Error('onsite-waitlist-must-wait');
  const previous = registrations.find(r => r.registrationId === row.registrationId);
  if (previous && previous.status !== 'cancelled') throw Error('already-registered');
  if (!previous && x.rows.length >= MAX_REGISTRATIONS) throw Error('transaction-size-limit');
  const next = registrations.filter(r => r.registrationId !== row.registrationId).concat(row);
  const ids = new Set([...x.s.players,...x.s.waitlistPlayers].map(player => player.id));
  const id = 'ow_' + createHash('sha256').update(JSON.stringify([options.code,row.registrationId])).digest('hex').slice(0,32);
  if (ids.has(id)) throw Error('duplicate-participant');
  const player = {id, name:row.displayName || row.realName, registrationId:row.registrationId,
    registrationUid:row.registrationId, source:'online', checkedIn:false, waitlistedAt:options.now};
  const state = {...x.s, waitlistPlayers:[...x.s.waitlistPlayers, player]};
  return projectManagedMutation(x, next, state, {...options, type:'onsite_waitlist_invitation', changedId:row.registrationId});
}

module.exports = {onsiteWaitlistOwned, assertLegacyRosterWritable, runtime, autoPromotionBlocked,
  readManagedRows, projectManagedCancellation, projectManagedLocalCancellation, assertManagedAdmissionOpen, projectManagedInvitation};
