'use strict';
// P3-43: ranked-mode flag is NOT authorization.
// This module accepts only explicit verified evidence from a trusted backend
// resolver. It is a policy gate, NOT a Firestore authorization implementation.
function verifyRankedAuthority({room,eventCode,actorUid,evidence}={}){
 if(!room||typeof room!=='object'||typeof eventCode!=='string'||!/^BXH-[A-Z0-9]{6}$/.test(eventCode)||!actorUid)
  return {ok:false,reason:'ranked-authority-context-invalid'};
 let state=room.data;
 if(typeof state==='string'){try{state=JSON.parse(state);}catch{return {ok:false,reason:'ranked-room-invalid'};}}
 if(!state||typeof state!=='object'||state.meta?.ladderMode!=='ranked')
  return {ok:false,reason:'ranked-mode-required'};
 if(state.testMode===true||state.meta?.eventAuthority==='test'||state.meta?.eventAuthority==='community')
  return {ok:false,reason:'ranked-test-or-community-forbidden'};
 if(state.meta?.eventAuthority!=='official')
  return {ok:false,reason:'official-authority-required'};
 const creator=state.createdBy||room.createdBy;
 if(typeof creator!=='string'||!creator)
  return {ok:false,reason:'canonical-creator-unverified'};
 if(!evidence||evidence.source!=='trusted-server'||evidence.verified!==true||
   evidence.eventCode!==eventCode||evidence.creatorUid!==creator||
   evidence.actorUid!==actorUid||evidence.authorized!==true||
   evidence.kind!=='official-or-partner-ranked'||
   evidence.rosterRevision!==state.registrationRosterRevision)
  return {ok:false,reason:'ranked-grant-not-verified'};
 return {ok:true,eventCode,rosterRevision:evidence.rosterRevision};
}
module.exports={verifyRankedAuthority};
