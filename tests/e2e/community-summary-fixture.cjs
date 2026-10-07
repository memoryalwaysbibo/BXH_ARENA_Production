'use strict';

// The deep browser suite uses Auth/Firestore emulators, not deployed Functions.
// Implement only syncSummary for its on-site-only COMMUNITY rooms. Online or
// historical registrations are deliberately unsupported here; the dedicated
// registration/backend suites exercise their full projection contract.
// This is test infrastructure, never a fallback in the production client.
const PROJECT = 'demo-bxh-arena-e2e';
const CALLABLE_PATH = `/${PROJECT}/asia-east1/familyRegistration`;
const AUTH_URL = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:lookup?key=fake-api-key';
const DATABASE = `projects/${PROJECT}/databases/(default)`;
const DOCUMENTS = `http://127.0.0.1:8080/v1/${DATABASE}/documents`;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const populated = value => Array.isArray(value) ? value.length > 0 : object(value) ? Object.keys(value).length > 0 : !!value;

function decode(value) {
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('timestampValue' in value) return Date.parse(value.timestampValue);
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decode);
  if ('mapValue' in value) return decodeFields(value.mapValue.fields || {});
  throw Error('unsupported-emulator-value');
}
const decodeFields = fields => Object.fromEntries(Object.entries(fields).map(([key,value]) => [key,decode(value)]));
const encodeFields = fields => Object.fromEntries(Object.entries(fields).map(([key,value]) => [key,
  typeof value === 'string' ? {stringValue:value} : {integerValue:String(value)}
]));

// Same pending-draw boundary as community-registration-roster.js: generated
// byes and unplayed court assignments are allowed; scores/results are not.
function assertPendingBracketOnly(state) {
  if (!object(state) || state.matches !== undefined && !Array.isArray(state.matches)) throw Error('corrupt-state');
  if ((state.matches || []).some(match => !object(match) || match.startedAt || match.confirmedAt || match.confirmedBy ||
    match.scoreA || match.scoreB || populated(match.log) || populated(match.faultActions) || populated(match.hunterData) ||
    match.status && !(match.isBye ? ['pending','ready','queued','completed'] : ['pending','ready','queued']).includes(match.status) ||
    !match.isBye && (match.completed || match.winnerId || match.loserId || match.resultMethod))) throw Error('roster-locked');
  if (state.courtAssignments !== undefined && !object(state.courtAssignments)) throw Error('corrupt-state');
  if (Object.values(state.courtAssignments || {}).some(court => !object(court) || court.startedAt || court.lockedAt || court.lockedBy ||
    court.status && !['idle','pending','ready','queued'].includes(court.status))) throw Error('roster-locked');
  if (state.startedAt || state.completedAt || state.archivedAt || state.rosterLocked === true || state.archiveStatus === 'completed' ||
    ['live','settling','done','cancelled'].includes(state.tournamentPhase) ||
    ['results','standings','teamStandings','rounds','bracket','brackets'].some(key => populated(state[key])) ||
    ['championId','runnerUpId','thirdId','fourthId','teamResultRevision','ladderPointsAwarded'].some(key => !!state[key])) throw Error('roster-locked');
}

function projectOnsiteSummary(uid, user, tournament, pub, registrations) {
  if (!user || user.active !== true || user.deleted || ['deleted','disabled','frozen'].includes(user.accountStatus)) throw Error('auth-required');
  if (tournament.ownerUid !== uid || tournament.createdBy !== uid || pub.ownerUid !== uid) throw Error('permission-denied');
  if ([tournament,pub].some(doc => doc.eventAuthority !== 'community' || doc.communityQuickRegistration !== true || doc.battleMode === 'team')) throw Error('unsupported-room');
  const state = JSON.parse(tournament.data), mirror = JSON.parse(pub.bracketView);
  if (!object(state) || !Array.isArray(state.players) || !object(mirror)) throw Error('corrupt-state');
  if (tournament.registrationSelection || pub.registrationSelection || state.entrySelection?.mode === 'registration') throw Error('unsupported-room');
  // Keep this fixture narrower than the real backend: no online registration,
  // even if its counters or runtime projection accidentally claim to be empty.
  if (registrations.length || [tournament,pub].some(doc => doc.registrationEnabled !== false || doc.confirmedCount !== 0 || doc.waitlistCount !== 0)) throw Error('unsupported-online-registration');
  if ([tournament,pub].some(doc => doc.systemClosed || doc.eventCancelled || doc.archiveStatus === 'completed' || doc.tournamentPhase !== 'waiting') || state.meta?.eventCancelled) throw Error('tournament-started');
  for (const doc of [tournament,pub,state,mirror]) assertPendingBracketOnly(doc);
  if (state.waitlistPlayers !== undefined && !Array.isArray(state.waitlistPlayers)) throw Error('corrupt-state');
  const players = [...state.players,...(state.waitlistPlayers || [])];
  if (players.some(player => !object(player) || typeof player.id !== 'string' || !player.id)) throw Error('corrupt-state');
  if (players.some(player => player.source === 'online' || player.registrationId || player.registrationUid || player.familyPlayerId)) throw Error('unsupported-online-registration');
  if (new Set(players.map(player => player.id)).size !== players.length) throw Error('registration-state-conflict');
  // On-site fixture identities must be unambiguous; reject aliases that would
  // need the full server-side deduplication/projection implementation.
  const aliases = players.flatMap(player => [...new Set([player.accountUid,player.playerUid,player.uid].filter(Boolean))]);
  if (new Set(aliases).size !== aliases.length) throw Error('unsupported-participant-alias');
  const capacity = tournament.capacity;
  if (capacity !== null && (!Number.isSafeInteger(capacity) || capacity <= 0) || pub.capacity !== capacity) throw Error('registration-state-conflict');
  for (const key of ['registrationOpenAt','registrationCloseAt','cancellationDeadline']) {
    const value = tournament[key];
    if (value !== null && (!Number.isSafeInteger(value) || value <= 0) || pub[key] !== value) throw Error('registration-state-conflict');
  }
  if (tournament.registrationOpenAt !== null && tournament.registrationCloseAt !== null && tournament.registrationCloseAt <= tournament.registrationOpenAt) throw Error('registration-state-conflict');
  const count = state.players.length;
  const visible = state.players.map(player => ({id:player.id,name:String(player.name || ''),checkedIn:player.checkedIn === true}));
  const revisions = [state.registrationRosterRevision ?? 0,mirror.registrationRosterRevision ?? 0];
  if (revisions.some(value => !Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER)) throw Error('registration-state-conflict');
  const changed = JSON.stringify(mirror.players || []) !== JSON.stringify(visible) || state.communityParticipantCount !== count || mirror.communityParticipantCount !== count || revisions[0] !== revisions[1];
  if (changed) {
    const registrationRosterRevision = Math.max(...revisions) + 1;
    Object.assign(state,{communityParticipantCount:count,registrationRosterRevision});
    Object.assign(mirror,{players:visible,communityParticipantCount:count,registrationRosterRevision});
  }
  return {state,mirror,count,changed:changed || tournament.communityParticipantCount !== count || pub.communityParticipantCount !== count};
}

