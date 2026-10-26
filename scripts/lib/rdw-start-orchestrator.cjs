'use strict';
// RDW P3-4 reference orchestrator. No Firebase registration; transaction supplied by trusted caller.
const {chooseStart}=require('./rdw-start-gate.cjs');
const {buildAudit,appendAudit}=require('./rdw-pass-audit.cjs');
async function coordinateStart({snapshotState,readbackStatus,passRequested=false,authorized,rosterValid,drawRevisionValid,actorUid,eventCode,drawRevision,failureReason,serverTime,idempotencyKey,tx,auditRef}){
 const decision=chooseStart({snapshotState,readbackStatus,passRequested,authorized,rosterValid,drawRevisionValid,actorUid,eventCode,failureReason});
 if(!decision.start)return {start:false,reason:decision.reason,mode:decision.mode};
 if(decision.mode==='rdw-verified')return {start:true,mode:'rdw-verified',rdwEligible:true,auditRequired:false};
 if(!tx||!auditRef)return {start:false,mode:'blocked',reason:'audit-transaction-required'};
 const record=buildAudit({eventCode,drawRevision,actorUid,reason:failureReason,serverTime,idempotencyKey});
 await appendAudit({tx,auditRef,record});
 // Caller MUST atomically commit tournament-start transition in same transaction.
 return {start:true,mode:'rdw-pass',rdwEligible:false,auditRequired:true};
}
module.exports={coordinateStart};
