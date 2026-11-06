'use strict';
const {test,after}=require('node:test'),assert=require('node:assert/strict');
const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
const {collection,getDocs}=require('firebase/firestore');
const {createTw14EmulatorGuards,WINDOW_MS}=require('../../modules/bey-catalog/catalog-tw14-emulator-guards.cjs');
const {readTw12CatalogQueue}=require('../../modules/bey-catalog/catalog-tw12-secure-read.cjs');
const target={projectId:'demo-bxh-catalog-db01',emulatorHost:'127.0.0.1:8189',mode:'emulator'};
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8189')throw Error('LOCAL_EMULATOR_REQUIRED');
let env;
async function setup(){if(!env)env=await initializeTestEnvironment({projectId:target.projectId,firestore:{host:'127.0.0.1',port:8189}});return env;}
after(async()=>{if(env)await env.cleanup()});
const SECTIONS=['sources','products','parts','variants','colors','options','assemblyClaims','contentClaims','issues'];
function syntheticBatch(){
 const b={batchId:'DATA-01B-20261009-ZHTW-TW05',productionWritable:false,autoPublish:false,
 sources:[],products:[],parts:[],variants:[],colors:[],options:[],assemblyClaims:[],contentClaims:[],issues:[]};
 for(let i=0;i<5;i++)b.assemblyClaims.push({groupId:'synthetic_group_'+i,verificationStatus:'supplier_pending'});
 for(let i=0;i<11;i++)b.variants.push({variantId:'synthetic_variant_'+i,colorPhysicalVerification:'pending'});
 for(let i=0;i<15;i++)b.parts.push({partId:'synthetic_part_'+i,localizationStatus:'taiwan_name_pending'});
 while(SECTIONS.reduce((n,s)=>n+b[s].length,0)<197)b.issues.push({issueId:'synthetic_issue_'+b.issues.length});
 return b;
}
test('TW-12 read uses real Emulator transactions for 5 quotas and 5 audit events',async()=>{
 const e=await setup();
 await e.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore(),guards=createTw14EmulatorGuards({db,target,clock:()=>WINDOW_MS*444});
  const before=(await getDocs(collection(db,'beyCatalogTw14Audit'))).size;
  const dependencies={
   allowedAppIds:['catalog-test-app'],
   adminAppCheck:{verifyToken:async()=>({appId:'catalog-test-app'})},
   adminAuth:{verifyIdToken:async()=>({uid:'tw14_integration_admin',firebase:{sign_in_provider:'password'}})},
   adminFirestore:{collection:name=>{
    assert.equal(name,'users');
    return {doc:uid=>({get:async()=>({exists:true,data:()=>({role:'admin',active:true,isTestAccount:false})})})};
   }},
   loadResearchBatch:async()=>syntheticBatch(),
   consumeRateLimit:guards.consumeRateLimit,
   recordAudit:guards.recordAudit
  };
  const input={dependencies,appCheckToken:'test-app-token',idToken:'test-auth-token',request:{limit:10}};
  for(let i=0;i<5;i++){
   const out=await readTw12CatalogQueue(input);
   assert.equal(out.summary.total,31);assert.equal(out.items.length,10);assert.equal(out.canPublish,false);
  }
  await assert.rejects(()=>readTw12CatalogQueue(input),/TW12_RATE_LIMITED/);
  const audit=await getDocs(collection(db,'beyCatalogTw14Audit'));
  assert.equal(audit.size-before,5);
  const newEvents=audit.docs.filter(d=>d.data().actorHash===require('node:crypto').createHash('sha256').update('tw14_integration_admin').digest('hex'));
  assert.equal(newEvents.length,5);
  assert(newEvents.every(d=>d.data().outcome==='preview'));
 });
});
