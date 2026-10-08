'use strict';
/** DATA-01B integration runner. Requires an explicitly supplied local JSON fixture. */
const fs=require('node:fs');
const path=require('node:path');
const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
const {doc,getDoc}=require('firebase/firestore');
const {planStaging}=require('../../modules/bey-catalog/catalog-staging.cjs');
const {resumeEmulatorBatch}=require('../../modules/bey-catalog/catalog-emulator-batch.cjs');
const PROJECT='demo-bxh-catalog-db01',HOST='127.0.0.1:8189';
if(process.env.FIRESTORE_EMULATOR_HOST!==HOST)throw Error('LOCAL_EMULATOR_REQUIRED');
const input=process.env.BXH_CATALOG_DATA01B_FILE;
if(!input||!fs.existsSync(input))throw Error('DATA01B_FILE_REQUIRED');
const batch=JSON.parse(fs.readFileSync(path.resolve(input),'utf8'));
const plan=planStaging(batch);
if(plan.recordCount!==197)throw Error('EXPECTED_197_RESEARCH_RECORDS');
const target={projectId:PROJECT,emulatorHost:HOST,mode:'emulator'};
async function main(){
 const env=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:'127.0.0.1',port:8189}});
 try{
  await env.withSecurityRulesDisabled(async ctx=>{
   const db=ctx.firestore();
   let injected=false;
   try{
    await resumeEmulatorBatch(db,target,plan,{afterRecord:async index=>{if(index===72&&!injected){injected=true;throw Error('INJECTED_STOP_AFTER_73')}}});
    throw Error('EXPECTED_INJECTED_STOP');
   }catch(e){if(e.message!=='INJECTED_STOP_AFTER_73')throw e;}
   const recovery=await resumeEmulatorBatch(db,target,plan);
   if(recovery.inserted!==124||recovery.unchanged!==73||recovery.conflicts!==0)throw Error('RECOVERY_COUNTS_WRONG:'+JSON.stringify(recovery));
   const replay=await resumeEmulatorBatch(db,target,plan);
   if(replay.inserted!==0||replay.unchanged!==197||replay.conflicts!==0)throw Error('REPLAY_COUNTS_WRONG:'+JSON.stringify(replay));
   const status=await getDoc(doc(db,'beyCatalogImportRuns',plan.batchId));
   if(status.data().status!=='completed')throw Error('BATCH_NOT_COMPLETE');
   console.log(JSON.stringify({batchId:plan.batchId,records:197,firstPartial:73,recovered:124,replayUnchanged:197,published:0,cloudWrites:0,emulator:true}));
  });
 }finally{await env.cleanup();}
}
main().catch(e=>{console.error(e);process.exitCode=1});
