'use strict';

// Pure projection: keep existing player IDs and check-in state when a registration
// document is rewritten. Team registrations expand into their fixed member slots.
const key = value => String(value || '');
function isTeamRegistration(row) {
  return !!row && (row.registrationKind === 'team' || (row.teamId && Array.isArray(row.teamMembers)));
}
function registrationEntries(row) {
  if (!isTeamRegistration(row)) return [row];
  const teamId=key(row.teamId || ('team_'+key(row.registrationId||row.uid)));
  const teamName=key(row.teamName || row.displayName || '未命名隊伍');
  const captainUid=key(row.captainUid || row.uid);
  return (Array.isArray(row.teamMembers)?row.teamMembers:[]).map((member,index)=>({
    ...row,
    displayName:key(member&&member.name).trim(),
    teamId,teamName,captainUid,
    teamMemberSlot:Number(member&&member.slot)||index+1,
    teamMemberPlayerId:key(member&&member.playerId)||teamId+'_m'+String(index+1)
  }));
}
function registrationKey(reg) {
  if (reg && reg.teamId && reg.teamMemberSlot) return 'team:' + key(reg.teamId) + ':' + key(reg.teamMemberSlot);
  return reg.familyPlayerId ? 'family:' + key(reg.familyPlayerId) : 'self:' + key(reg.registrationId || reg.uid);
}
function playerKey(player) {
  if (player && player.teamId && player.teamMemberSlot) return 'team:' + key(player.teamId) + ':' + key(player.teamMemberSlot);
  return player.familyPlayerId ? 'family:' + key(player.familyPlayerId) : 'self:' + key(player.registrationId || player.registrationUid || player.uid);
}
function projectRoster(players, registrations, checkinRequired) {
  const previous = Array.isArray(players) ? players : [];
  const rows = (Array.isArray(registrations) ? registrations : [])
    .filter(row => row && row.status === 'confirmed')
    .flatMap(registrationEntries);
  const byKey = new Map(previous.filter(p => p && p.source === 'online').map(p => [playerKey(p), p]));
  const seen = new Set();
  const online = [];
  for (const row of rows) {
    const identity = registrationKey(row);
    if (seen.has(identity)) continue;
    seen.add(identity);
    const name = String(row.displayName || row.publicName || row.realName || '').trim();
    if (!name) throw new Error('registration-name-missing');
    const old = byKey.get(identity);
    const registrationId = key(row.registrationId || row.uid);
    const guardian = key(row.captainUid || row.guardianUid || row.uid);
    const item = {
      id: old && old.id ? old.id : row.teamMemberPlayerId ? key(row.teamMemberPlayerId) : row.familyPlayerId ? 'family_' + key(row.familyPlayerId) : 'online_' + registrationId,
      name, source: 'online', registrationUid: guardian, registrationId,
      checkedIn: old && typeof old.checkedIn === 'boolean' ? old.checkedIn : !checkinRequired
    };
    if (row.familyPlayerId) Object.assign(item, {
      familyPlayerId: key(row.familyPlayerId), participantId: key(row.familyPlayerId), guardianUid: guardian
    });
    if (row.teamId) Object.assign(item, {
      teamId:key(row.teamId), teamName:key(row.teamName), teamMemberSlot:Number(row.teamMemberSlot)||1,
      captainUid:key(row.captainUid||row.uid), participantId:key(row.teamMemberPlayerId)
    });
    online.push(item);
  }
  return previous.filter(p => p && p.source !== 'online').concat(online);
}
function projectTeams(registrations) {
  return (Array.isArray(registrations)?registrations:[])
    .filter(row=>row&&row.status==='confirmed'&&isTeamRegistration(row))
    .map(row=>{
      const teamId=key(row.teamId||('team_'+key(row.registrationId||row.uid)));
      const members=(Array.isArray(row.teamMembers)?row.teamMembers:[]).map((member,index)=>({
        slot:Number(member&&member.slot)||index+1,
        name:key(member&&member.name),
        playerId:key(member&&member.playerId)||teamId+'_m'+String(index+1)
      }));
      return {
        id:teamId,name:key(row.teamName||row.displayName||'未命名隊伍'),
        captainUid:key(row.captainUid||row.uid),registrationId:key(row.registrationId||row.uid),
        memberPlayerIds:members.map(m=>m.playerId),members
      };
    });
}
const publicPlayers = players => players.map(p => ({
  id: String(p.id || ''), name: String(p.name || ''), checkedIn: p.checkedIn === true
}));
module.exports = {projectRoster, projectTeams, publicPlayers, isTeamRegistration, registrationEntries};
