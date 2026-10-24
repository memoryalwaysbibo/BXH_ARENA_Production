'use strict';
// P3-23: reference composition for one Firestore transaction. NOT deployed.
// CRITICAL: all transaction reads precede writes (including PASS audit checks).
const {buildRosterSnapshot}=require('./rdw-roster-tier-snapshot.cjs');
const {chooseStart}=require('./rdw-start-gate.cjs');
const {buildAudit}=require('./rdw-pass-audit.cjs');
async function commitAtomicRosterStart({tx,eventRef,snapshotRef,auditRef,eventCode,drawRevision,actorUid,authorized,rosterValid,drawRevisionValid,rosterUids,verifiedTiers,capturedAt,passRequested=false,failureReason,serverTime,idempotencyKey}){
 if(!tx||typeof tx.get!=='function'||typeof tx.create!=='function'||typeof tx.update!=='function'||!eventRef)throw Error('start-transaction-required');
 if(!authorized||!rosterValid||!drawRevisionValid)return {committed:false,reason:'tournament-safety-gate'};
 const eventDoc=await tx.get(eventRef);
 if(!eventDoc?.exists)throw Error('event-missing');
 const event=eventDoc.data();
 if(!event||event.code!==eventCode||event.drawRevision!==drawRevision)throw Error('event-revision-mismatch');
 if(event.started===true)throw Error('event-already-started');
 // Authentication, roster and bracket checks MUST be performed by the caller against canonical server state.
 // Never trust these booleans or arrays directly from an HTTP request.
 if(!Array.isArray(event.rosterUids)||JSON.stringify(event.rosterUids)!==JSON.stringify(rosterUids))throw Error('event-roster-mismatch');
 let snapshot=null,mode=null,audit=null,priorSnapshot=null,priorAudit=null;
 if(Number.isSafeInteger(serverTime)&&Number.isSafeInteger(capturedAt)&&capturedAt<=serverTime&&Array.isArray(verifiedTiers)&&verifiedTiers.length===rosterUids.length){
  try{snapshot=buildRosterSnapshot({eventCode,drawRevision,rosterUids,verifiedTiers,capturedAt});}catch{snapshot=null;}
 }
 if(snapshot&&snapshotRef){
  const snapDoc=await tx.get(snapshotRef);
  priorSnapshot=snapDoc?.exists?snapDoc.data():null;
  if(priorSnapshot&&(priorSnapshot.source!=='server'||priorSnapshot.verified!==true||priorSnapshot.sealed!==true||priorSnapshot.version!==snapshot.version||priorSnapshot.eventCode!==eventCode||priorSnapshot.drawRevision!==drawRevision||priorSnapshot.rosterSize!==snapshot.rosterSize||priorSnapshot.sourceScope!==snapshot.sourceScope||priorSnapshot.snapshotDigest!==snapshot.snapshotDigest||priorSnapshot.rosterDigest!==snapshot.rosterDigest))throw Error('snapshot-immutable-conflict');
  mode='rdw-verified';
 }
 if(!mode){
  const gate=chooseStart({snapshotState:'failed',readbackStatus:'missing',passRequested,authorized,rosterValid,drawRevisionValid,actorUid,eventCode,failureReason});
  if(!gate.start)return {committed:false,reason:gate.reason};
  if(!auditRef)throw Error('pass-audit-ref-required');
  audit=buildAudit({eventCode,drawRevision,actorUid,reason:failureReason,serverTime,idempotencyKey});
  const auditDoc=await tx.get(auditRef);
  priorAudit=auditDoc?.exists?auditDoc.data():null;
  if(priorAudit&&JSON.stringify(priorAudit)!==JSON.stringify(audit))throw Error('audit-idempotency-conflict');
  mode='rdw-pass';
 }
 // No tx reads below this point. All writes commit or roll back together.
 if(mode==='rdw-verified'&&!priorSnapshot)tx.create(snapshotRef,snapshot);
 if(mode==='rdw-pass'&&!priorAudit)tx.create(auditRef,audit);
 tx.update(eventRef,{started:true,rdwStartMode:mode,rdwEligible:mode==='rdw-verified'});
 return {committed:true,mode,snapshotDigest:snapshot?.snapshotDigest||null};
}
module.exports={commitAtomicRosterStart};
