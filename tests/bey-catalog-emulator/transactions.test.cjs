'use strict';
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
const {doc,getDoc,setDoc}=require('firebase/firestore');
const {planStaging}=require('../../modules/bey-catalog/catalog-staging.cjs');
const {createTransactionAdapter,applyTransactionalStaging}=require('../../modules/bey-catalog/catalog-emulator-transactions.cjs');
const projectId='demo-bxh-catalog-db01';
const target={projectId,emulatorHost:'127.0.0.1:8189',mode:'emulator'};
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8189')throw Error('LOCAL_EMULATOR_REQUIRED');
let env;
async function setup(){if(!env)env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8189}});return env;}
after(async()=>{if(env)await env.cleanup()});
function batch(id){return {batchId:'BATCH-'+id,dataOrigin:'source-tiered-research',productionWritable:false,autoPublish:false,
sources:[{sourceId:'src-'+id,url:'https://example.org/'+id,automatedAccess:'not_enabled'}],
products:[{productId:'prod-'+id,sourceId:'src-'+id}],parts:[],variants:[],colors:[],options:[],assemblyClaims:[],contentClaims:[],issues:[]};}
test('two simultaneous imports create each document only once',async()=>{
 const e=await setup(),plan=planStaging(batch('race1'));
 await e.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore(),adapter=createTransactionAdapter(db,target);
  const [a,b]=await Promise.all([applyTransactionalStaging(plan,adapter,target),applyTransactionalStaging(plan,adapter,target)]);
  assert.equal(a.inserted+b.inserted,2);
  assert.equal(a.unchanged+b.unchanged,2);
  assert.equal(a.conflicts+b.conflicts,0);
  const snap=await getDoc(doc(db,'beyProducts','prod-race1'));
  assert.equal(snap.data().publicationStatus,'unpublished');
 });
});
test('changed research record is conflict, never overwrite',async()=>{
 const e=await setup(),plan=planStaging(batch('conflict1'));
 await e.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore(),adapter=createTransactionAdapter(db,target);
  assert.equal((await applyTransactionalStaging(plan,adapter,target)).inserted,2);
  const ref=doc(db,'beyProducts','prod-conflict1');
  await setDoc(ref,{sha256:'manual-override',publicationStatus:'unpublished',origin:'research_staging'});
  const result=await applyTransactionalStaging(plan,adapter,target);
  assert.equal(result.conflicts,1);
  assert.equal((await getDoc(ref)).data().sha256,'manual-override');
 });
});
test('production and forged emulator targets rejected before transaction',async()=>{
 const e=await setup();
 await e.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  for(const bad of [{...target,projectId:'bxh-arena'},{...target,emulatorHost:'localhost:8189'},{...target,projectId:'demo-other'}])
   assert.throws(()=>createTransactionAdapter(db,bad));
 });
});
test('only unpublished research documents may be staged',async()=>{
 const e=await setup();
 await e.withSecurityRulesDisabled(async ctx=>{
  const adapter=createTransactionAdapter(ctx.firestore(),target);
  await assert.rejects(()=>adapter.createOrCompare('beyProducts','unsafe',{sha256:'123',origin:'research_staging',publicationStatus:'published'}),/INVALID_STAGING_RECORD/);
  await assert.rejects(()=>adapter.createOrCompare('users','unsafe',{sha256:'123',origin:'research_staging',publicationStatus:'unpublished'}),/COLLECTION_NOT_ALLOWED/);
 });
});
