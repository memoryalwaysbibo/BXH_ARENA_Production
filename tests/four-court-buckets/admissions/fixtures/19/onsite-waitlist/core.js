'use strict';

const {createHash, randomInt: cryptoRandomInt} = require('node:crypto');

const MAX_REGISTRATIONS = 400; // 400 row writes + tournament/public/round/operation < Firestore's 500 writes.
const SAFE_DOCUMENT_BYTES = 850 * 1024;
const ACTIONS = new Set(['preview', 'configure', 'setEligibility', 'lock', 'unlock', 'draw', 'freeze', 'unfreeze', 'withdraw', 'replace', 'close', 'addOnsite', 'increaseCapacity', 'checkIn', 'finalize']);
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const PARTICIPANT_ID = /^(?:local:)?[A-Za-z0-9_-]{1,128}$/;
const OP_ID = /^[A-Za-z0-9_-]{8,100}$/;
const sha256 = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Firestore may return map keys in a different order after a restart. Stored
// pool fingerprints must compare semantic content, not map insertion order.
const stableHash = value => createHash('sha256').update(JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item) ?
    Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item)).digest('hex');

class DrawError extends Error {
  constructor(code, status = 409, details = {}) {
    super(code);
    this.name = 'DrawError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
const fail = (code, status, details) => { throw new DrawError(code, status, details); };
const active = user => user?.active === true && !user.deleted && !['deleted', 'disabled', 'frozen'].includes(user.accountStatus);

// Kept deliberately identical to registration-autofill/roster-service.js manager.
// No role, staff assignment, or owner information is trusted from the request body.
function canManage(user, uid, tournament, state) {
  if (!active(user) || user.isTestAccount === true) return false;
  if (['super_admin', 'admin'].includes(user.role)) return true;
  if (user.role === 'player' && (tournament.eventAuthority || state.meta?.eventAuthority) === 'community' &&
      (tournament.ownerUid === uid || state.ownerUid === uid || tournament.createdBy === uid)) return true;
  const assignments = [...(tournament.assignedStaffUids || []), ...(state.meta?.assignedStaffUids || [])];
  return ['staff', 'partner_organizer'].includes(user.role) &&
    (assignments.includes(uid) || [tournament.ownerUid, tournament.createdBy, state.meta?.ownerUid, state.meta?.createdBy].includes(uid));
}

function parseState(value, name = 'corrupt-state') {
  let result;
  try { result = typeof value === 'string' ? JSON.parse(value) : value; } catch { fail(name); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) fail(name);
  return {...result, meta: {...(result.meta || {})}, players: [...(result.players || [])], waitlistPlayers: [...(result.waitlistPlayers || [])]};
}

function assertMutable(t, p, s, {allowPendingBracket = false} = {}) {
  if (t.systemClosed || p.systemClosed || t.eventCancelled || p.eventCancelled || s.meta.eventCancelled ||
      s.startedAt || !allowPendingBracket && (s.bracketSize || (s.matches || []).length) ||
      ['completed', 'archived'].includes(s.archiveStatus) || ['completed', 'archived'].includes(t.archiveStatus) ||
      ['completed', 'archived'].includes(p.archiveStatus) ||
      ['live', 'settling', 'done', 'cancelled'].includes(t.tournamentPhase) ||
      ['live', 'settling', 'done', 'cancelled'].includes(p.tournamentPhase)) fail('bracket-locked');
  if (t.registrationSelection || p.registrationSelection || s.entrySelection?.mode === 'registration') fail('selection-managed');
  if ((t.battleMode || s.meta.battleMode) === 'team') fail('team-roster-managed');
}

function normalizeRequest(req) {
  const uid = req?.auth?.uid;
  if (typeof uid !== 'string' || !uid) fail('auth-required', 401);
  const data = req?.data || {};
  const code = String(data.code || '').trim().toUpperCase();
  if (!/^BXH-[A-Z0-9]{4,16}$/.test(code) || !ACTIONS.has(data.action)) fail('invalid-operation', 400);
  const common = ['code', 'action', 'operationId', 'expectedRevision'];
  const extras = {preview: [], configure: ['enabled'], setEligibility: ['registrationIds', 'eligible'],
    lock: ['registrationIds', 'slots'], unlock: ['lockId'], draw: ['lockId', 'slots', 'candidateHash'],
    freeze: ['registrationId'], unfreeze: ['registrationId'],
    withdraw: ['registrationId'], replace: ['withdrawalId', 'mode', 'registrationId'],
    close: ['candidateHash'], addOnsite: ['name', 'participantId', 'onsiteEligible'], increaseCapacity: ['capacity'], checkIn: ['playerId', 'checkedIn'], finalize: ['candidateHash']};
  if (Object.keys(data).some(key => ![...common, ...extras[data.action]].includes(key))) fail('invalid-operation', 400);
  const d = {code, action: data.action};
  if (d.action !== 'preview') {
    if (!OP_ID.test(data.operationId || '') || !Number.isSafeInteger(data.expectedRevision) || data.expectedRevision < 0) fail('invalid-operation', 400);
    d.operationId = data.operationId;
    d.expectedRevision = data.expectedRevision;
  }
  if (d.action === 'configure') {
    if (typeof data.enabled !== 'boolean') fail('invalid-operation', 400);
    d.enabled = data.enabled;
  }
  if (['setEligibility', 'lock'].includes(d.action)) {
    if (!Array.isArray(data.registrationIds) || !data.registrationIds.length ||
        data.registrationIds.length > MAX_REGISTRATIONS || data.registrationIds.some(id => typeof id !== 'string' || !PARTICIPANT_ID.test(id)) ||
        new Set(data.registrationIds).size !== data.registrationIds.length) fail('invalid-participants', 400);
    d.registrationIds = [...data.registrationIds].sort();
    if (d.action === 'setEligibility') {
      if (typeof data.eligible !== 'boolean') fail('invalid-participants', 400);
      d.eligible = data.eligible;
    }
  }
  if (d.action === 'addOnsite') {
    if (typeof data.name !== 'string' || !data.name.trim() || data.name.length > 100 ||
        typeof data.participantId !== 'string' || !ID.test(data.participantId) || typeof data.onsiteEligible !== 'boolean') fail('invalid-participant', 400);
    d.name = data.name.trim(); d.participantId = data.participantId; d.onsiteEligible = data.onsiteEligible;
  }
  if (d.action === 'checkIn') {
    if (typeof data.playerId !== 'string' || !ID.test(data.playerId) || typeof data.checkedIn !== 'boolean') fail('invalid-participant', 400);
    d.playerId = data.playerId; d.checkedIn = data.checkedIn;
  }
  if (d.action === 'increaseCapacity') {
    if (!Number.isSafeInteger(data.capacity) || data.capacity < 1 || data.capacity > 512) fail('invalid-capacity', 400);
    d.capacity = data.capacity;
  }
  if (['withdraw', 'freeze', 'unfreeze'].includes(d.action) || d.action === 'replace' && data.mode === 'manual') {
    if (typeof data.registrationId !== 'string' || !PARTICIPANT_ID.test(data.registrationId)) fail('invalid-participant', 400);
    d.registrationId = data.registrationId;
  }
  if (d.action === 'replace') {
    if (typeof data.withdrawalId !== 'string' || !ID.test(data.withdrawalId) || !['random', 'manual'].includes(data.mode) ||
        data.mode === 'random' && data.registrationId !== undefined) fail('invalid-operation', 400);
    d.withdrawalId = data.withdrawalId;
    d.mode = data.mode;
  }
  if (d.action === 'lock' || d.action === 'draw' && data.slots !== undefined) {
    if (!Number.isSafeInteger(data.slots) || data.slots < 1 || data.slots > MAX_REGISTRATIONS) fail('invalid-slot-count', 400);
    d.slots = data.slots;
  }
  if (d.action === 'unlock' || d.action === 'draw' && data.lockId !== undefined) {
    // A missing legacy draw lock is checked after immutable operation replay.
    // This preserves recovery of an already committed pre-upgrade draw only.
    if (typeof data.lockId !== 'string' || !ID.test(data.lockId)) fail('lock-required', 400);
    d.lockId = data.lockId;
  }
  if (['close', 'finalize'].includes(d.action) || d.action === 'draw' && data.candidateHash !== undefined) {
    if (!/^[a-f0-9]{64}$/.test(data.candidateHash || '')) fail('snapshot-required', 400);
    d.candidateHash = data.candidateHash;
  }
  return {uid, data: d};
}

function matchesPlayer(player, row) {
  if (row.localId) return !player.registrationId && player.source !== 'online' && String(player.id) === row.localId;
  if (player.registrationId) return String(player.registrationId) === row.registrationId;
  if (row.familyPlayerId) return String(player.familyPlayerId || '') === String(row.familyPlayerId) &&
    (!player.guardianUid || !row.guardianUid || String(player.guardianUid) === String(row.guardianUid));
  if (player.familyPlayerId) return false;
  return String(player.registrationUid || player.uid || player.playerUid || '') === String(row.uid || row.registrationId);
}

function participant(row, state) {
  const player = [...state.players, ...state.waitlistPlayers].find(p => matchesPlayer(p, row));
  // A child's participant identity is never substituted by their guardian's account UID.
  const child = row.familyPlayerId ? String(row.familyPlayerId) : null;
  const result = {
    registrationId: row.registrationId,
    participantId: child || String(row.participantId || row.uid || row.registrationId),
    localId: row.localId || null,
    playerId: String(player?.id || (child ? 'family_' + child : 'reg_' + row.registrationId)),
    name: String(row.displayName || row.publicName || row.participantName || row.realName || player?.name || '未命名選手'),
    status: row.status,
    frozen: row.onsiteWaitlistFreeze?.frozen === true,
    onsiteEligible: row.onsiteWaitlistEligibility?.eligible === true,
    checkedIn: player?.checkedIn === true,
    familyPlayerId: child,
    guardianUid: row.guardianUid || null,
    closureReason: row.closureReason || null,
  };
  return result;
}

function inspect(aggregate) {
  const t = aggregate.tournament, pub = aggregate.publicTournament;
  if (!t || !pub) fail('not-found', 404);
  const s = parseState(t.data);
  if (t.onsiteWaitlistServerOwned === true && (pub.onsiteWaitlistServerOwned !== true || s.onsiteWaitlistServerOwned !== true || !Number.isSafeInteger(t.onsiteWaitlistRuntimeRevision) || t.onsiteWaitlistRuntimeRevision < 1 || pub.onsiteWaitlistRuntimeRevision !== t.onsiteWaitlistRuntimeRevision || s.onsiteWaitlistRuntimeRevision !== t.onsiteWaitlistRuntimeRevision)) fail('registration-state-conflict');
  if (pub.onsiteWaitlistServerOwned === true && t.onsiteWaitlistServerOwned !== true || pub.onsiteWaitlistFinalized === true && t.onsiteWaitlistFinalized !== true) fail('registration-state-conflict');
  const registrations = aggregate.registrations || [];
  if (!Array.isArray(registrations) || registrations.some(r => !ID.test(r.registrationId || '')) || new Set(registrations.map(r => r.registrationId)).size !== registrations.length) fail('registration-state-conflict');
  const cfg = t.onsiteWaitlistDraw || {};
  if (t.onsiteWaitlistDrawEnabled !== undefined && t.onsiteWaitlistDrawEnabled !== (cfg.enabled === true) ||
      pub.onsiteWaitlistDrawEnabled !== undefined && pub.onsiteWaitlistDrawEnabled !== (cfg.enabled === true)) fail('registration-state-conflict');
  const revision = cfg.revision ?? 0;
  const roundNumber = cfg.roundNumber ?? 0;
  if (!Number.isSafeInteger(revision) || revision < 0 || !Number.isSafeInteger(roundNumber) || roundNumber < 0) fail('corrupt-state');
  const capacity = t.capacity ?? s.meta.registrationCapacity;
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 512) fail('finite-capacity-required');
  if (pub.capacity != null && pub.capacity !== capacity) fail('registration-state-conflict');
  const confirmed = registrations.filter(r => r.status === 'confirmed');
  const onlineWaitlist = registrations.filter(r => r.status === 'waitlist');
  for (const [key, actual] of [['confirmedCount', confirmed.length], ['waitlistCount', onlineWaitlist.length]]) {
    if (t[key] !== undefined && t[key] !== actual || pub[key] !== undefined && pub[key] !== actual) fail('registration-state-conflict');
  }
  const rosterIds = [...s.players, ...s.waitlistPlayers].map(p => String(p.id));
  if (rosterIds.some(id => !ID.test(id)) || new Set(rosterIds).size !== rosterIds.length) fail('registration-state-conflict');
  const localRows = [];
  const matchedRegistrationIds = new Set();
  for (const [players, defaultStatus] of [[s.players, 'confirmed'], [s.waitlistPlayers, 'waitlist']]) {
    for (const player of players) {
      const matching = registrations.filter(r => matchesPlayer(player, r));
      if (matching.length > 1) fail('duplicate-participant');
      if (matching.length) {
        if (matchedRegistrationIds.has(matching[0].registrationId)) fail('duplicate-participant');
        matchedRegistrationIds.add(matching[0].registrationId);
        if (!player.registrationId && player.source === 'onsite') fail('duplicate-participant');
        if (matching[0].status !== defaultStatus) fail('registration-state-conflict');
        continue;
      }
      if (player.registrationId || player.source === 'online') fail('registration-state-conflict');
      localRows.push({registrationId: 'local:' + player.id, localId: String(player.id),
        uid: player.uid || player.playerUid || player.participantId || String(player.id), participantId: player.participantId || player.uid || player.playerUid || String(player.id),
        familyPlayerId: player.familyPlayerId || null, guardianUid: player.guardianUid || null,
        displayName: player.name || '未命名選手', status: defaultStatus === 'confirmed' ? 'confirmed' : player.status || 'waitlist',
        // Keep absent legacy fields undefined, preserving pre-0.3 lock hashes.
        onsiteWaitlistFreeze: player.onsiteWaitlistFreeze,
        onsiteWaitlistEligibility: player.onsiteWaitlistEligibility || {}, closureReason: player.closureReason || null});
    }
  }
  const rows = [...registrations, ...localRows];
  const identities = rows.filter(r => ['confirmed', 'waitlist'].includes(r.status)).map(r => r.familyPlayerId ? 'child:' + r.familyPlayerId : 'person:' + (r.participantId || r.uid || r.registrationId));
  if (new Set(identities).size !== identities.length) fail('duplicate-participant');
  const acceptedCount = rows.filter(r => r.status === 'confirmed').length;
  if (acceptedCount > capacity) fail('capacity-exceeded');
  const waitlist = rows.filter(r => r.status === 'waitlist');
  const participants = rows.map(row => participant(row, s));
  const eligible = participants.filter(p => p.status === 'waitlist' && !p.frozen && p.onsiteEligible).sort((a, b) => a.registrationId.localeCompare(b.registrationId));
  const candidateHash = sha256({revision, capacity, rosterRevision: s.registrationRosterRevision || 0,
    accepted: participants.filter(p => p.status === 'confirmed').sort((a, b) => a.registrationId.localeCompare(b.registrationId)),
    waiting: participants.filter(p => p.status === 'waitlist').sort((a, b) => a.registrationId.localeCompare(b.registrationId)),
  });
  return {t, pub, s, rows, cfg, revision, roundNumber, capacity, confirmed, onlineWaitlist, waitlist, acceptedCount, participants, eligible, candidateHash};
}

// Only server-derived rows/projections are fingerprinted. Do not include the
// whole roster revision: unrelated arrivals must not expand or invalidate a lock.
function selectedFingerprint(x, id) {
  const row = x.rows.find(r => r.registrationId === id);
  if (!row) return null;
  const player = [...x.s.players, ...x.s.waitlistPlayers].find(p => matchesPlayer(p, row)) || null;
  return stableHash({row, player});
}

function currentLock(x) {
  const lock = x.cfg.activeLock;
  if (lock == null) return null;
  if (lock.version !== 1 || !ID.test(lock.id || '') || !Number.isSafeInteger(lock.slots) || lock.slots < 1 ||
      !Array.isArray(lock.registrationIds) || lock.registrationIds.length < lock.slots ||
      lock.registrationIds.length > MAX_REGISTRATIONS || new Set(lock.registrationIds).size !== lock.registrationIds.length ||
      lock.registrationIds.some(id => typeof id !== 'string' || !PARTICIPANT_ID.test(id)) ||
      !Array.isArray(lock.candidates) || lock.candidates.length !== lock.registrationIds.length ||
      lock.candidates.some((p, i) => p.registrationId !== lock.registrationIds[i]) ||
      !lock.fingerprints || lock.registrationIds.some(id => !/^[a-f0-9]{64}$/.test(lock.fingerprints[id] || '')) ||
      lock.candidateHash !== stableHash({registrationIds: lock.registrationIds, slots: lock.slots, candidates: lock.candidates, fingerprints: lock.fingerprints})) fail('corrupt-lock');
  // Invalidation caused by freezing is durable. Restoring the participant's
  // eligibility cannot revive an already invalidated, staff-reviewed snapshot.
  let invalidReason = lock.invalidation?.reason || null;
  // A completed/consumed lock is never eligible to draw again.
  if (!invalidReason && (x.cfg.enabled !== true || x.cfg.status === 'closed')) invalidReason = 'draw-unavailable';
  for (const id of invalidReason ? [] : lock.registrationIds) {
    const row = x.rows.find(r => r.registrationId === id);
    if (!row || row.status !== 'waitlist') { invalidReason = 'selected-participant-not-waitlist'; break; }
    if (row.onsiteWaitlistFreeze?.frozen === true) { invalidReason = 'selected-participant-frozen'; break; }
    if (selectedFingerprint(x, id) !== lock.fingerprints[id]) { invalidReason = 'selected-participant-changed'; break; }
  }
  if (!invalidReason && lock.slots > x.capacity - x.acceptedCount) invalidReason = 'insufficient-capacity';
  return {...lock, valid: invalidReason === null, status: invalidReason ? 'invalidated' : 'locked', invalidReason};
}

function replacementCandidates(x, round) {
  const original = new Map((round?.snapshot?.candidates || []).map(p => [p.registrationId, p]));
  return (round?.loserIds || []).map(id => x.participants.find(p => p.registrationId === id)).filter(p => {
    const former = original.get(p?.registrationId);
    // A recycled/reassigned ID must never put a different person in this pool.
    return p?.status === 'waitlist' && !p.frozen && former && p.participantId === former.participantId &&
      p.familyPlayerId === former.familyPlayerId && p.guardianUid === former.guardianUid && p.playerId === former.playerId;
  });
}

function sameParticipant(a, b) {
  return a && b && a.registrationId === b.registrationId && a.participantId === b.participantId &&
    a.familyPlayerId === b.familyPlayerId && a.guardianUid === b.guardianUid && a.playerId === b.playerId;
}

function managedWinnerRound(aggregate, x, row) {
  const player = [...x.s.players, ...x.s.waitlistPlayers].find(p => matchesPlayer(p, row));
  const roundId = row.onsiteDrawRoundId || player?.onsiteDrawRoundId;
  const operationId = row.onsiteDrawOperationId || player?.onsiteDrawOperationId;
  if (!roundId || !operationId) return null;
  const round = (aggregate.rounds || []).find(r => r.id === roundId);
  if (!round) return null;
  const current = x.participants.find(p => p.registrationId === row.registrationId);
  if (round.operationId === operationId && round.winnerIds.includes(row.registrationId) &&
      sameParticipant(current, round.snapshot?.candidates.find(p => p.registrationId === row.registrationId))) return round;
  if ((aggregate.replacements || []).some(r => r.roundId === roundId && r.operationId === operationId &&
      r.registrationId === row.registrationId && sameParticipant(current, r.participant))) return round;
  return null;
}

function pendingReplacements(aggregate, x) {
  const filled = new Set((aggregate.replacements || []).map(r => r.withdrawalId));
  return (aggregate.withdrawals || []).filter(w => w.wasWinner && !filled.has(w.id)).map(w => {
    const round = (aggregate.rounds || []).find(r => r.id === w.roundId);
    const candidates = replacementCandidates(x, round);
    const candidateIds = new Set(candidates.map(p => p.registrationId));
    return {withdrawalId: w.id, roundId: w.roundId, originalRoundId: w.roundId, registrationId: w.registrationId,
      withdrawnParticipant: w.participant, createdAt: w.createdAt, eligibleRandomIds: [...candidateIds],
      eligibleRandomCount: candidates.length, eligibleRandomCandidates: candidates,
      canReplace: x.cfg.status !== 'closed' && x.cfg.enabled === true && x.capacity > x.acceptedCount,
      replacementBlockedReason: x.cfg.status === 'closed' ? 'rounds-closed' : x.cfg.enabled !== true ?
        'event-feature-disabled' : x.capacity <= x.acceptedCount ? 'insufficient-capacity' : null,
      manualCandidates: x.participants.filter(p => p.status === 'waitlist' && !p.frozen).map(p => ({...p,
        source: candidateIds.has(p.registrationId) ? 'same_round_nonwinner' : 'current_waitlist'}))};
  });
}

function publicState(aggregate) {
  if (aggregate.tournament?.onsiteWaitlistFinalized === true) {
    const t = aggregate.tournament, finalization = t.onsiteWaitlistDraw?.finalization;
    const current = parseState(t.data);
    if (aggregate.publicTournament?.onsiteWaitlistFinalized !== true || current.onsiteWaitlistFinalized !== true) fail('registration-state-conflict');
    if (finalization?.version !== 1 || !finalization.snapshot) fail('corrupt-finalization');
    return {...finalization.snapshot, finalized: true, snapshotIsHistorical: true, serverOwned: true,
      runtimeRevision: Number(t.onsiteWaitlistRuntimeRevision || 0), rounds: aggregate.rounds || [],
      withdrawals: aggregate.withdrawals || [], replacements: aggregate.replacements || [], pendingReplacements: [], lock: null};
  }
  const x = inspect(aggregate);
  return {
    revision: x.revision,
    serverOwned: x.t.onsiteWaitlistServerOwned === true,
    finalized: false,
    runtimeRevision: Number(x.t.onsiteWaitlistRuntimeRevision || 0),
    enabled: x.cfg.enabled === true,
    status: x.cfg.status === 'closed' ? 'closed' : 'open',
    capacity: x.capacity,
    acceptedCount: x.acceptedCount,
    availableSlots: x.capacity - x.acceptedCount,
    eligibleCount: x.eligible.length,
    waitlistCount: x.waitlist.length,
    frozenCount: x.participants.filter(p => p.status === 'waitlist' && p.frozen).length,
    drawableCount: x.participants.filter(p => p.status === 'waitlist' && !p.frozen).length,
    participants: x.participants,
    rounds: aggregate.rounds || [],
    withdrawals: aggregate.withdrawals || [],
    replacements: aggregate.replacements || [],
    pendingReplacements: pendingReplacements(aggregate, x),
    workflow: 'locked_pool_v1',
    lock: currentLock(x),
    candidateHash: x.candidateHash,
  };
}

function choose(candidates, slots, rand = cryptoRandomInt) {
  const pool = candidates.slice();
  for (let i = 0; i < slots; i++) {
    const j = rand(i, pool.length);
    if (!Number.isSafeInteger(j) || j < i || j >= pool.length) fail('invalid-server-randomness', 500);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, slots);
}

function appendWinner(s, row) {
  const old = s.waitlistPlayers.find(p => matchesPlayer(p, row));
  const p = participant(row, s);
  if (s.players.some(player => String(player.id) === p.playerId)) fail('registration-state-conflict');
  const player = {...(old || {}), id: p.playerId, name: p.name, source: row.localId ? (old?.source || 'onsite') : 'online', checkedIn: false};
  if (!row.localId) Object.assign(player, {registrationId: row.registrationId, registrationUid: row.guardianUid || row.uid || row.registrationId});
  if (row.familyPlayerId) Object.assign(player, {familyPlayerId: row.familyPlayerId, participantId: row.familyPlayerId, guardianUid: row.guardianUid || null});
  delete player.status;
  delete player.waitRank;
  delete player.waitlistedAt;
  s.players.push(player);
  s.waitlistPlayers = s.waitlistPlayers.filter(p => !matchesPlayer(p, row));
}

function applyCommit(aggregate, commit) {
  if (!commit) return aggregate;
  const patches = new Map(commit.registrationChanges.map(change => [change.registrationId, change.patch]));
  return {
    ...aggregate,
    tournament: {...aggregate.tournament, ...commit.tournamentPatch},
    publicTournament: {...aggregate.publicTournament, ...commit.publicPatch},
    registrations: aggregate.registrations.map(row => patches.has(row.registrationId) ? {...row, ...patches.get(row.registrationId)} : row),
    rounds: commit.round ? [...(aggregate.rounds || []), commit.round] : aggregate.rounds || [],
    withdrawals: commit.withdrawal ? [...(aggregate.withdrawals || []), commit.withdrawal] : aggregate.withdrawals || [],
    replacements: commit.replacement ? [...(aggregate.replacements || []), commit.replacement] : aggregate.replacements || [],
    operations: {...(aggregate.operations || {}), [commit.operation.id]: commit.operation},
  };
}

// Pure transition apart from injected server clock/randomness. A store MUST invoke
// it inside one serializable transaction. Never run this module in a browser.
function transition(aggregate, request, {now = Date.now(), randomInt = cryptoRandomInt} = {}) {
  const {uid, data: d} = request;
  // The normal manager runtime may legitimately change after explicit handoff.
  // Historical draw inspection must not re-interpret that runtime as its frozen
  // finalization snapshot. Current authorization is still rechecked on replay.
  if (aggregate.tournament?.onsiteWaitlistFinalized === true) {
    if (!active(aggregate.user)) fail('auth-required', 401);
    if (!canManage(aggregate.user, uid, aggregate.tournament, parseState(aggregate.tournament.data))) fail('permission-denied', 403);
    const state = publicState(aggregate);
    if (d.action === 'preview') return {result: {ok: true, state, canonicalState: parseState(aggregate.tournament.data), candidateHash: state.candidateHash}};
    const previous = aggregate.operations?.[d.operationId];
    if (previous) {
      if (previous.actorUid !== uid || previous.requestHash !== sha256(d)) fail('operation-conflict');
      return {result: {...previous.result, state, canonicalState: parseState(aggregate.tournament.data), candidateHash: state.candidateHash, replayed: true}};
    }
    fail('draw-session-finalized');
  }
  const x = inspect(aggregate);
  if (!active(aggregate.user)) fail('auth-required', 401);
  if (!canManage(aggregate.user, uid, x.t, x.s)) fail('permission-denied', 403);
  if (d.action === 'preview') return {result: {ok: true, state: publicState(aggregate), candidateHash: x.candidateHash}};
  const requestHash = sha256(d);
  const prior = aggregate.operations?.[d.operationId];
  if (prior) {
    if (prior.actorUid !== uid || prior.requestHash !== requestHash) fail('operation-conflict');
    return {result: {...prior.result, state: publicState(aggregate), candidateHash: x.candidateHash, replayed: true}};
  }
  if (d.action === 'draw' && !d.lockId) fail('lock-required', 400);
  if (d.expectedRevision !== x.revision) fail('stale-revision', 409, {currentRevision: x.revision});
  assertMutable(x.t, x.pub, x.s, {allowPendingBracket: d.action === 'checkIn'});
  if (d.action === 'checkIn' && x.s.meta.checkinClosedEarly === true) fail('checkin-closed');
  if (x.rows.length > MAX_REGISTRATIONS) fail('transaction-size-limit', 409, {limit: MAX_REGISTRATIONS});
  // A late withdrawal can release a draw-managed winner even after waitlist
  // closure. It never reopens the session or authorizes another replacement.
  if (x.cfg.status === 'closed' && !['withdraw', 'checkIn', 'finalize'].includes(d.action)) fail('rounds-closed');
  if (d.action !== 'configure' && x.cfg.enabled !== true) fail('event-feature-disabled', 403);
  if (['close', 'finalize'].includes(d.action) && d.candidateHash !== x.candidateHash) fail('candidate-list-changed');
  if (d.action === 'finalize' || d.action === 'configure' && d.enabled) {
    // Never hand off a bracket roster that silently omits an already accepted
    // registration. The existing canonical roster sync must finish first.
    if (x.confirmed.some(row => !x.s.players.some(player => matchesPlayer(player, row)))) fail('accepted-roster-incomplete');
  }
  const activeLock = currentLock(x);
  const revision = x.revision + 1;
  if (!Number.isSafeInteger(revision)) fail('revision-exhausted');
  const cfg = {...x.cfg, enabled: x.cfg.enabled === true, status: x.cfg.status === 'closed' ? 'closed' : 'open', revision,
    roundNumber: x.roundNumber, updatedAt: now, updatedBy: uid};
  const changes = [];
  let round = null;
  let withdrawal = null;
  let replacement = null;
  const result = {ok: true, action: d.action, committedRevision: revision, operationId: d.operationId};
  if (d.action === 'finalize') {
    if (x.cfg.status !== 'closed') fail('waitlist-close-required');
    if (activeLock) fail('lock-active');
    if (x.waitlist.length) fail('active-waitlist-present');
    const snapshot = publicState(aggregate);
    for (const key of ['rounds', 'withdrawals', 'replacements', 'pendingReplacements']) delete snapshot[key];
    Object.assign(snapshot, {revision, finalized: true, snapshotIsHistorical: true, serverOwned: true, lock: null});
    cfg.finalization = {version: 1, finalizedAt: now, finalizedBy: uid, operationId: d.operationId,
      acceptedRosterHash: stableHash(x.s.players), registrationHash: stableHash(aggregate.registrations), snapshot};
    result.finalized = true;
    // Subcollection history survives a later ordinary parent-room deletion.
    // Retain the complete reviewed finalization in this create-only audit too.
    result.finalization = cfg.finalization;
  }
  if (d.action === 'configure') {
    // The normal-mode promotion paths are outside this isolated trial. Keep
    // their global suppression active until frozen waitlist entries are resolved.
    if (!d.enabled && x.waitlist.some(row => row.onsiteWaitlistFreeze?.frozen === true)) fail('frozen-participants-present');
    if (!d.enabled && x.roundNumber > 0) fail('disable-after-draw-forbidden');
    if (!d.enabled && activeLock) fail('lock-active');
    if (!d.enabled && (x.t.onsiteWaitlistServerOwned === true || x.cfg.enabled === true)) fail('server-ownership-permanent');
    cfg.enabled = d.enabled;
  }
  if (d.action === 'checkIn') {
    const player = x.s.players.find(p => p.id === d.playerId);
    const accepted = x.participants.find(p => p.playerId === d.playerId && p.status === 'confirmed');
    if (!player || !accepted) fail('accepted-player-required');
    // A server-verified accepted identity is the only target. This never promotes a waitlist entry.
    x.s.players = x.s.players.map(p => p.id === d.playerId ? {...p, checkedIn: d.checkedIn} : p);
    Object.assign(result, {playerId: d.playerId, checkedIn: d.checkedIn});
  }
  if (d.action === 'lock') {
    if (activeLock) fail('lock-active');
    if (d.slots > x.capacity - x.acceptedCount) fail('insufficient-capacity');
    if (d.slots > d.registrationIds.length) fail('insufficient-selected-participants');
    const candidates = d.registrationIds.map(id => {
      const p = x.participants.find(p => p.registrationId === id);
      if (!p) fail('participant-not-found', 404);
      if (p.status !== 'waitlist') fail('not-waitlist');
      if (p.frozen) fail('participant-frozen', 409, {registrationId: id});
      return p;
    });
    const fingerprints = Object.fromEntries(d.registrationIds.map(id => [id, selectedFingerprint(x, id)]));
    const lock = {
      version: 1, id: 'lock_' + sha256({code: d.code, operationId: d.operationId}).slice(0, 32),
      operationId: d.operationId, registrationIds: d.registrationIds, slots: d.slots,
      candidates, fingerprints, lockedBy: uid, lockedAt: now, revision,
      capacity: x.capacity, acceptedCount: x.acceptedCount, availableSlots: x.capacity - x.acceptedCount,
      candidateHash: stableHash({registrationIds: d.registrationIds, slots: d.slots, candidates, fingerprints}),
    };
    cfg.workflow = 'locked_pool_v1';
    cfg.activeLock = lock;
    result.lockId = lock.id;
    result.lock = {...lock, valid: true, status: 'locked', invalidReason: null};
  }
  if (['unlock', 'draw'].includes(d.action)) {
    if (!activeLock || activeLock.id !== d.lockId) {
      if ((aggregate.rounds || []).some(r => r.lockId === d.lockId)) fail('lock-consumed');
      fail(activeLock ? 'lock-mismatch' : 'lock-required');
    }
    if (d.action === 'unlock') {
      cfg.activeLock = null;
      // The original lock remains in this immutable operation and its creation
      // operation, including the exact snapshot reviewed by the staff member.
      result.lockId = activeLock.id;
      result.unlockedLock = activeLock;
    }
  }
  if (d.action === 'addOnsite') {
    if (x.rows.length >= MAX_REGISTRATIONS) fail('transaction-size-limit', 409, {limit: MAX_REGISTRATIONS});
    if (x.rows.some(row => String(row.participantId || row.familyPlayerId || row.uid || row.localId || row.registrationId) === d.participantId || row.familyPlayerId === d.participantId)) fail('duplicate-participant');
    const localId = 'onsite_' + sha256({code:d.code, operationId:d.operationId}).slice(0, 24);
    x.s.waitlistPlayers.push({id: localId, participantId: d.participantId, name: d.name, source: 'onsite', status: 'waitlist', checkedIn: false,
      onsiteWaitlistEligibility: {eligible: d.onsiteEligible, markedAt: now, markedBy: uid}, createdAt: now});
    result.registrationId = 'local:' + localId; result.status = 'waitlist';
  }
  if (d.action === 'increaseCapacity') {
    if (d.capacity <= x.capacity) fail('capacity-increase-required');
    x.s.meta.registrationCapacity = d.capacity;
    result.capacity = d.capacity;
  }
  if (d.action === 'setEligibility') {
    if (activeLock && d.registrationIds.some(id => activeLock.registrationIds.includes(id))) fail('lock-active');
    for (const id of d.registrationIds) {
      const row = x.rows.find(r => r.registrationId === id);
      if (!row) fail('participant-not-found', 404);
      if (row.status !== 'waitlist') fail('not-waitlist');
      const patch = {onsiteWaitlistEligibility: {eligible: d.eligible, markedAt: now, markedBy: uid}, updatedAt: now};
      if (row.localId) x.s.waitlistPlayers = x.s.waitlistPlayers.map(p => matchesPlayer(p, row) ? {...p, ...patch} : p);
      else changes.push({registrationId: id, patch});
    }
  }
  if (['freeze', 'unfreeze'].includes(d.action)) {
    const row = x.rows.find(r => r.registrationId === d.registrationId);
    if (!row) fail('participant-not-found', 404);
    if (row.status !== 'waitlist') fail('not-waitlist');
    const frozen = d.action === 'freeze';
    const previousFrozen = row.onsiteWaitlistFreeze?.frozen === true;
    const patch = {onsiteWaitlistFreeze: {frozen, updatedAt: now, updatedBy: uid, operationId: d.operationId}, updatedAt: now};
    if (row.localId) x.s.waitlistPlayers = x.s.waitlistPlayers.map(p => matchesPlayer(p, row) ? {...p, ...patch} : p);
    else changes.push({registrationId: row.registrationId, patch});
    let invalidatedLockId = null;
    if (activeLock && activeLock.registrationIds.includes(row.registrationId)) {
      invalidatedLockId = activeLock.id;
      // Even unfreezing an externally frozen selected record must latch the
      // invalidation. Never modify candidates, fingerprints or the locked hash.
      cfg.activeLock = {...x.cfg.activeLock, invalidation: x.cfg.activeLock.invalidation || {
        reason: frozen ? 'selected-participant-frozen' : activeLock.invalidReason || 'selected-participant-changed',
        registrationId: row.registrationId, actorUid: uid, createdAt: now, revision, operationId: d.operationId,
      }};
    }
    const freezeEvent = {action: d.action, operationId: d.operationId, registrationId: row.registrationId,
      participant: x.participants.find(p => p.registrationId === row.registrationId),
      previousFrozen, frozen, actorUid: uid, createdAt: now, revision, invalidatedLockId};
    // Stored in the existing immutable operation document in the same commit
    // as the participant flag and any lock invalidation; never published.
    Object.assign(result, {registrationId: row.registrationId, frozen, freezeEvent});
  }
  if (d.action === 'draw') {
    if (!activeLock.valid) fail('lock-invalidated', 409, {lockId: activeLock.id, reason: activeLock.invalidReason});
    if (d.slots !== undefined && d.slots !== activeLock.slots ||
        d.candidateHash !== undefined && d.candidateHash !== activeLock.candidateHash) fail('lock-payload-mismatch');
    const candidates = activeLock.candidates;
    const winners = choose(candidates, activeLock.slots, randomInt);
    const winnerIds = winners.map(p => p.registrationId);
    const chosen = new Set(winnerIds);
    cfg.roundNumber++;
    const roundId = 'round-' + String(cfg.roundNumber).padStart(6, '0');
    round = {
      id: roundId, number: cfg.roundNumber, operationId: d.operationId, actorUid: uid, createdAt: now,
      slots: activeLock.slots, revision, lockId: activeLock.id, candidateIds: [...activeLock.registrationIds], winnerIds,
      loserIds: candidates.filter(p => !chosen.has(p.registrationId)).map(p => p.registrationId),
      snapshot: {revision: activeLock.revision, candidateHash: activeLock.candidateHash, capacity: activeLock.capacity,
        acceptedCount: activeLock.acceptedCount, availableSlots: activeLock.availableSlots, candidates,
        lockedAt: activeLock.lockedAt, lockedBy: activeLock.lockedBy, lockId: activeLock.id},
      lockedPool: x.cfg.activeLock,
      executionSnapshot: {revision: x.revision, capacity: x.capacity, acceptedCount: x.acceptedCount,
        availableSlots: x.capacity - x.acceptedCount},
      randomness: 'node:crypto.randomInt / partial Fisher-Yates',
      loserPolicy: 'remain_waitlist',
    };
    cfg.lastRoundId = roundId;
    cfg.activeLock = null;
    cfg.lastCompletedLockId = activeLock.id;
    for (const id of winnerIds) {
      const row = x.rows.find(r => r.registrationId === id);
      appendWinner(x.s, row);
      if (row.localId) Object.assign(x.s.players.at(-1), {status: 'confirmed', onsiteDrawRoundId: roundId, onsiteDrawOperationId: d.operationId, promotedAt: now, promotedBy: uid});
      if (!row.localId) changes.push({registrationId: id, patch: {status: 'confirmed', waitRank: null, promotedAt: now, promotedBy: uid,
        onsiteDrawRoundId: roundId, onsiteDrawOperationId: d.operationId, updatedAt: now}});
    }
    result.round = round;
    result.lockId = activeLock.id;
  }
  if (d.action === 'withdraw') {
    const row = x.rows.find(r => r.registrationId === d.registrationId);
    if (!row) fail('participant-not-found', 404);
    if (!['confirmed', 'waitlist'].includes(row.status)) fail('participant-not-active');
    const wasWinner = row.status === 'confirmed';
    const origin = wasWinner ? managedWinnerRound(aggregate, x, row) : null;
    if (wasWinner && !origin) fail('original-accepted-protected');
    const withdrawalId = 'withdraw_' + sha256({code: d.code, operationId: d.operationId}).slice(0, 32);
    const p = x.participants.find(p => p.registrationId === row.registrationId);
    withdrawal = {id: withdrawalId, operationId: d.operationId, registrationId: row.registrationId,
      participant: p, wasWinner, originalStatus: row.status, roundId: origin?.id || null,
      actorUid: uid, createdAt: now, revision, reason: 'explicit_staff_withdrawal'};
    const patch = {status: 'withdrawn', withdrawnAt: now, withdrawnBy: uid,
      onsiteWithdrawalId: withdrawalId, onsiteWithdrawalOperationId: d.operationId, updatedAt: now};
    const former = [...x.s.players, ...x.s.waitlistPlayers].find(p => matchesPlayer(p, row));
    x.s.players = x.s.players.filter(p => !matchesPlayer(p, row));
    if (row.localId) {
      if (wasWinner) x.s.waitlistPlayers.push({...former, ...patch});
      else x.s.waitlistPlayers = x.s.waitlistPlayers.map(p => matchesPlayer(p, row) ? {...p, ...patch} : p);
    } else {
      changes.push({registrationId: row.registrationId, patch});
      x.s.waitlistPlayers = x.s.waitlistPlayers.filter(p => !matchesPlayer(p, row));
    }
    result.withdrawalId = withdrawalId;
    result.roundId = withdrawal.roundId;
    result.withdrawal = withdrawal;
  }
  if (d.action === 'replace') {
    const withdrawn = (aggregate.withdrawals || []).find(w => w.id === d.withdrawalId);
    if (!withdrawn) fail('withdrawal-not-found', 404);
    if (!withdrawn.wasWinner || !withdrawn.roundId) fail('withdrawal-not-replaceable');
    if ((aggregate.replacements || []).some(r => r.withdrawalId === d.withdrawalId)) fail('replacement-already-completed');
    const originalRound = (aggregate.rounds || []).find(r => r.id === withdrawn.roundId);
    if (!originalRound) fail('withdrawal-not-replaceable');
    if (x.capacity - x.acceptedCount < 1) fail('insufficient-capacity');
    let candidates;
    if (d.mode === 'random') {
      candidates = replacementCandidates(x, originalRound);
      if (!candidates.length) fail('no-replacement-candidates');
    } else {
      const chosen = x.participants.find(p => p.registrationId === d.registrationId);
      if (!chosen) fail('participant-not-found', 404);
      if (chosen.status !== 'waitlist') fail('not-waitlist');
      if (chosen.frozen) fail('participant-frozen', 409, {registrationId: chosen.registrationId});
      candidates = [chosen];
    }
    const winner = d.mode === 'random' ? choose(candidates, 1, randomInt)[0] : candidates[0];
    const row = x.rows.find(r => r.registrationId === winner.registrationId);
    const replacementId = 'replace_' + sha256({code: d.code, operationId: d.operationId}).slice(0, 32);
    const sameRoundNonwinner = replacementCandidates(x, originalRound).some(p => p.registrationId === winner.registrationId);
    replacement = {id: replacementId, operationId: d.operationId, withdrawalId: withdrawn.id,
      roundId: originalRound.id, originalRoundId: originalRound.id, mode: d.mode,
      registrationId: winner.registrationId, participant: winner,
      candidateIds: candidates.map(p => p.registrationId), candidates,
      source: sameRoundNonwinner ? 'same_round_nonwinner' : 'current_waitlist',
      actorUid: uid, createdAt: now, revision,
      randomness: d.mode === 'random' ? 'node:crypto.randomInt / partial Fisher-Yates' : null};
    appendWinner(x.s, row);
    const patch = {status: 'confirmed', waitRank: null, promotedAt: now, promotedBy: uid,
      onsiteDrawRoundId: originalRound.id, onsiteDrawOperationId: d.operationId,
      onsiteReplacementId: replacementId, onsiteReplacementWithdrawalId: withdrawn.id, updatedAt: now};
    if (row.localId) Object.assign(x.s.players.at(-1), patch);
    else changes.push({registrationId: row.registrationId, patch});
    result.replacement = replacement;
    result.replacementId = replacementId;
    result.withdrawalId = withdrawn.id;
    result.roundId = originalRound.id;
    result.registrationId = winner.registrationId;
  }
  if (d.action === 'close') {
    if (activeLock) fail('lock-active');
    cfg.status = 'closed';
    cfg.closedAt = now;
    cfg.closedBy = uid;
    for (const row of x.waitlist) {
      const patch = {status: 'not_selected', closureReason: 'system_closed', systemClosedAt: now, systemClosedBy: uid, onsiteDrawOperationId: d.operationId, updatedAt: now};
      if (row.localId) x.s.waitlistPlayers = x.s.waitlistPlayers.map(p => matchesPlayer(p, row) ? {...p, ...patch} : p);
      else changes.push({registrationId: row.registrationId, patch});
    }
    // Keep every history record and keep cancellation fields/penalty ledgers untouched.
    // Online waiting projections are no longer active waiting entries after closure.
    const closing = new Set(x.waitlist.map(r => r.registrationId));
    x.s.waitlistPlayers = x.s.waitlistPlayers.filter(p => !x.waitlist.some(r => !r.localId && closing.has(r.registrationId) && matchesPlayer(p, r)));
    result.closedRegistrationIds = [...closing];
  }
  x.s.onsiteWaitlistDrawRevision = revision;
  x.s.registrationRosterRevision = Number(x.s.registrationRosterRevision || 0) + 1;
  x.s.meta.registrationOnsiteWaitlistEnabled = cfg.enabled;
  x.s.updatedAt = now;
  const statusChanges = new Map(changes.map(c => [c.registrationId, c.patch.status]));
  const statusAfter = row => statusChanges.get(row.registrationId) || row.status;
  const confirmedCount = aggregate.registrations.filter(row => statusAfter(row) === 'confirmed').length;
  const waitlistCount = aggregate.registrations.filter(row => statusAfter(row) === 'waitlist').length;
  const tPatch = {onsiteWaitlistDraw: cfg, onsiteWaitlistDrawEnabled: cfg.enabled, data: JSON.stringify(x.s), confirmedCount, waitlistCount,
    updatedAt: now, lastRegistrationMutationType: 'onsite_waitlist_' + d.action, lastRegistrationMutationBy: uid};
  const view = parseState(x.pub.bracketView, 'invalid-public-view');
  // Minimal public shape: never expose candidate lists, guardian IDs, or arrival flags.
  view.players = x.s.players.map(p => ({id: p.id, name: p.name || '', checkedIn: p.checkedIn === true}));
  view.registrationRosterRevision = x.s.registrationRosterRevision;
  view.updatedAt = now;
  const publicPatch = {onsiteWaitlistDrawEnabled: cfg.enabled, bracketView: JSON.stringify(view), confirmedCount, waitlistCount, updatedAt: now};
  if (d.action === 'finalize') {
    tPatch.onsiteWaitlistFinalized = true; publicPatch.onsiteWaitlistFinalized = true;
    x.s.onsiteWaitlistFinalized = true;
  }
  if (d.action === 'increaseCapacity') {
    tPatch.capacity = d.capacity; publicPatch.capacity = d.capacity;
  }
  if (cfg.enabled || x.t.onsiteWaitlistServerOwned === true) {
    // Permanent server ownership survives waitlist closure and tournament completion.
    tPatch.onsiteWaitlistServerOwned = true; publicPatch.onsiteWaitlistServerOwned = true;
    x.s.onsiteWaitlistServerOwned = true;
    x.s.onsiteWaitlistDrawStatus = cfg.status;
    tPatch.onsiteWaitlistRuntimeRevision = Number(x.t.onsiteWaitlistRuntimeRevision || 0) + 1;
    if (!Number.isSafeInteger(tPatch.onsiteWaitlistRuntimeRevision)) fail('revision-exhausted');
    publicPatch.onsiteWaitlistRuntimeRevision = tPatch.onsiteWaitlistRuntimeRevision;
    x.s.onsiteWaitlistRuntimeRevision = tPatch.onsiteWaitlistRuntimeRevision;
    view.onsiteWaitlistRuntimeRevision = tPatch.onsiteWaitlistRuntimeRevision;
    view.onsiteWaitlistServerOwned = true;
    if (d.action === 'finalize') view.onsiteWaitlistFinalized = true;
    tPatch.registrationAutoFillEnabled = false; publicPatch.registrationAutoFillEnabled = false;
    x.s.meta.registrationAutoFillEnabled = false;
    x.s.meta.registrationStatus = 'closed';
    tPatch.registrationStatus = 'closed'; publicPatch.registrationStatus = 'closed';
    tPatch.data = JSON.stringify(x.s);
    view.meta.registrationStatus = 'closed'; view.meta.registrationAutoFillEnabled = false;
    if (d.action === 'increaseCapacity') view.meta.registrationCapacity = d.capacity;
    publicPatch.bracketView = JSON.stringify(view);
  }
  if (d.action === 'close') {
    tPatch.registrationStatus = 'closed';
    publicPatch.registrationStatus = 'closed';
    x.s.meta.registrationStatus = 'closed';
    tPatch.data = JSON.stringify(x.s);
  } else if (!cfg.enabled && round && ['open', 'full'].includes(x.t.registrationStatus) && x.acceptedCount + round.winnerIds.length >= x.capacity) {
    tPatch.registrationStatus = 'full';
    publicPatch.registrationStatus = 'full';
    x.s.meta.registrationStatus = 'full';
    tPatch.data = JSON.stringify(x.s);
  }
  const operation = {id: d.operationId, actorUid: uid, action: d.action, requestHash, revision, createdAt: now, result};
  const commit = {registrationChanges: changes, tournamentPatch: tPatch, publicPatch, round, withdrawal, replacement, operation};
  for (const document of [{...x.t, ...tPatch}, {...x.pub, ...publicPatch}, round, withdrawal, replacement, operation]) if (document && Buffer.byteLength(JSON.stringify(document)) > SAFE_DOCUMENT_BYTES) fail('document-size-limit');
  const next = applyCommit(aggregate, commit);
  return {commit, result: {...result, state: publicState(next), canonicalState: parseState(next.tournament.data), candidateHash: publicState(next).candidateHash, replayed: false}};
}

function createOnsiteWaitlistService({store, enabled = false, clock = Date.now, randomInt = cryptoRandomInt} = {}) {
  if (!store || typeof store.transact !== 'function') throw new TypeError('A transactional store is required');
  return async req => {
    const request = normalizeRequest(req);
    // Global deployment kill switch, off unless the server explicitly opts in.
    if ((typeof enabled === 'function' ? enabled() : enabled) !== true) fail('feature-disabled', 403);
    return store.transact({code: request.data.code, uid: request.uid, operationId: request.data.operationId}, aggregate =>
      transition(aggregate, request, {now: clock(), randomInt}));
  };
}

module.exports = {createOnsiteWaitlistService, transition, normalizeRequest, inspect, publicState, applyCommit, canManage, matchesPlayer, participant, choose, DrawError, MAX_REGISTRATIONS, parseState, stableHash, SAFE_DOCUMENT_BYTES};
