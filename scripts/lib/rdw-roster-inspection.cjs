'use strict';
// RDW P3-11: read-only server-owned tournament roster inspection.
// This does not attest Hunter tiers, create snapshots or start events.
function inspectTournament({room,code,actorUid,expectedRosterRevision}){
 if(!room||typeof room!=='object'||typeof code!=='string'||!actorUid)return {ok:false,reason:'missing-input'};
 const state=typeof room.data==='string'?(()=>{try{return JSON.parse(room.data);}catch{return null;}})():room.data;
 if(!state||typeof state!=='object')return {ok:false,reason:'invalid-room-data'};
 if(room.code&&room.code!==code)return {ok:false,reason:'room-code-mismatch'};
 if(state.cloudCode&&state.cloudCode!==code)return {ok:false,reason:'room-code-mismatch'};
 if(state.startedAt||state.rosterLocked)return {ok:false,reason:'already-started'};
 if(state.meta?.battleMode==='team')return {ok:false,reason:'team-mode-not-audited'};
 if(!Number.isSafeInteger(expectedRosterRevision)||expectedRosterRevision<0||Number(state.registrationRosterRevision||0)!==expectedRosterRevision)return {ok:false,reason:'roster-revision-stale'};
 // Organizer permissions MUST be resolved separately against server-owned grants.
 const players=Array.isArray(state.players)?state.players:[];
 const ids=players.map(p=>p?.uid||p?.authUid||null);
 if(ids.length<2||ids.some(id=>typeof id!=='string'||!id.trim())||new Set(ids).size!==ids.length)return {ok:false,reason:'canonical-uid-unverified'};
 return {ok:true,code,rosterRevision:expectedRosterRevision,uids:ids};
}
module.exports={inspectTournament};
