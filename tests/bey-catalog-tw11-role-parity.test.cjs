'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {isActiveCatalogAdmin,hasTestIdentity,projectTrustedUserProfile}=require('../modules/bey-catalog/catalog-tw11-role-policy.cjs');
const {readTw10AdminReviewQueue}=require('../modules/bey-catalog/catalog-tw10-admin-adapter.cjs');
const {readTaiwanReviewQueue}=require('../modules/bey-catalog/catalog-tw08-read-gateway.cjs');
const SECTIONS=['sources','products','parts','variants','colors','options','assemblyClaims','contentClaims','issues'];
function batch(){
 const b={batchId:'DATA-01B-20261009-ZHTW-TW05',productionWritable:false,autoPublish:false,
 sources:[],products:[],parts:[],variants:[],colors:[],options:[],assemblyClaims:[],contentClaims:[],issues:[]};
 for(let i=0;i<5;i++)b.assemblyClaims.push({groupId:'group_'+i,verificationStatus:'supplier_pending'});
 for(let i=0;i<11;i++)b.variants.push({variantId:'variant_'+i,colorPhysicalVerification:'pending'});
 for(let i=0;i<15;i++)b.parts.push({partId:'part_'+i,localizationStatus:'taiwan_name_pending'});
 while(SECTIONS.reduce((n,s)=>n+b[s].length,0)<197)b.issues.push({issueId:'issue_'+b.issues.length});
 return b;
}
test('role truth table matches production isAdminData / hasTestIdentity',()=>{
 const rows=[
  [{role:'admin',active:true},true],
  [{role:'super_admin',active:true},true],
  [{role:'admin',active:true,isTestAccount:false},true],
  [{role:'admin',active:true,isTestAccount:true},false],
  [{role:'super_admin',active:true,isTestAccount:true},false],
  [{role:'tester',active:true},false],
  [{role:'tester',active:true,isTestAccount:true},false],
  [{role:'staff',active:true},false],
  [{role:'player',active:true},false],
  [{role:'partner_organizer',active:true},false],
  [{role:'admin',active:false},false],
  [{role:'admin'},false],
  [{role:'ADMIN',active:true},false],
  [{role:'super_admin',active:'true'},false],
  [{role:'admin',active:true,isTestAccount:'true'},true],
  [null,false],[{},false]
 ];
 for(const [profile,allowed] of rows)assert.equal(isActiveCatalogAdmin(profile),allowed,JSON.stringify(profile));
 assert.equal(hasTestIdentity({role:'tester'}),true);
 assert.equal(hasTestIdentity({role:'player',isTestAccount:true}),true);
});
test('trusted user profile only projects server role, active and tester flag',()=>{
 const x=projectTrustedUserProfile({role:'admin',active:true,isTestAccount:false,secret:'do-not-leak',email:'private'});
 assert.deepEqual(x,{role:'admin',active:true,isTestAccount:false});
 assert.equal(x.email,undefined);assert(Object.isFrozen(x));
 assert.equal(projectTrustedUserProfile([]),null);
});
test('TW-08 and TW-10 both reject tester and inactive identities before reading research',async()=>{
 for(const role of ['tester','staff','player','partner_organizer']){
  let loads=0;
  const adapter={verifyIdToken:async()=>({uid:'uid_1',firebase:{sign_in_provider:'password'}}),
   loadUserByUid:async()=>({role,active:true,isTestAccount:false}),
   loadResearchBatch:async()=>{loads++;return batch();}};
  assert.equal((await readTaiwanReviewQueue({adapter,idToken:'token'})).access,'denied');
  assert.equal(loads,0);
  const deps={adminAuth:{verifyIdToken:async()=>({uid:'uid_1',firebase:{sign_in_provider:'password'}})},
   adminFirestore:{collection:()=>({doc:()=>({get:async()=>({exists:true,data:()=>({role,active:true})})})})},
   loadResearchBatch:async()=>{loads++;return batch();}};
  assert.equal((await readTw10AdminReviewQueue({...deps,idToken:'token'})).access,'denied');
  assert.equal(loads,0);
 }
});
test('TW-10 permits active non-tester super_admin with verified server identity',async()=>{
 let loaded=0;
 const deps={adminAuth:{verifyIdToken:async(t,revoked)=>{assert.equal(revoked,true);return {uid:'root_1',firebase:{sign_in_provider:'password'}};}},
  adminFirestore:{collection:()=>({doc:()=>({get:async()=>({exists:true,data:()=>({role:'super_admin',active:true,isTestAccount:false})})})})},
  loadResearchBatch:async()=>{loaded++;return batch();}};
 const result=await readTw10AdminReviewQueue({...deps,idToken:'verified',request:{limit:20}});
 assert.equal(result.access,'preview');assert.equal(result.summary.total,31);assert.equal(loaded,1);
 assert.equal(result.canPublish,false);assert.equal(result.canApprove,false);
});
