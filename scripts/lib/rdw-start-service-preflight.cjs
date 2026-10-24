'use strict';
// RDW P3-9 trusted start service preflight. NOT a deployed Cloud Function.
// Explicitly fail closed until canonical auth, roster, tier, and start writer are supplied.
const {commitStart}=require('./rdw-atomic-start-reference.cjs');
function createRdwStartService({db,authorize,resolveRoster,resolveCurrentTiers,makeRefs,clock,enabled=false}){
 if(!enabled)return async()=>({ok:false,code:'rdw-disabled'});
 if(typeof db?.runTransaction!=='function'||[authorize,resolveRoster,resolveCurrentTiers,makeRefs,clock].some(f=>typeof f!=='function'))throw Error('trusted-dependencies-required');
 return async function start({eventCode,drawRevision,actorUid,passRequested=false,failureReason,idempotencyKey}){
  if(!/^BXH-[A-Z0-9]{6}$/.test(eventCode||'')||!Number.isSafeInteger(drawRevision)||drawRevision<0||!actorUid)return {ok:false,code:'invalid-request'};
  // Never trust caller-provided 'authorized', roster, grade, or snapshot status.
  const allowed=await authorize({eventCode,actorUid});
  if(allowed!==true)return {ok:false,code:'not-authorized'};
  const roster=await resolveRoster({eventCode,drawRevision});
  if(!roster||roster.valid!==true||roster.drawRevision!==drawRevision||!Array.isArray(roster.uids)||roster.uids.length<2||roster.uids.some(uid=>typeof uid!=='string'||!uid)||new Set(roster.uids).size!==roster.uids.length)return {ok:false,code:'roster-invalid'};
  const tiers=await resolveCurrentTiers({eventCode,uids:roster.uids});
  // Until server tier source is proven, only explicit RDW PASS can continue.
  const verified=tiers?.verified===true&&tiers.source==='server'&&tiers.drawRevision===drawRevision&&roster.uids.every(uid=>typeof tiers.byUid?.[uid]==='string');
  if(!verified&&!passRequested)return {ok:false,code:'rdw-snapshot-unavailable',passAvailable:true};
  const refs=makeRefs({eventCode,drawRevision,idempotencyKey});
  if(!refs?.eventRef||!refs?.auditRef||!refs?.snapshotRef)return {ok:false,code:'refs-invalid'};
  const now=clock();if(!Number.isSafeInteger(now)||now<=0)throw Error('server-clock-invalid');
  // A verified result is only valid when an already sealed server snapshot is read in the transaction.
  // This service does not synthesize a snapshot from current tier data after start.
  const result=await db.runTransaction(tx=>commitStart({tx,...refs,eventCode,drawRevision,actorUid,authorized:true,rosterValid:true,drawRevisionValid:true,snapshotState:verified?'verified':'failed',readbackStatus:verified?'verified':'missing',passRequested,failureReason:failureReason||'tier-unavailable',serverTime:now,idempotencyKey}));
  return {ok:result.committed===true,mode:result.mode||null,code:result.reason||null};
 };
}
module.exports={createRdwStartService};
