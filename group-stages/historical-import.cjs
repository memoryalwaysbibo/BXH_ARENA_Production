'use strict';

const { createHash } = require('node:crypto');
const { GROUPS } = require('./core.cjs');
const { buildHistoricalTopEight } = require('./historical-top-eight.cjs');

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const normalize = value => typeof value === 'string' ? value.normalize('NFKC').trim().toLowerCase() : '';
const validText = (value, max) => typeof value === 'string' && value.trim().length > 0 &&
  value.length <= max && !/[\x00-\x1f]/.test(value);

function check(condition, code) {
  if (!condition) throw Object.assign(new Error(code), { code });
}

function eligibleProfile(profile) {
  return profile?.active === true && profile.deleted !== true && profile.isTestAccount !== true &&
    !profile.isTestData && !profile.testAccount && !profile.testMode && profile.role !== 'tester' &&
    !['deleted', 'disabled', 'frozen'].includes(profile.accountStatus);
}

async function resolveHistoricalImport(tx, db, parent, parentId, payload) {
  check(payload?.type === 'bxh-historical-top-eight-v1' && payload.groups && payload.groupMatches &&
    GROUPS.every(key => Array.isArray(payload.groups[key]) && payload.groups[key].length >= 4 &&
      payload.groups[key].length <= 96), 'history-import-format');
  const groups = Object.fromEntries(GROUPS.map(key => [key, payload.groups[key].map(player => {
    check(typeof player?.id === 'string' && new RegExp('^' + key + '[0-9]{1,4}$').test(player.id) &&
      validText(player.name, 160) && (player.gameId == null || validText(player.gameId, 160)) &&
      (player.accountUid == null || typeof player.accountUid === 'string' && ID.test(player.accountUid)) &&
      (player.registrationName == null || validText(player.registrationName, 160) && validText(player.gameId, 160)) &&
      (player.directory == null || validText(player.directory?.name, 160) && validText(player.directory?.gameId, 160)) &&
      (player.guardianOf == null || typeof player.guardianOf === 'string' && /^[A-D][0-9]{1,4}$/.test(player.guardianOf)) &&
      [player.accountUid, player.guardianOf, player.hold === true, player.registrationName, player.directory].filter(Boolean).length <= 1,
    'history-import-player');
    return { id: player.id, name: player.name.trim(), gameId: player.gameId?.trim() || null,
      requestedUid: player.accountUid || null, guardianOf: player.guardianOf || null, hold: player.hold === true,
      registrationName: player.registrationName?.trim() || null, directory: player.directory || null };
  })]));
  // Reject malformed competitive data before doing any account reads.
  const { event } = buildHistoricalTopEight({ ...payload, groups });
  const players = GROUPS.flatMap(key => groups[key]);
  const registrations = await tx.get(parent.collection('registrations')
    .where('status', 'in', ['confirmed', 'waitlist']).limit(1001));
  check(registrations.docs.length <= 1000, 'history-import-registration-limit');
  const byNameAndId = new Map();
  for (const snapshot of registrations.docs) {
    const row = snapshot.data();
    const name = normalize(row.realName || row.participantName || row.displayName);
    const gameId = normalize(row.gameId);
    if (!name || !gameId) continue;
    const key = JSON.stringify([name, gameId]);
    if (!byNameAndId.has(key)) byNameAndId.set(key, []);
    byNameAndId.get(key).push({ id: snapshot.id, row });
  }
  const directoryPlayers = players.filter(player => player.directory);
  check(directoryPlayers.length <= 32, 'history-import-player');
  const directoryMatches = await Promise.all(directoryPlayers.map(async player => {
    const candidates = await tx.get(db.collection('users').where('realName', '==', player.directory.name.trim()).limit(21));
    if (candidates.docs.length > 20) return null;
    const hits = candidates.docs.filter(snapshot => {
      const user = snapshot.data();
      return eligibleProfile(user) && normalize(user.gameId || user.nickname || user.displayName) === normalize(player.directory.gameId);
    });
    return hits.length === 1 && ID.test(hits[0].id) ? [player.id, { uid: hits[0].id }] : null;
  }));
  const chosen = new Map(directoryMatches.filter(Boolean));
  for (const player of players) {
    if (player.hold || player.guardianOf || player.directory) continue;
    const rows = byNameAndId.get(JSON.stringify([normalize(player.registrationName || player.name), normalize(player.gameId)])) || [];
    if (player.requestedUid) {
      chosen.set(player.id, { uid: player.requestedUid });
    } else if (rows.length === 1) {
      const { id, row } = rows[0];
      const family = row.familyPlayerId || null;
      const uid = family ? row.guardianUid : row.uid;
      if (typeof uid === 'string' && ID.test(uid) &&
        (!family || typeof family === 'string' && ID.test(family))) {
        chosen.set(player.id, { uid, registrationId: id, familyPlayerId: family });
      }
    }
  }
  const uids = [...new Set([...chosen.values()].map(binding => binding.uid))];
  const profiles = uids.length ? await tx.getAll(...uids.map(uid => db.doc('users/' + uid))) : [];
  const validAccounts = new Set(uids.filter((uid, index) => eligibleProfile(profiles[index].data())));
  const reused = new Map();
  for (const [id, binding] of chosen) {
    if (!validAccounts.has(binding.uid)) continue;
    const key = binding.familyPlayerId ? 'child:' + binding.familyPlayerId : 'adult:' + binding.uid;
    if (!reused.has(key)) reused.set(key, []);
    reused.get(key).push(id);
  }
  const collisions = new Set([...reused.values()].filter(list => list.length > 1).flat());
  const byCode = new Map(players.map(player => [player.id, player]));
  const linked = Object.fromEntries(GROUPS.map(key => [key, groups[key].map(player => {
    let binding = chosen.get(player.id);
    if (player.guardianOf) {
      const guardian = chosen.get(player.guardianOf);
      check(byCode.has(player.guardianOf) && guardian && !guardian.familyPlayerId &&
        !collisions.has(player.guardianOf) && validAccounts.has(guardian.uid),
      'history-import-guardian');
      binding = { uid: guardian.uid, familyPlayerId: 'archive-' + player.id };
    }
    const base = { id: player.id, name: player.name, gameId: player.gameId };
    if (!binding || collisions.has(player.id) || !validAccounts.has(binding.uid)) {
      return { ...base, ladderEligible: false };
    }
    if (binding.familyPlayerId) return { ...base, guardianUid: binding.uid,
      familyPlayerId: binding.familyPlayerId, ladderEligible: false };
    return { ...base, accountUid: binding.uid, ladderEligible: true };
  })]));
  event.groups = linked;
  const boundPlayers = GROUPS.flatMap(key => linked[key]);
  const summary = {
    entrantCount: players.length,
    matchCount: Object.values(event.results).reduce((sum, result) => sum + result.matches.length, 0),
    eligibleCount: boundPlayers.filter(player => player.ladderEligible).length,
    familyCount: boundPlayers.filter(player => player.familyPlayerId).length,
    unlinked: boundPlayers.filter(player => !player.accountUid && !player.guardianUid)
      .map(({ id, name }) => ({ id, name })),
    finalPlaces: event.results['final-eight'].places.map(id => ({ id, name: byCode.get(id).name })),
  };
  const digest = createHash('sha256').update(JSON.stringify([parentId, event])).digest('hex');
  return { event, summary, digest };
}

module.exports = { resolveHistoricalImport, eligibleProfile };
