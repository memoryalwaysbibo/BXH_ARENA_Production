'use strict';
// P3-25: server-only orchestration. No network handler registration.
// Request input is restricted to eventCode, drawRevision, PASS reason, idempotency key.
// Trusted adapters must derive authority, roster and tiers from canonical backend state.
const {commitAtomicRosterStart}=require('./rdw-atomic-roster-start.cjs');
const EVENT=/^BXH-[A-Z0-9]{6}$/;
function createTrustedStartCoordinator({db,authorizeInTransaction,readRosterInTransaction,resolveTiers,makeRefs,clock,enabled=false}={}){
 if(!enabled)return async()=>({ok:false,code:'rdw-disabled'});
 if(typeof db?.runTransaction!=='function'||[authorizeInTransaction,readRosterInTransaction,resolveTiers,makeRefs,clock].some(fn=>typeof fn!=='function'))throw Error('rdw-trusted-dependencies-required');
 return async function start({request,actorUid}={}){
  const data=request||{};
  const {eventCode,drawRevision,passRequested=false,failureReason,idempotencyKey}=data;
  if(!actorUid||typeof actorUid!=='string'||!EVENT.test(eventCode||'')||!Number.isSafeInteger(drawRevision)||drawRevision<0||typeof idempotencyKey!=='string'||idempotencyKey.length<4||idempotencyKey.length>128||typeof passRequested!=='boolean')return {ok:false,code:'invalid-request'};
  // Resolve roster using a trusted server callback. Never accept request.uids, request.tiers or request.authorized.
  const initial=await readRosterInTransaction({eventCode,drawRevision});
  if(!initial||!Array.isArray(initial.uids)||initial.uids.length<2||new Set(initial.uids).size!==initial.uids.length)return {ok:false,code:'roster-unavailable'};
  const verifiedTiers=await resolveTiers({eventCode,drawRevision,rosterUids:initial.uids});
  const now=clock();
  if(!Number.isSafeInteger(now)||now<=0)throw Error('server-clock-invalid');
  const refs=makeRefs({eventCode,drawRevision,idempotencyKey});
  if(!refs?.eventRef||!refs?.snapshotRef||!refs?.auditRef)throw Error('rdw-refs-invalid');
  const result=await db.runTransaction(async tx=>{
   const authorized=await authorizeInTransaction({tx,eventCode,actorUid});
   if(authorized!==true)return {committed:false,reason:'not-authorized'};
   const current=await readRosterInTransaction({tx,eventCode,drawRevision});
   if(!current||current.drawRevision!==drawRevision||JSON.stringify(current.uids)!==JSON.stringify(initial.uids))return {committed:false,reason:'roster-changed'};
   return commitAtomicRosterStart({tx,...refs,eventCode,drawRevision,actorUid,authorized:true,rosterValid:true,drawRevisionValid:true,rosterUids:current.uids,verifiedTiers,capturedAt:now,serverTime:now,passRequested,failureReason:failureReason||'trusted-tier-unavailable',idempotencyKey});
  });
  return {ok:result.committed===true,code:result.reason||null,mode:result.mode||null};
 };
}
module.exports={createTrustedStartCoordinator};
