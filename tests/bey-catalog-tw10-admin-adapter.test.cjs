'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createTw10AdminAdapter,readTw10AdminReviewQueue}=require('../modules/bey-catalog/catalog-tw10-admin-adapter.cjs');
const SECTIONS=['sources','products','parts','variants','colors','options','assemblyClaims','contentClaims','issues'];
function research(){
 const b={batchId:'DATA-01B-20261009-ZHTW-TW05',productionWritable:false,autoPublish:false,
 sources:[],products:[],parts:[],variants:[],colors:[],options:[],assemblyClaims:[],contentClaims:[],issues:[]};
 for(let i=1;i<=5;i++)b.assemblyClaims.push({groupId:'group_'+i,verificationStatus:'supplier_pending'});
 for(let i=1;i<=11;i++)b.variants.push({variantId:'variant_'+i,colorPhysicalVerification:'pending'});
 for(let i=1;i<=15;i++)b.parts.push({partId:'part_'+i,localizationStatus:'taiwan_name_pending'});
 while(SECTIONS.reduce((n,s)=>n+b[s].length,0)<197)b.issues.push({issueId:'issue_'+b.issues.length});
 return b;
}
function dependencies({role='admin',active=true,isTestAccount=false,batch=research(),revoked=false}={}){
 const calls={verify:[],users:[],research:0};
 return {calls,
  adminAuth:{verifyIdToken:async(token,checkRevoked)=>{
   calls.verify.push({token,checkRevoked});
   if(revoked)throw Error('TOKEN_REVOKED');
   return {uid:'admin_1',firebase:{sign_in_provider:'password'}};
  }},
  adminFirestore:{collection(name){
   assert.equal(name,'users');
   return {doc(uid){
    calls.users.push(uid);
    return {get:async()=>({exists:true,data:()=>({role,active,isTestAccount})})};
   }};
  }},
  loadResearchBatch:async()=>{calls.research++;return batch;}
 };
}
test('Admin adapter verifies token revocation and reads server-side role before data',async()=>{
 const d=dependencies();
 const out=await readTw10AdminReviewQueue({...d,idToken:'valid',request:{limit:10}});
 assert.equal(out.access,'preview');
 assert.equal(out.summary.total,31);
 assert.equal(out.items.length,10);
 assert.equal(out.canPublish,false);
 assert.deepEqual(d.calls.verify,[{token:'valid',checkRevoked:true}]);
 assert.deepEqual(d.calls.users,['admin_1']);
 assert.equal(d.calls.research,1);
});
test('client role or dataset spoofing cannot override trusted backend dependencies',async()=>{
 const d=dependencies({role:'player'});
 const out=await readTw10AdminReviewQueue({...d,idToken:'valid',request:{role:'super_admin',batch:research()}});
 assert.equal(out.access,'denied');assert.equal(d.calls.research,0);
});
test('inactive, test, missing user or revoked token never load research data',async()=>{
 for(const options of [{active:false},{isTestAccount:true},{role:'player'},{revoked:true}]){
  const d=dependencies(options);
  if(options.revoked)await assert.rejects(()=>readTw10AdminReviewQueue({...d,idToken:'bad'}),/TOKEN_REVOKED/);
  else assert.equal((await readTw10AdminReviewQueue({...d,idToken:'valid'})).access,'denied');
  assert.equal(d.calls.research,0);
 }
 const d=dependencies();
 d.adminFirestore.collection=()=>({doc:()=>({get:async()=>({exists:false})})});
 assert.equal((await readTw10AdminReviewQueue({...d,idToken:'valid'})).access,'denied');
 assert.equal(d.calls.research,0);
});
test('bad research revision or publication flag is rejected',async()=>{
 for(const changes of [{batchId:'production'},{productionWritable:true},{autoPublish:true}]){
  const d=dependencies({batch:{...research(),...changes}});
  await assert.rejects(()=>readTw10AdminReviewQueue({...d,idToken:'valid'}),/TW10_UNTRUSTED_RESEARCH_BATCH/);
 }
});
test('missing trusted server dependencies and disabled revoked checks fail closed',async()=>{
 assert.throws(()=>createTw10AdminAdapter({}),/TW10_SERVER_DEPENDENCIES_REQUIRED/);
 const d=dependencies(),a=createTw10AdminAdapter(d);
 await assert.rejects(()=>a.verifyIdToken('valid',false),/TW10_REVOCATION_CHECK_REQUIRED/);
});
