'use strict';
/**
 * TW-16 isolated HTTP -> TW-12 -> real Admin SDK Firestore Emulator E2E.
 * Firebase Auth and App Check verifiers remain explicit test doubles.
 * No deployed Function, production Firebase, or real DATA-01B fixture.
 */
const {test,after}=require('node:test'),assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getFirestore,Timestamp,FieldValue}=require('firebase-admin/firestore');
const {createTw13HttpV2Handler}=require('../../modules/bey-catalog/catalog-tw13-http-v2.cjs');
const {createTw15AdminEmulatorGuards,WINDOW_MS}=require('../../modules/bey-catalog/catalog-tw15-admin-emulator.cjs');
const target={projectId:'demo-bxh-catalog-db01',emulatorHost:'127.0.0.1:8189',mode:'emulator'};
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8189')throw Error('TW16_EMULATOR_REQUIRED');
const app=initializeApp({projectId:target.projectId},'tw16-http-admin-emulator');
const db=getFirestore(app);
after(async()=>deleteApp(app));
const sections=['sources','products','parts','variants','colors','options','assemblyClaims','contentClaims','issues'];
function syntheticBatch(){
 const b={batchId:'DATA-01B-20261009-ZHTW-TW05',productionWritable:false,autoPublish:false,
  sources:[],products:[],parts:[],variants:[],colors:[],options:[],assemblyClaims:[],contentClaims:[],issues:[]};
 for(let i=0;i<5;i++)b.assemblyClaims.push({groupId:'tw16_group_'+i,verificationStatus:'supplier_pending'});
 for(let i=0;i<11;i++)b.variants.push({variantId:'tw16_variant_'+i,colorPhysicalVerification:'pending'});
 for(let i=0;i<15;i++)b.parts.push({partId:'tw16_part_'+i,localizationStatus:'taiwan_name_pending'});
 while(sections.reduce((n,s)=>n+b[s].length,0)<197)b.issues.push({issueId:'tw16_issue_'+b.issues.length});
 return b;
}
const actor='tw16_root_admin',guest='tw16_player';
const secret='tw16-emulator-only-fixed-test-key-20261009';
const actorHash=uid=>crypto.createHmac('sha256',secret).update('actor\0'+uid).digest('hex');
const guards=createTw15AdminEmulatorGuards({db,target,Timestamp,FieldValue,
 secret,
 clock:()=>WINDOW_MS*99001});
const events=[];
const dependencies={
 allowedAppIds:['tw16-test-app'],
 adminAppCheck:{verifyToken:async token=>{events.push('appcheck');if(token!=='test-app-token')throw Error('INVALID_APP_CHECK');return {appId:'tw16-test-app'};}},
 adminAuth:{verifyIdToken:async(token,revoked)=>{events.push('auth');assert.equal(revoked,true);if(!['root-token','player-token'].includes(token))throw Error('TOKEN_REVOKED');return {uid:token==='root-token'?actor:guest,firebase:{sign_in_provider:'password'}};}},
 adminFirestore:db,
 loadResearchBatch:async()=>{events.push('research');return syntheticBatch();},
 consumeRateLimit:guards.consumeRateLimit,
 recordAudit:guards.recordAudit
};
const handler=createTw13HttpV2Handler({onRequest:(options,fn)=>fn,dependencies,allowedOrigins:['https://arena.bxh.com.tw']});
async function request({token='root-token',appToken='test-app-token',origin='https://arena.bxh.com.tw',body={limit:10}}={}){
 const response={code:null,body:null,headers:{},
  set(k,v){this.headers[k]=v;return this;},
  status(code){this.code=code;return this;},
  json(body){this.body=body;return this;},
  send(body){this.body=body;return this;}};
 await handler({method:'POST',headers:{origin,'content-type':'application/json',
  authorization:'Bearer '+token,'x-firebase-appcheck':appToken},body},response);
 return response;
}
test('setup active admin and player in real Admin Firestore Emulator',async()=>{
 await Promise.all([
  db.collection('users').doc(actor).set({role:'super_admin',active:true,isTestAccount:false}),
  db.collection('users').doc(guest).set({role:'player',active:true,isTestAccount:false})
 ]);
});
test('real HTTP adapter to Admin Emulator returns 31 read-only issues with 5 audited requests',async()=>{
 for(let i=0;i<5;i++){
  const r=await request();
  assert.equal(r.code,200);
  assert.equal(r.body.summary.total,31);
  assert.equal(r.body.items.length,10);
  assert.equal(r.body.canApprove,false);assert.equal(r.body.canPublish,false);
  assert.equal(r.headers['Cache-Control'],'no-store');
 }
 const blocked=await request();
 assert.equal(blocked.code,429);
 assert.deepEqual(blocked.body,{error:'RATE_LIMITED'});
 const audits=await db.collection('beyCatalogTw15Audit').get();
 const previews=audits.docs.filter(d=>d.data().actorHash===actorHash(actor));
 assert.equal(previews.length,5);
 assert(previews.every(d=>d.data().recordedAt instanceof Timestamp));
});
test('player denied, attempt audited but research never loaded',async()=>{
 const before=events.filter(x=>x==='research').length;
 const r=await request({token:'player-token'});
 assert.equal(r.code,403);assert.deepEqual(r.body,{error:'FORBIDDEN'});
 assert.equal(events.filter(x=>x==='research').length,before);
 const audit=await db.collection('beyCatalogTw15Audit').get();
 assert.equal(audit.docs.filter(d=>d.data().actorHash===actorHash(guest)&&d.data().outcome==='denied').length,1);
});
test('bad App Check, CORS and revoked auth fail closed with no extra audit',async()=>{
 const before=(await db.collection('beyCatalogTw15Audit').get()).size;
 assert.equal((await request({appToken:'invalid'})).code,403);
 assert.equal((await request({origin:'https://evil.example'})).code,403);
 assert.equal((await request({token:'revoked-token'})).code,401);
 assert.equal((await db.collection('beyCatalogTw15Audit').get()).size,before);
});
test('no production mutation: all TW-15 quota/audit docs remain emulator-only',async()=>{
 for(const name of ['beyCatalogTw15Quota','beyCatalogTw15Audit']){
  const snapshots=await db.collection(name).get();
  assert(snapshots.size>0);
  assert(snapshots.docs.every(s=>s.data().emulatorOnly===true));
 }
 // This test never invokes catalog product writes; no assertion about unrelated
 // collections populated by other tests sharing this Emulator instance.
});
