'use strict';
/** DATA-01B integration runner. Requires an explicitly supplied local JSON fixture. */
const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
const {doc,getDoc,getDocs,collection,setDoc}=require('firebase/firestore');
const {isDeepStrictEqual}=require('node:util');
const {resumeEmulatorBatch}=require('../../modules/bey-catalog/catalog-emulator-batch.cjs');
const {verifyData01bFile}=require('./data01b-preflight.cjs');
const PROJECT='demo-bxh-catalog-db01',HOST='127.0.0.1:8189';
if(process.env.FIRESTORE_EMULATOR_HOST!==HOST)throw Error('LOCAL_EMULATOR_REQUIRED');
const {plan,summary}=verifyData01bFile(process.env.BXH_CATALOG_DATA01B_FILE);
const target={projectId:PROJECT,emulatorHost:HOST,mode:'emulator'};
async function main(){
 const env=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:'127.0.0.1',port:8189}});
 try{
  await env.withSecurityRulesDisabled(async ctx=>{
   const db=ctx.firestore();
   const names=[...new Set(plan.records.map(r=>r.collection))];
   for(const name of [...names,'beyCatalogImportRuns']){
    if(!(await getDocs(collection(db,name))).empty)throw Error('CLEAN_EMULATOR_REQUIRED:'+name);
   }
   let injected=false;
   try{
    await resumeEmulatorBatch(db,target,plan,{afterRecord:async index=>{if(index===72&&!injected){injected=true;throw Error('INJECTED_STOP_AFTER_73')}}});
    throw Error('EXPECTED_INJECTED_STOP');
   }catch(e){if(e.message!=='INJECTED_STOP_AFTER_73')throw e;}
   let partialDocuments=0;
   for(const name of names)partialDocuments+=(await getDocs(collection(db,name))).size;
   if(partialDocuments!==73)throw Error('PARTIAL_DOCUMENT_COUNT_WRONG:'+partialDocuments);
   console.log(JSON.stringify({stage:'interrupted',persistedDocuments:partialDocuments}));
   const recovery=await resumeEmulatorBatch(db,target,plan);
   if(recovery.inserted!==124||recovery.unchanged!==73||recovery.conflicts!==0)throw Error('RECOVERY_COUNTS_WRONG:'+JSON.stringify(recovery));
   console.log(JSON.stringify({stage:'recovered',...recovery}));
   const replay=await resumeEmulatorBatch(db,target,plan);
   if(replay.inserted!==0||replay.unchanged!==197||replay.conflicts!==0)throw Error('REPLAY_COUNTS_WRONG:'+JSON.stringify(replay));
   console.log(JSON.stringify({stage:'replayed',...replay}));
   const status=await getDoc(doc(db,'beyCatalogImportRuns',plan.batchId));
   if(status.data().status!=='completed')throw Error('BATCH_NOT_COMPLETE');
   const counts=new Map();
   for(const r of plan.records){
    const snap=await getDoc(doc(db,r.collection,r.id));
    if(!snap.exists())throw Error('MISSING_EMULATOR_DOCUMENT:'+r.collection+'/'+r.id);
    const saved=snap.data();
    if(saved.sha256!==r.sha256||saved.batchId!==plan.batchId||saved.publicationStatus!=='unpublished'||saved.origin!=='research_staging')throw Error('EMULATOR_DOCUMENT_MISMATCH:'+r.collection+'/'+r.id);
    if(!isDeepStrictEqual(saved.payload,r.data))throw Error('EMULATOR_PAYLOAD_MISMATCH:'+r.collection+'/'+r.id);
    counts.set(r.collection,(counts.get(r.collection)||0)+1);
   }
   for(const [name,count] of counts){
    const all=await getDocs(collection(db,name));
    if(all.size!==count)throw Error('UNEXPECTED_COLLECTION_COUNT:'+name+':'+all.size);
   }
   const manual=plan.records[10],ref=doc(db,manual.collection,manual.id);
   const corrected={...(await getDoc(ref)).data(),sha256:'manual-correction',payload:{...manual.data,manualReviewNote:'DB-01 emulator correction preservation check'}};
   await setDoc(ref,corrected);
   const conflict=await resumeEmulatorBatch(db,target,plan);
   if(conflict.inserted!==0||conflict.unchanged!==196||conflict.conflicts!==1||conflict.published!==0)throw Error('CONFLICT_COUNTS_WRONG:'+JSON.stringify(conflict));
   if(!isDeepStrictEqual((await getDoc(ref)).data(),corrected))throw Error('MANUAL_CORRECTION_OVERWRITTEN');
   const finalStatus=await getDoc(doc(db,'beyCatalogImportRuns',plan.batchId));
   if(finalStatus.data().status!=='completed_with_conflicts')throw Error('CONFLICT_STATUS_MISSING');
   console.log(JSON.stringify({batchId:plan.batchId,sourceSha256:summary.sha256,manifestDigest:summary.manifestDigest,records:197,firstPartial:73,recovered:124,replayUnchanged:197,verifiedDocuments:197,verifiedCollections:counts.size,manualConflicts:1,manualCorrectionPreserved:true,published:0,cloudWrites:0,emulator:true}));
  });
 }finally{await env.cleanup();}
}
main().catch(e=>{console.error(e);process.exitCode=1});
