'use strict';
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
const {doc,getDoc,setDoc}=require('firebase/firestore');
const {planStaging}=require('../../modules/bey-catalog/catalog-staging.cjs');
const {resumeEmulatorBatch}=require('../../modules/bey-catalog/catalog-emulator-batch.cjs');
const target={projectId:'demo-bxh-catalog-db01',emulatorHost:'127.0.0.1:8189',mode:'emulator'};
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8189')throw Error('LOCAL_EMULATOR_REQUIRED');
let env;
async function setup(){if(!env)env=await initializeTestEnvironment({projectId:target.projectId,firestore:{host:'127.0.0.1',port:8189}});return env;}
after(async()=>{if(env)await env.cleanup()});
function fixture(id){
 return {batchId:'BATCH-'+id,dataOrigin:'source-tiered-research',productionWritable:false,autoPublish:false,
 sources:[{sourceId:'source-'+id,url:'https://example.org/'+id,automatedAccess:'not_enabled'}],
 products:[{productId:'product-'+id,sourceId:'source-'+id}],
 parts:[{partId:'part-'+id}],variants:[],colors:[],options:[],assemblyClaims:[],contentClaims:[],issues:[]};
}
test('interrupted import resumes from actual document states without duplicates',async()=>{
 const e=await setup(),plan=planStaging(fixture('recovery'));
 await e.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  await assert.rejects(()=>resumeEmulatorBatch(db,target,plan,{afterRecord:async index=>{if(index===0)throw Error('SIMULATED_CRASH')}}),/SIMULATED_CRASH/);
  const before=await getDoc(doc(db,'beyCatalogImportRuns',plan.batchId));
  assert.equal(before.data().status,'in_progress');
  const recovered=await resumeEmulatorBatch(db,target,plan);
  assert.equal(recovered.inserted,2);
  assert.equal(recovered.unchanged,1);
  assert.equal(recovered.status,'completed');
  const repeat=await resumeEmulatorBatch(db,target,plan);
  assert.equal(repeat.inserted,0);
  assert.equal(repeat.unchanged,3);
  assert.equal(repeat.deleted,0);
  assert.equal(repeat.published,0);
 });
});
test('same batch ID with changed content cannot silently overwrite manifest',async()=>{
 const e=await setup(),plan=planStaging(fixture('manifest'));
 await e.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  await resumeEmulatorBatch(db,target,plan);
  const changed=fixture('manifest');
  changed.parts[0].displayName='manual revision';
  await assert.rejects(()=>resumeEmulatorBatch(db,target,planStaging(changed)),/BATCH_MANIFEST_CHANGED/);
 });
});
test('conflict status persists without changing manually corrected document',async()=>{
 const e=await setup(),plan=planStaging(fixture('conflict'));
 await e.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  await setDoc(doc(db,'beyParts','part-conflict'),{sha256:'manual-edit',publicationStatus:'unpublished'});
  const result=await resumeEmulatorBatch(db,target,plan);
  assert.equal(result.conflicts,1);
  assert.equal(result.status,'completed_with_conflicts');
  assert.equal((await getDoc(doc(db,'beyParts','part-conflict'))).data().sha256,'manual-edit');
 });
});

test('197-record synthetic workload survives interruption and replay',async()=>{
 const e=await setup();
 const b=fixture('volume197');
 b.parts=Array.from({length:195},(_,i)=>({partId:'vol-'+String(i).padStart(3,'0')}));
 const plan=planStaging(b);
 assert.equal(plan.recordCount,197);
 await e.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  await assert.rejects(()=>resumeEmulatorBatch(db,target,plan,{afterRecord:async index=>{if(index===72)throw Error('STOP_AT_73')}}),/STOP_AT_73/);
  const result=await resumeEmulatorBatch(db,target,plan);
  assert.equal(result.inserted,124);assert.equal(result.unchanged,73);assert.equal(result.conflicts,0);
  const again=await resumeEmulatorBatch(db,target,plan);
  assert.equal(again.inserted,0);assert.equal(again.unchanged,197);
 });
});
