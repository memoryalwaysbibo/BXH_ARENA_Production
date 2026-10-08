'use strict';
/** Emulator-only resumable import; individual records are transactional, entire batch is not. */
const crypto=require('node:crypto');
const {doc,runTransaction}=require('firebase/firestore');
const {verifyEmulator,createTransactionAdapter}=require('./catalog-emulator-transactions.cjs');
const {allowedCollections}=require('./safety-gate.cjs');
const RUNS='beyCatalogImportRuns';
function manifestDigest(plan){
 const hashes=plan.records.map(r=>[r.collection,r.id,r.sha256]);
 return crypto.createHash('sha256').update(JSON.stringify(hashes)).digest('hex');
}
function assertPlan(plan){
 if(!plan||plan.mode!=='DRY_RUN'||plan.productionWritable!==false||plan.autoPublish!==false||!Array.isArray(plan.records)||!plan.batchId)throw Error('UNSAFE_BATCH_PLAN');
 if(!/^[A-Za-z0-9_-]+$/.test(plan.batchId))throw Error('INVALID_BATCH_ID');
}
async function prepareRun(db,target,plan){
 verifyEmulator(db,target);assertPlan(plan);
 const manifest=manifestDigest(plan),ref=doc(db,RUNS,plan.batchId);
 await runTransaction(db,async tx=>{
  const snapshot=await tx.get(ref);
  if(snapshot.exists()){
   if(snapshot.data().manifestDigest!==manifest)throw Error('BATCH_MANIFEST_CHANGED');
   return;
  }
  tx.set(ref,{manifestDigest:manifest,expectedRecords:plan.records.length,status:'in_progress',origin:'research_staging',publicationStatus:'unpublished'});
 });
 return {manifest,ref};
}
async function finishRun(db,target,plan,ref,manifest,stats){
 verifyEmulator(db,target);
 return runTransaction(db,async tx=>{
  const snapshot=await tx.get(ref);
  if(!snapshot.exists()||snapshot.data().manifestDigest!==manifest)throw Error('BATCH_MANIFEST_CHANGED');
  const status=stats.conflicts?'completed_with_conflicts':'completed';
  tx.update(ref,{status,expectedRecords:plan.records.length,conflicts:stats.conflicts,publicationStatus:'unpublished'});
  return status;
 });
}
async function resumeEmulatorBatch(db,target,plan,options={}){
 verifyEmulator(db,target);assertPlan(plan);
 const {manifest,ref}=await prepareRun(db,target,plan);
 const adapter=createTransactionAdapter(db,target);
 // No optimistic counters: every retry inspects actual document hashes.
 const stats={inserted:0,unchanged:0,conflicts:0,deleted:0,published:0};
 for(let index=0;index<plan.records.length;index++){
  const r=plan.records[index];
  if(!allowedCollections.includes(r.collection))throw Error('COLLECTION_NOT_ALLOWED');
  const outcome=await adapter.createOrCompare(r.collection,r.id,{sha256:r.sha256,origin:'research_staging',batchId:plan.batchId,payload:r.data,publicationStatus:'unpublished'});
  if(outcome==='inserted')stats.inserted++;
  else if(outcome==='unchanged')stats.unchanged++;
  else if(outcome==='conflict')stats.conflicts++;
  else throw Error('UNKNOWN_TRANSACTION_RESULT');
  if(options.afterRecord)await options.afterRecord(index,r,outcome);
 }
 if(options.beforeComplete)await options.beforeComplete(stats);
 const status=await finishRun(db,target,plan,ref,manifest,stats);
 return {...stats,batchId:plan.batchId,manifestDigest:manifest,status};
}
module.exports={manifestDigest,prepareRun,resumeEmulatorBatch};
