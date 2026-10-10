'use strict';
const {test,after}=require('node:test'),assert=require('node:assert/strict');
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getFirestore,Timestamp,FieldValue}=require('firebase-admin/firestore');
const {createTw15AdminEmulatorGuards,WINDOW_MS,LIMIT}=require('../../modules/bey-catalog/catalog-tw15-admin-emulator.cjs');
const {readTw12CatalogQueue}=require('../../modules/bey-catalog/catalog-tw12-secure-read.cjs');
const target={projectId:'demo-bxh-catalog-db01',emulatorHost:'127.0.0.1:8189',mode:'emulator'};
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8189')throw Error('TW15_LOCAL_EMULATOR_REQUIRED');
const app=initializeApp({projectId:target.projectId},'tw15-admin-emulator-tests');
const db=getFirestore(app);
after(async()=>{await deleteApp(app)});
const secret='emulator-only-secret-not-for-production-20261009';
const make=(uid,window)=>createTw15AdminEmulatorGuards({db,target,Timestamp,FieldValue,secret,clock:()=>window*WINDOW_MS});
const OP='tw12.catalog.review.read';
test('Admin SDK transaction accepts five calls, sixth denied, new window starts fresh',async()=>{
 const uid='tw15_admin_quota';
 const a=make(uid,7001);
 for(let i=0;i<LIMIT;i++)assert.equal(await a.consumeRateLimit({uid,operation:OP}),true);
 assert.equal(await a.consumeRateLimit({uid,operation:OP}),false);
 assert.equal(await make(uid,7002).consumeRateLimit({uid,operation:OP}),true);
});
test('parallel Admin SDK transactions cannot exceed quota even under contention',async()=>{
 const uid='tw15_admin_race',g=make(uid,7100);
 const attempts=await Promise.allSettled(Array.from({length:9},()=>g.consumeRateLimit({uid,operation:OP})));
 const accepted=attempts.filter(x=>x.status==='fulfilled'&&x.value===true).length;
 assert(accepted>=1&&accepted<=LIMIT);
 for(let i=accepted;i<LIMIT;i++)assert.equal(await g.consumeRateLimit({uid,operation:OP}),true);
 assert.equal(await g.consumeRateLimit({uid,operation:OP}),false);
});
test('audit uses server timestamp, HMAC pseudonym and no raw UID or tokens',async()=>{
 const uid='tw15_admin_audit',g=make(uid,7200);
 await g.recordAudit({uid,operation:OP,outcome:'preview',count:10,filter:'P0',sourceBatchId:'DATA-01B-20261009-ZHTW-TW05'});
 const snap=await db.collection('beyCatalogTw15Audit').get();
 const mine=snap.docs.filter(x=>x.data().filter==='P0');
 assert.equal(mine.length,1);
 const data=mine[0].data(),serialized=JSON.stringify(data);
 assert.match(data.actorHash,/^[a-f0-9]{64}$/);
 assert(data.recordedAt instanceof Timestamp);
 assert(!serialized.includes(uid));
 assert(!Object.hasOwn(data,'token')&&!Object.hasOwn(data,'query'));
 assert.equal(data.publicationStatus,'unpublished');
});
test('quota has Timestamp TTL field, not numeric expiresAtMs',async()=>{
 const snap=await db.collection('beyCatalogTw15Quota').get();
 assert(snap.size>=2);
 for(const item of snap.docs){
  const d=item.data();
  assert(d.expiresAt instanceof Timestamp);
  assert(!Object.hasOwn(d,'expiresAtMs'));
 }
});
test('invalid project, credentials, audit metadata and operation fail closed',async()=>{
 assert.throws(()=>createTw15AdminEmulatorGuards({db,target:{...target,projectId:'bxh-arena'},Timestamp,FieldValue,secret}),/TW15_LOCAL_ADMIN_EMULATOR_ONLY/);
 assert.throws(()=>createTw15AdminEmulatorGuards({db,target,Timestamp,FieldValue,secret:'weak'}),/TW15_TRUSTED_DEPENDENCIES_REQUIRED/);
 const g=make('unused',7400);
 await assert.rejects(()=>g.consumeRateLimit({uid:'tw15_bad',operation:'publish'}),/TW15_INVALID_ACTOR_OR_OPERATION/);
 await assert.rejects(()=>g.recordAudit({uid:'tw15_bad',operation:OP,outcome:'approved',count:0,filter:'all',sourceBatchId:null}),/TW15_INVALID_AUDIT/);
});
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
test('TW-12 read integrates Admin SDK quota and audit against real Emulator',async()=>{
 const uid='tw15_integrated_admin',guards=make(uid,7500);
 await db.collection('users').doc(uid).set({role:'admin',active:true,isTestAccount:false});
 const dependencies={
  allowedAppIds:['catalog-test-app'],
  adminAppCheck:{verifyToken:async()=>({appId:'catalog-test-app'})},
  adminAuth:{verifyIdToken:async()=>({uid,firebase:{sign_in_provider:'password'}})},
  adminFirestore:db,loadResearchBatch:async()=>syntheticBatch(),
  consumeRateLimit:guards.consumeRateLimit,recordAudit:guards.recordAudit
 };
 const input={dependencies,appCheckToken:'app-test-token',idToken:'auth-test-token',request:{limit:10}};
 for(let i=0;i<5;i++){
  const result=await readTw12CatalogQueue(input);
  assert.equal(result.access,'preview');assert.equal(result.summary.total,31);
  assert.equal(result.canApprove,false);assert.equal(result.canPublish,false);
 }
 await assert.rejects(()=>readTw12CatalogQueue(input),/TW12_RATE_LIMITED/);
 const audit=await db.collection('beyCatalogTw15Audit').get();
 const mine=audit.docs.filter(d=>d.data().filter==='all');
 assert.equal(mine.length,5);
});
