'use strict';
// P3-5: trusted transaction composition reference only; NOT connected to production.
const {chooseStart}=require('./rdw-start-gate.cjs');
const {buildAudit,appendAudit}=require('./rdw-pass-audit.cjs');
async function commitStart({tx,eventRef,auditRef,snapshotRef,eventCode,drawRevision,actorUid,authorized,rosterValid,drawRevisionValid,snapshotState,readbackStatus,passRequested=false,failureReason,serverTime,idempotencyKey}){
 if(!tx||typeof tx.get!=='function'||typeof tx.update!=='function'||!eventRef)throw Error('transaction-required');
 const snap=await tx.get(eventRef);
 if(!snap?.exists)throw Error('event-missing');
 const event=snap.data();
 if(!event||event.code!==eventCode||event.drawRevision!==drawRevision)throw Error('event-revision-mismatch');
 if(event.started===true)throw Error('event-already-started');
 const decision=chooseStart({snapshotState,readbackStatus,passRequested,authorized,rosterValid,drawRevisionValid,actorUid,eventCode,failureReason});
 if(!decision.start)return {committed:false,reason:decision.reason};
 if(decision.mode==='rdw-verified'){
   if(!snapshotRef)throw Error('verified-snapshot-reference-required');
   const sealed=await tx.get(snapshotRef);
   if(!sealed?.exists)throw Error('verified-snapshot-missing');
   const record=sealed.data();
   if(!record||record.source!=='server'||record.verified!==true||record.eventCode!==eventCode||record.drawRevision!==drawRevision||record.sealed!==true)throw Error('verified-snapshot-invalid');
 }
 if(decision.mode==='rdw-pass'){
   if(!auditRef||typeof tx.create!=='function')throw Error('audit-transaction-required');
   const record=buildAudit({eventCode,drawRevision,actorUid,reason:failureReason,serverTime,idempotencyKey});
   await appendAudit({tx,auditRef,record});
 }
 // The caller MUST execute this in one Firestore runTransaction callback.
 // Never commit a start separately from the audit. Verified snapshot must be pre-sealed.
 tx.update(eventRef,{started:true,rdwStartMode:decision.mode,rdwEligible:decision.mode==='rdw-verified'});
 return {committed:true,mode:decision.mode};
}
module.exports={commitStart};
