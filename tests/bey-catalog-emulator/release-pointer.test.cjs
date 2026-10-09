'use strict';
const {test,after}=require('node:test'),assert=require('node:assert/strict');
const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing');
const {doc,getDoc,setDoc}=require('firebase/firestore');
const {simulateReleaseSwitch}=require('../../modules/bey-catalog/release-pointer-emulator.cjs');
const target={projectId:'demo-bxh-catalog-db01',emulatorHost:'127.0.0.1:8189',mode:'emulator'};
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8189')throw Error('LOCAL_EMULATOR_REQUIRED');
const verifier={verifyIdToken:async token=>{if(!['root_admin','regular_admin','player_a','tester_admin'].includes(token))throw Error('INVALID_TOKEN');return {uid:token,firebase:{sign_in_provider:'password'}}}};
let env;
async function setup(){
 if(env)return env;
 env=await initializeTestEnvironment({projectId:target.projectId,firestore:{host:'127.0.0.1',port:8189}});
 await env.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  await Promise.all([
   setDoc(doc(db,'users','root_admin'),{active:true,role:'super_admin'}),
   setDoc(doc(db,'users','regular_admin'),{active:true,role:'admin'}),
   setDoc(doc(db,'users','player_a'),{active:true,role:'player'}),
   setDoc(doc(db,'users','tester_admin'),{active:true,role:'super_admin',isTestAccount:true}),
   setDoc(doc(db,'beyCatalogRuleReleases','catalog_v1'),{releaseId:'catalog_v1',checksum:'hash1',origin:'reviewed_proposal',publicationStatus:'unpublished',active:false,selectable:false}),
   setDoc(doc(db,'beyCatalogRuleReleases','catalog_v2'),{releaseId:'catalog_v2',checksum:'hash2',origin:'reviewed_proposal',publicationStatus:'unpublished',active:false,selectable:false})
  ]);
 });
 return env;
}
after(async()=>{if(env)await env.cleanup()});
const args=(db,toReleaseId,expectedRevision,idToken='root_admin')=>({db,target,authVerifier:verifier,idToken,toReleaseId,expectedRevision,reason:'Reviewed isolated rule change'});
test('switch and rollback preserve revisioned audit without publishing',async()=>{
 const e=await setup();
 await e.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  const a=await simulateReleaseSwitch(args(db,'catalog_v1',0));
  const b=await simulateReleaseSwitch(args(db,'catalog_v2',1));
  const back=await simulateReleaseSwitch(args(db,'catalog_v1',2));
  assert.deepEqual([a.revision,b.revision,back.revision],[1,2,3]);
  assert.equal(back.from,'catalog_v2');
  const pointer=(await getDoc(doc(db,'beyCatalogEmulatorPointers','assembly'))).data();
  assert.equal(pointer.activeReleaseId,'catalog_v1');
  assert.equal(pointer.publicationStatus,'unpublished');
  const audit=(await getDoc(doc(db,'beyCatalogEmulatorPointerAudits','assembly_3'))).data();
  assert.equal(audit.from,'catalog_v2');
  assert.equal(audit.to,'catalog_v1');
  assert.equal(audit.publicationStatus,'unpublished');
  assert.equal(back.playerRecordsMutated,0);
 });
});
test('stale revision and non-super-admin identities denied',async()=>{
 const e=await setup();
 await e.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  await assert.rejects(()=>simulateReleaseSwitch(args(db,'catalog_v2',1)),/STALE_RELEASE_POINTER/);
  for(const id of ['regular_admin','player_a','tester_admin'])await assert.rejects(()=>simulateReleaseSwitch(args(db,'catalog_v2',3,id)),/SUPER_ADMIN_REQUIRED/);
 });
});
test('two concurrent switches with same revision cannot both succeed',async()=>{
 const e=await setup();
 await e.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  const outcomes=await Promise.allSettled([
   simulateReleaseSwitch(args(db,'catalog_v2',3)),
   simulateReleaseSwitch(args(db,'catalog_v2',3))
  ]);
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(outcomes.filter(x=>x.status==='rejected').length,1);
  const pointer=(await getDoc(doc(db,'beyCatalogEmulatorPointers','assembly'))).data();
  assert.equal(pointer.revision,4);
 });
});
test('no client may forge pointer or audit and production targets are rejected',async()=>{
 const e=await setup(),client=e.authenticatedContext('root_admin').firestore();
 await assertFails(setDoc(doc(client,'beyCatalogEmulatorPointers','assembly'),{revision:999}));
 await assertFails(setDoc(doc(client,'beyCatalogEmulatorPointerAudits','assembly_999'),{actorUid:'root_admin'}));
 await e.withSecurityRulesDisabled(async ctx=>{
  await assert.rejects(()=>simulateReleaseSwitch({...args(ctx.firestore(),'catalog_v1',4),target:{...target,projectId:'bxh-arena'}}),/PRODUCTION/);
 });
});
