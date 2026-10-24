'use strict';
// P3-3 append-only RDW PASS audit reference adapter; no production service registration.
function buildAudit({eventCode,drawRevision,actorUid,reason,serverTime,idempotencyKey}){
 if(typeof eventCode!=='string'||!eventCode.trim()||typeof actorUid!=='string'||!actorUid.trim()||typeof reason!=='string'||!reason.trim()||typeof idempotencyKey!=='string'||!idempotencyKey.trim())throw Error('audit-required-fields');
 if(!Number.isSafeInteger(drawRevision)||drawRevision<0||!Number.isFinite(serverTime)||serverTime<=0)throw Error('audit-revision-time-invalid');
 return {schemaVersion:'rdw-pass-audit-v1',eventCode,drawRevision,actorUid,reason,serverTime,idempotencyKey,rdwEligible:false};
}
async function appendAudit({tx,auditRef,record}){
 if(!tx||typeof tx.get!=='function'||typeof tx.create!=='function'||!auditRef)throw Error('transaction-create-required');
 const existing=await tx.get(auditRef);
 if(existing?.exists){const prior=existing.data();if(JSON.stringify(prior)!==JSON.stringify(record))throw Error('audit-idempotency-conflict');return {created:false,record:prior};}
 tx.create(auditRef,record);return {created:true,record};
}
module.exports={buildAudit,appendAudit};
