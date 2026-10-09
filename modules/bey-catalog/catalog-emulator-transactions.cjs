'use strict';
/* DB-01 emulator-only transactional staging. Not a production writer. */
const {assertIsolatedTarget,allowedCollections}=require('./safety-gate.cjs');
const {doc,runTransaction}=require('firebase/firestore');
function verifyEmulator(db,target){
 const approved=assertIsolatedTarget(target);
 if(approved.projectId!=='demo-bxh-catalog-db01')throw Error('UNEXPECTED_DEMO_PROJECT');
 if(approved.emulatorHost!=='127.0.0.1:8189')throw Error('UNEXPECTED_EMULATOR_HOST');
 if(process.env.FIRESTORE_EMULATOR_HOST!==approved.emulatorHost)throw Error('EMULATOR_ENV_MISMATCH');
 if(db?.app?.options?.projectId!==approved.projectId)throw Error('FIRESTORE_PROJECT_MISMATCH');
 return approved;
}
function createTransactionAdapter(db,target){
 verifyEmulator(db,target);
 return Object.freeze({
  emulatorOnly:true,
  async createOrCompare(collection,id,record){
   verifyEmulator(db,target);
   if(!allowedCollections.includes(collection))throw Error('COLLECTION_NOT_ALLOWED');
   if(!/^[A-Za-z0-9_-]+$/.test(id))throw Error('INVALID_DOCUMENT_ID');
   if(!record||record.publicationStatus!=='unpublished'||record.origin!=='research_staging'||typeof record.sha256!=='string')throw Error('INVALID_STAGING_RECORD');
   return runTransaction(db,async transaction=>{
    const ref=doc(db,collection,id);
    const snapshot=await transaction.get(ref);
    if(snapshot.exists())return snapshot.data().sha256===record.sha256?'unchanged':'conflict';
    transaction.set(ref,record);
    return 'inserted';
   },{maxAttempts:5});
  }
 });
}
async function applyTransactionalStaging(plan,adapter,target){
 assertIsolatedTarget(target);
 if(!plan||plan.mode!=='DRY_RUN'||plan.productionWritable!==false||plan.autoPublish!==false||!Array.isArray(plan.records))throw Error('UNSAFE_STAGING_PLAN');
 if(!adapter||adapter.emulatorOnly!==true||typeof adapter.createOrCompare!=='function')throw Error('TRANSACTION_ADAPTER_REQUIRED');
 const result={inserted:0,unchanged:0,conflicts:0,deleted:0,published:0};
 for(const r of plan.records){
  if(!allowedCollections.includes(r.collection))throw Error('COLLECTION_NOT_ALLOWED');
  const status=await adapter.createOrCompare(r.collection,r.id,{sha256:r.sha256,origin:'research_staging',batchId:plan.batchId,payload:r.data,publicationStatus:'unpublished'});
  if(status==='inserted')result.inserted++;
  else if(status==='unchanged')result.unchanged++;
  else if(status==='conflict')result.conflicts++;
  else throw Error('UNKNOWN_TRANSACTION_RESULT');
 }
 return result;
}
module.exports={verifyEmulator,createTransactionAdapter,applyTransactionalStaging};