async function syncOnsiteCommunitySummary({method,url,authorization,body}, fetchImpl = fetch) {
  if (method !== 'POST' || url !== CALLABLE_PATH) throw Error('unsupported-callable');
  if (!object(body) || Object.keys(body).some(key => key !== 'data') || !object(body.data)) throw Error('invalid-operation');
  const data = body.data;
  if (Object.keys(data).some(key => !['action','code','operationId'].includes(key)) || data.action !== 'syncSummary' ||
    !/^BXH-[A-Z0-9]{4,16}$/.test(data.code || '') || !/^[a-zA-Z0-9_-]{8,100}$/.test(data.operationId || '')) throw Error('invalid-operation');
  const token = /^Bearer (\S+)$/.exec(authorization || '')?.[1];
  if (!token) throw Error('auth-required');
  async function request(url, options) {
    const response = await fetchImpl(url,{...options,redirect:'error',signal:AbortSignal.timeout(10000)});
    if (!response.ok) throw Error('emulator-request-failed');
    return response.json();
  }
  const auth = await request(AUTH_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({idToken:token})});
  const uid = auth.users?.length === 1 && !auth.users[0].disabled ? auth.users[0].localId : '';
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw Error('auth-required');
  // "owner" is the documented Firestore emulator admin identity, not a real
  // credential. It is only sent to the fixed loopback demo-project endpoint.
  const headers = {'content-type':'application/json',authorization:'Bearer owner'};
  const post = (suffix,data) => request(DOCUMENTS+suffix,{method:'POST',headers,body:JSON.stringify(data)});
  const {transaction} = await post(':beginTransaction',{options:{readWrite:{}}});
  if (!transaction) throw Error('emulator-transaction-failed');
  try {
    const paths = ['users/'+uid,'tournaments/'+data.code,'publicTournaments/'+data.code];
    // Pass transaction bytes in JSON: the emulator's GET query decoder does
    // not support its transaction parameter consistently across versions.
    const names = paths.map(path => DATABASE+'/documents/'+path);
    const batch = await post(':batchGet',{documents:names,transaction});
    const documents = names.map(name => batch.find(row => row.found?.name===name)?.found);
    if (documents.some(doc => !doc?.fields)) throw Error('not-found');
    const rows = await post('/tournaments/'+data.code+':runQuery',{structuredQuery:{from:[{collectionId:'registrations'}],limit:1},transaction});
    if (rows.some(row => row.document)) throw Error('unsupported-online-registration');
    const projected = projectOnsiteSummary(uid,...documents.map(doc => decodeFields(doc.fields)),[]);
    const now = Date.now();
    const fields = [
      {communityParticipantCount:projected.count,updatedAt:now,data:JSON.stringify({...projected.state,updatedAt:now})},
      {communityParticipantCount:projected.count,updatedAt:now,bracketView:JSON.stringify({...projected.mirror,updatedAt:now})}
    ];
    const writes = projected.changed ? fields.map((value,index) => ({
      update:{name:DATABASE+'/documents/'+paths[index+1],fields:encodeFields(value)},updateMask:{fieldPaths:Object.keys(value)}
    })) : [];
    await post(':commit',{transaction,writes});
    return {ok:true,communityParticipantCount:projected.count};
  } catch (error) {
    await post(':rollback',{transaction}).catch(()=>{});
    throw error;
  }
}

module.exports = {CALLABLE_PATH,projectOnsiteSummary,syncOnsiteCommunitySummary};
