'use strict';
const LOCK_PHASES=new Set(['live','settling','done','cancelled']);
const MAX_MIRROR_BYTES=1024*1024;
function readLifecycleOnly(d){
 // Only sanitized public bracket, never legacy raw .data. No body is returned.
 if(typeof d?.bracketView!=='string'||Buffer.byteLength(d.bracketView)>MAX_MIRROR_BYTES)return {};
 try{
  const v=JSON.parse(d.bracketView);
  const matches=Array.isArray(v?.matches)?v.matches:[];
  const real=matches.filter(m=>m&&typeof m==='object'&&!m.isBye);
  return {
   cancelled:v?.meta?.eventCancelled===true,
   archived:v?.archiveStatus==='completed',
   allDecided:real.length>0&&real.every(m=>m.completed===true),
   live:real.length>0&&Boolean(v?.startedAt||d.startedAt),
   systemClosed:!!(v?.systemClosure&&!v.systemClosure.restoredAt)
  };
 }catch{return {};}
}
function skipProjection(d){
 return !d||d.visibility!=='public'||d.registrationVisibility==='private'||d.roomAccessMode==='private'
  ||d.testMode===true||d.eventAuthority==='test'||d.deleted===true||d.deletionStatus==='deleting';
}
function extractPhase(id,d,proof){
 const old=readLifecycleOnly(d);
 const raw=d.tournamentPhase??d.eventPhase;
 const status=d.registrationStatus;
 const trusted=proof?.roomCode===id&&LOCK_PHASES.has(proof.phase)?proof.phase:null;
 const closure=d.systemClosed===true||!!(d.systemClosure&&!d.systemClosure.restoredAt)||(!d.systemClosure&&old.systemClosed===true);
 // An explicit archive/cancellation cannot be reopened by a stale trigger.
 const phase=d.eventCancelled===true||old.cancelled||raw==='cancelled'||trusted==='cancelled'||status==='cancelled'?'cancelled':
  d.archiveStatus==='completed'||old.archived||raw==='done'||trusted==='done'?'done':
  old.allDecided||trusted==='settling'?'settling':
  old.live||trusted==='live'?'live':
  LOCK_PHASES.has(raw)||raw==='registration'?raw:'waiting';
 return {phase,systemClosed:closure,locked:closure||LOCK_PHASES.has(phase)||status==='started'};
}
module.exports={extractPhase,skipProjection};
