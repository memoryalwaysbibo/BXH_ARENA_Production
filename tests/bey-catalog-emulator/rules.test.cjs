'use strict';
const {test,after}=require('node:test');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {doc,getDoc,setDoc}=require('firebase/firestore');
const {planStaging,applyEmulatorStaging}=require('../../modules/bey-catalog/catalog-staging.cjs');
const PROJECT='demo-bxh-catalog-db01';
if(!/^(127\.0\.0\.1|localhost):8189$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('LOCAL_EMULATOR_REQUIRED');
let env;
async function setup(){
 if(env)return env;
 env=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:'127.0.0.1',port:8189,rules:readFileSync(path.join(__dirname,'firestore.rules'),'utf8')}});
 await env.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  await Promise.all([
   setDoc(doc(db,'users','admin-1'),{role:'admin',active:true}),
   setDoc(doc(db,'users','player-1'),{role:'player',active:true}),
   setDoc(doc(db,'users','tester-1'),{role:'admin',active:true,isTestAccount:true}),
   setDoc(doc(db,'beyCatalogPublished','visible'),{publicationStatus:'published',name:'已發布示例'}),
   setDoc(doc(db,'beyCatalogPublished','hidden'),{publicationStatus:'unpublished',name:'待核對示例'}),
   setDoc(doc(db,'beyCatalogStaging','draft-1'),{publicationStatus:'unpublished',name:'研究草稿'})
  ]);
 });
 return env;
}
after(async()=>{if(env)await env.cleanup()});
test('published public, unpublished hidden',async()=>{
 const e=await setup(),db=e.unauthenticatedContext().firestore();
 await assertSucceeds(getDoc(doc(db,'beyCatalogPublished','visible')));
 await assertFails(getDoc(doc(db,'beyCatalogPublished','hidden')));
});
test('drafts admin-only; tester-admin denied',async()=>{
 const e=await setup();
 await assertFails(getDoc(doc(e.authenticatedContext('player-1').firestore(),'beyCatalogStaging','draft-1')));
 await assertSucceeds(getDoc(doc(e.authenticatedContext('admin-1').firestore(),'beyCatalogStaging','draft-1')));
 await assertFails(getDoc(doc(e.authenticatedContext('tester-1').firestore(),'beyCatalogStaging','draft-1')));
});
test('browser client writes denied including admin',async()=>{
 const e=await setup();
 for(const uid of ['player-1','admin-1']){
  const db=e.authenticatedContext(uid).firestore();
  await assertFails(setDoc(doc(db,'beyCatalogPublished','attempt-'+uid),{publicationStatus:'published'}));
  await assertFails(setDoc(doc(db,'beyCatalogStaging','attempt-'+uid),{publicationStatus:'unpublished'}));
 }
});
test('research staging idempotent on isolated emulator',async()=>{
 const e=await setup();
 const batch={batchId:'DATA-EMULATOR-TEST',dataOrigin:'source-tiered-research',productionWritable:false,autoPublish:false,
 sources:[{sourceId:'official',url:'https://example.org',automatedAccess:'not_enabled'}],
 products:[{productId:'product-one',sourceId:'official'}],parts:[{partId:'blade-one'}],variants:[],colors:[],
 options:[{optionId:'option-one',productId:'product-one'}],assemblyClaims:[],contentClaims:[],issues:[]};
 const plan=planStaging(batch);
 await e.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  const adapter={emulatorOnly:true,get:async(c,id)=>{const x=await getDoc(doc(db,c,id));return x.exists()?x.data():null},put:async(c,id,v)=>setDoc(doc(db,c,id),v)};
  const target={projectId:PROJECT,emulatorHost:'127.0.0.1:8189',mode:'emulator'};
  const first=await applyEmulatorStaging(plan,adapter,target),second=await applyEmulatorStaging(plan,adapter,target);
  assert.equal(first.inserted,4);assert.equal(second.inserted,0);assert.equal(second.unchanged,4);
 });
 await assertFails(getDoc(doc(e.authenticatedContext('player-1').firestore(),'beyProducts','product-one')));
});
