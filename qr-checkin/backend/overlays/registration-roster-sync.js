'use strict';
const {onDocumentWritten} = require('firebase-functions/v2/firestore');
const {onCall, HttpsError} = require('firebase-functions/v2/https');
const {getFirestore, FieldValue} = require('firebase-admin/firestore');
const {projectRoster, projectTeams, publicPlayers} = require('./registration-roster-core');
const {advance: advanceQrCheckinFence} = require('./qr-checkin-fence.cjs');
const db = getFirestore();
const {onsiteWaitlistOwned, runtime} = require('./onsite-waitlist-writer-guards');

// Off by default. Removing this deployment or setting enabled=false restores
// the current admin-page/manual sync path without changing registrations.
async function reconcileRegistrationRoster(code) {
  const roomRef = db.doc('tournaments/' + code);
  const publicRef = db.doc('publicTournaments/' + code);
  const configRef = db.doc('systemConfig/registrationRosterSync');
  return db.runTransaction(async tx => {
    const [configSnap, roomSnap, publicSnap] = await Promise.all([
      tx.get(configRef), tx.get(roomRef), tx.get(publicRef)
    ]);
    const config = configSnap.data() || {};
    if (config.enabled !== true) return {ok:false,reason:'disabled'};
    if (Array.isArray(config.roomCodes) && !config.roomCodes.includes(code)) return {ok:false,reason:'room-not-allowed'};
    if (!roomSnap.exists || !publicSnap.exists) return {ok:false,reason:'room-missing'};
    const room = roomSnap.data(), pub = publicSnap.data();
    // Shared by trigger and backfill. A delayed event must inspect current docs.
    if (onsiteWaitlistOwned(room, pub, runtime(room))) return {ok:false,reason:'onsite-waitlist-managed'};
    if (room.registrationEnabled !== true || pub.registrationEnabled !== true ||
        pub.registrationRosterSyncBackendEnabled !== true) return {ok:false,reason:'room-disabled'};
    if (room.tournamentPhase !== 'waiting' || room.startedAt ||
        ['live', 'settling', 'done', 'cancelled'].includes(pub.tournamentPhase)) return {ok:false,reason:'started'};
    if (room.registrationSelection || pub.registrationSelection) return {ok:false,reason:'selection-mode'};

    const state = JSON.parse(room.data || '{}');
    // Existing bracket references player IDs; reordering its roster requires
    // the separate pre-start bracket invalidation flow.
    if (state.startedAt || (Array.isArray(state.matches) && state.matches.length)) return {ok:false,reason:'bracket-locked'};
    if (!Array.isArray(state.players)) throw new Error('room-players-missing');
    if (typeof pub.bracketView !== 'string') throw new Error('public-mirror-missing');
    const mirror = JSON.parse(pub.bracketView);
    if (!mirror || typeof mirror !== 'object' || Array.isArray(mirror)) throw new Error('public-mirror-invalid');

    const snap = await tx.get(roomRef.collection('registrations'));
    const rows = snap.docs.map(doc => ({...doc.data(), registrationId: doc.id}));
    const next = projectRoster(state.players, rows, state.meta?.checkinRequired === true);
    const nextTeams = state.meta?.battleMode === 'team' ? projectTeams(rows) : [];
    const visible = publicPlayers(next);
    const publicTeams = nextTeams.map(team=>({id:team.id,name:team.name,memberPlayerIds:team.memberPlayerIds}));
    if (JSON.stringify(state.players) === JSON.stringify(next) &&
        JSON.stringify(state.teams || []) === JSON.stringify(nextTeams) &&
        JSON.stringify(mirror.players || []) === JSON.stringify(visible) &&
        JSON.stringify(mirror.teams || []) === JSON.stringify(publicTeams)) return {ok:true,changed:false,count:visible.length};
    state.players = next;
    state.teams = nextTeams;
    // Every roster mutation invalidates stale whole-state saves from open admin tabs.
    state.registrationRosterRevision = Number(state.registrationRosterRevision || 0) + 1;
    const qrFence = advanceQrCheckinFence(room, state);
    mirror.players = publicPlayers(state.players);
    mirror.teams = publicTeams;
    tx.update(roomRef, {...qrFence, data: JSON.stringify(state), updatedAt: Date.now(),
      registrationRosterSyncAt: FieldValue.serverTimestamp()});
    tx.update(publicRef, {...qrFence, bracketView: JSON.stringify(mirror), updatedAt: Date.now()});
    return {ok:true,changed:true,count:visible.length};
  });
}

exports.syncRegistrationRoster = onDocumentWritten({
  document: 'tournaments/{code}/registrations/{registrationId}',
  region: 'asia-east1', retry: true
}, async event => {
  if (event.data) await reconcileRegistrationRoster(event.params.code);
});

// One-time catch-up for registrations that predate activation. No client can
// invoke this without a live super_admin account and both rollout gates.
exports.backfillRegistrationRoster = onCall({region:'asia-east1',cors:true}, async request => {
  const uid=request.auth?.uid,code=String(request.data?.code||'').trim().toUpperCase();
  if(!uid) throw new HttpsError('unauthenticated','auth-required');
  if(!/^BXH-[A-Z0-9]{4,16}$/.test(code)) throw new HttpsError('invalid-argument','invalid-code');
  const user=await db.doc('users/'+uid).get();
  if(!user.exists || user.data().role!=='super_admin' || user.data().active!==true)
    throw new HttpsError('permission-denied','super-admin-required');
  const result=await reconcileRegistrationRoster(code);
  if(!result?.ok) throw new HttpsError('failed-precondition',result?.reason||'sync-unavailable');
  return {...result,code};
});
