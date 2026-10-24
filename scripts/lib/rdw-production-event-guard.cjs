'use strict';
// P3-25B — canonical ARENA Firestore room data compatibility gate.
// This is a READ-ONLY inspection module, NOT an organizer grant or start writer.
// A raw tournaments/{code} room stores event state in 'data', not as flat RDW fields.
const {resolveRoster}=require('./rdw-canonical-identity.cjs');
function readCanonicalEvent({room,eventCode,expectedRosterRevision,actorUid}={}){
 if(!room||typeof room!=='object'||!/^BXH-[A-Z0-9]{6}$/.test(eventCode||'')||!actorUid)return {ok:false,reason:'invalid-request'};
 if(room.code&&room.code!==eventCode)return {ok:false,reason:'room-code-mismatch'};
 let state=room.data;
 if(typeof state==='string'){try{state=JSON.parse(state);}catch{return {ok:false,reason:'invalid-json-state'};}}
 if(!state||typeof state!=='object'||Array.isArray(state))return {ok:false,reason:'room-state-unavailable'};
 if(state.cloudCode&&state.cloudCode!==eventCode)return {ok:false,reason:'room-code-mismatch'};
 if(state.startedAt!=null||state.rosterLocked===true)return {ok:false,reason:'already-started'};
 if(state.meta?.battleMode==='team')return {ok:false,reason:'team-mode-unsupported'};
 const revision=state.registrationRosterRevision;
 if(!Number.isSafeInteger(revision)||revision<0||revision!==expectedRosterRevision)return {ok:false,reason:'roster-revision-stale'};
 const resolved=resolveRoster(state.players);
 if(!resolved.ok)return {ok:false,reason:resolved.reason};
 // Only RETURN roster evidence; organizer authorization and bracket signature must
 // be checked against trusted server-owned records before any start transaction.
 return {ok:true,eventCode,rosterRevision:revision,rosterUids:resolved.uids,startedAt:null,needsServerAuthorization:true,needsBracketValidation:true};
}
module.exports={readCanonicalEvent};
