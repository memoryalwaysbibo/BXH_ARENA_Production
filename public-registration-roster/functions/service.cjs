'use strict';
const {projectRoster, publicPlayers} = require('../../qr-checkin/backend/overlays/registration-roster-core');
const {onsiteWaitlistOwned} = require('../../qr-checkin/backend/overlays/onsite-waitlist/owned');
const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
const visible = players => publicPlayers((Array.isArray(players) ? players : []).filter(p => p && p.name));
const count = value => Number.isSafeInteger(value) && value >= 0;
function eligible(t, p, s) {
  return t.visibility === 'public' && p.visibility === 'public' &&
    t.registrationEnabled === true && p.registrationEnabled === true &&
    t.registrationVisibility === 'public' && p.registrationVisibility === 'public' &&
    t.tournamentPhase === 'waiting' && p.tournamentPhase === 'waiting' &&
    !t.eventCancelled && !p.eventCancelled && !t.systemClosed && !p.systemClosed &&
    !t.deletionState && !p.deletionState && !t.startedAt && !s.startedAt &&
    !t.registrationSelection && !p.registrationSelection &&
    !Object.hasOwn(t, 'scoreStorage') && !Object.hasOwn(p, 'scoreStorage') &&
    !onsiteWaitlistOwned(t, p, s) &&
    t.battleMode !== 'team' && s.meta?.battleMode !== 'team' &&
    Array.isArray(s.players) && (!Array.isArray(s.matches) || !s.matches.length);
}
function projection(t, p, registrations) {
  const s = parse(t.data || '{}');
  if (!eligible(t, p, s)) return null;
  if (!count(t.confirmedCount) || !count(t.waitlistCount) ||
      t.confirmedCount !== p.confirmedCount || t.waitlistCount !== p.waitlistCount) throw Error('registration-count-conflict');
  if (!Number.isSafeInteger(p.updatedAt)) throw Error('public-source-version-missing');
  const rows = registrations.filter(r => r.status === 'confirmed' || r.status === 'waitlist').map(r => ({...r}));
  if (rows.filter(r => r.status === 'confirmed').length !== t.confirmedCount ||
      rows.filter(r => r.status === 'waitlist').length !== t.waitlistCount) throw Error('registration-count-conflict');
  // The dedicated team/family identity rules and attendance preservation are shared
  // with the existing roster projector; no registration fields enter the output.
  if (rows.some(r => r.registrationKind === 'team' || r.teamId)) return null;
  for (const row of rows.filter(r => r.status === 'confirmed')) {
    const publicName = String(row.publicName || row.displayName || row.participantName || '').trim();
    if (!publicName) throw Error('registration-public-name-missing');
    row.displayName = publicName;
  }
  const mirror = parse(p.bracketView || p.data || '{}');
  const players = visible(projectRoster(s.players, rows, s.meta?.checkinRequired === true));
  if (new Set(players.map(p => p.id)).size !== players.length) throw Error('duplicate-player-id');
  const out = {version:1, confirmedCount:t.confirmedCount, waitlistCount:t.waitlistCount,
    sourceUpdatedAt:p.updatedAt, sourcePlayers:visible(mirror.players), players};
  if (Buffer.byteLength(JSON.stringify(out), 'utf8') > 300000) throw Error('public-roster-too-large');
  return out;
}
function createSync(db) {
  return async function sync(code) {
    if (!/^BXH-[A-Z0-9]{4,16}$/.test(code)) return {changed:false, reason:'invalid-code'};
    const roomRef = db.doc('tournaments/' + code), pubRef = db.doc('publicTournaments/' + code);
    // Read the private room OUTSIDE the write transaction: acquiring a read lock on
    // it would contend with the registration admission queue. Only the public doc
    // is ever locked/written, and stale source snapshots abort for an event retry.
    const [roomSnap, pubSnap, configSnap] = await Promise.all([
      roomRef.get(), pubRef.get(), db.doc('systemConfig/publicRegistrationRosterSync').get()
    ]);
    const config = configSnap.data() || {};
    if (config.enabled !== true) return {changed:false, reason:'disabled'};
    if (Array.isArray(config.roomCodes) && !config.roomCodes.includes(code)) return {changed:false, reason:'room-not-allowed'};
    if (!roomSnap.exists || !pubSnap.exists) return {changed:false, reason:'missing'};
    const room = roomSnap.data(), pub = pubSnap.data();
    if (!eligible(room, pub, parse(room.data || '{}'))) return {changed:false, reason:'unsupported-state'};
    const regs = await roomRef.collection('registrations').get();
    const next = projection(room, pub, regs.docs.map(d => ({...d.data(), registrationId:d.id})));
    if (!next) return {changed:false, reason:'unsupported-registration'};
    if (JSON.stringify(next) === JSON.stringify(pub.publicRegistrationRoster)) return {changed:false};
    return db.runTransaction(async tx => {
      const latest = await tx.get(pubRef);
      if (!latest.exists) return {changed:false, reason:'missing'};
      if (!latest.updateTime.isEqual(pubSnap.updateTime)) throw Error('public-source-changed');
      tx.update(pubRef, {publicRegistrationRoster:next});
      return {changed:true, count:next.players.length};
    });
  };
}
module.exports = {createSync, projection, eligible, visible};
