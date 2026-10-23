'use strict';
// P3-26 read-only live-room participant identity attestation.
// Exact canonical UID only; never infer identity from display names.
// This module does not read from Firestore directly or expose private player records.
const {canonicalUid}=require('./rdw-canonical-identity.cjs');
const UID=/^[A-Za-z0-9_-]{1,128}$/;
function attestParticipant({room,expectedUid,eventCode}={}){
 if(!UID.test(expectedUid||'')||!/^BXH-[A-Z0-9]{6}$/.test(eventCode||''))return {ok:false,reason:'invalid-identity-request'};
 if(!room||typeof room!=='object'||room.code&&room.code!==eventCode)return {ok:false,reason:'room-mismatch'};
 let state=room.data;
 if(typeof state==='string'){try{state=JSON.parse(state);}catch{return {ok:false,reason:'invalid-room-json'};}}
 if(!state||typeof state!=='object'||state.cloudCode&&state.cloudCode!==eventCode||!Array.isArray(state.players))return {ok:false,reason:'invalid-room-state'};
 const matches=[];
 for(let i=0;i<state.players.length;i++){
  const p=state.players[i];
  const identity=canonicalUid(p);
  if(identity.ok&&identity.uid===expectedUid)matches.push(i);
  // Reject ambiguous aliases for the expected UID rather than silently skipping.
  if(!identity.ok&&p&&['accountUid','playerUid','registrationUid','uid'].some(key=>p[key]===expectedUid))return {ok:false,reason:identity.reason};
 }
 if(matches.length!==1)return {ok:false,reason:matches.length?'uid-duplicate':'uid-not-in-room'};
 const index=matches[0],player=state.players[index];
 return {ok:true,eventCode,playerIndex:index,playerId:typeof player.id==='string'?player.id:null,identitySource:'canonical-uid'};
}
module.exports={attestParticipant};
