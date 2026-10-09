'use strict';
/** Private DATA-01B -> real Firestore Emulator -> Taiwan review HTTP adapter.
 * Auth/App Check and onRequest are explicit test doubles, not deployed services.
 * No fixture contents are printed or committed. No production initialization.
 */
const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {initializeTestEnvironment}=require('@firebase/rules-unit-testing');
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getFirestore,Timestamp,FieldValue}=require('firebase-admin/firestore');
const {planStaging}=require('../../modules/bey-catalog/catalog-staging.cjs');
const {resumeEmulatorBatch,manifestDigest}=require('../../modules/bey-catalog/catalog-emulator-batch.cjs');
const {deriveTaiwanTw04}=require('../../modules/bey-catalog/catalog-tw04-corrections.cjs');
const {applyTw05ColorLabels}=require('../../modules/bey-catalog/catalog-tw05-colors.cjs');
const {buildTw06ReviewQueue}=require('../../modules/bey-catalog/catalog-tw06-review-queue.cjs');
const {createTw13HttpV2Handler}=require('../../modules/bey-catalog/catalog-tw13-http-v2.cjs');
const {createTw15AdminEmulatorGuards,WINDOW_MS}=require('../../modules/bey-catalog/catalog-tw15-admin-emulator.cjs');
const target={projectId:'demo-bxh-catalog-db01',emulatorHost:'127.0.0.1:8189',mode:'emulator'};
const EXPECTED_SHA='2a53b4d0164d97a5f0607b4d4fd8a536a84b388530bca3eb371453f525cb7d42';
const EXPECTED_MANIFEST='e8fa4337fa76bd13ebc372ff91e611d03fcd4ccd5ec91623be21f5dabc5992f0';
const sections={sources:['beySources','sourceId',23],products:['beyProducts','productId',9],parts:['beyParts','partId',45],variants:['beyPartVariants','variantId',11],colors:['beyColors','colorId',9],options:['beyProductOptions','optionId',14],assemblyClaims:['beyAssemblyClaims','groupId',16],contentClaims:['beyPackageContents','contentClaimId',52],issues:['beyCatalogIssues','issueId',18]};
function readPrivateFixture(){
 const file=process.env.BXH_CATALOG_DATA01B_FILE;
 if(!file)throw Error('DATA01B_FILE_REQUIRED');
 const raw=fs.readFileSync(file);
 assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),EXPECTED_SHA,'original fixture checksum');
 const base=JSON.parse(raw);
 assert.equal(base.batchId,'DATA-01B-20261009');
 assert.equal(base.productionWritable,false);assert.equal(base.autoPublish,false);
 for(const [section,[,,count]] of Object.entries(sections))assert.equal(base[section].length,count);
 const plan=planStaging(base);
 assert.equal(plan.recordCount,197);assert.equal(manifestDigest(plan),EXPECTED_MANIFEST);
 return {file,raw,base,plan};
}
async function main(){
 if(process.env.FIRESTORE_EMULATOR_HOST!==target.emulatorHost)throw Error('LOCAL_EMULATOR_REQUIRED');
 const {file,raw,base,plan}=readPrivateFixture();
 const env=await initializeTestEnvironment({projectId:target.projectId,firestore:{host:'127.0.0.1',port:8189}});
 const app=initializeApp({projectId:target.projectId},'data01b-taiwan-real');
 const db=getFirestore(app);
 const actor='data01b_tw_admin',player='data01b_tw_player';
 const secret='data01b-taiwan-emulator-only-audit-key';
 let researchLoads=0;
 try{
  for(const collection of [...Object.values(sections).map(s=>s[0]),'beyCatalogImportRuns','users','beyCatalogTw15Quota','beyCatalogTw15Audit'])assert.equal((await db.collection(collection).get()).size,0,'clean Emulator required');
  await env.withSecurityRulesDisabled(async ctx=>{
   const imported=await resumeEmulatorBatch(ctx.firestore(),target,plan);
   assert.equal(imported.inserted,197);assert.equal(imported.published,0);
  });
  async function loadStoredOriginal(){
   const stored=structuredClone(base);
   for(const [section,[collection,idKey,count]] of Object.entries(sections)){
    const snapshots=await db.collection(collection).get();
    assert.equal(snapshots.size,count);
    const documents=new Map(snapshots.docs.map(d=>[d.id,d.data()]));
    stored[section]=base[section].map(original=>{
     const saved=documents.get(original[idKey]);assert(saved);
     const record=plan.records.find(r=>r.collection===collection&&r.id===original[idKey]);
     assert.equal(saved.sha256,record.sha256);assert.equal(saved.batchId,base.batchId);
     assert.equal(saved.publicationStatus,'unpublished');assert.equal(saved.origin,'research_staging');
     assert.deepEqual(saved.payload,original);return saved.payload;
    });
   }
   assert.deepEqual(stored,base);return stored;
  }
  const originalSnapshot=await loadStoredOriginal();
  const derived=applyTw05ColorLabels(deriveTaiwanTw04(originalSnapshot));
  const queue=buildTw06ReviewQueue(derived);
  assert.deepEqual(queue.summary,{total:31,P0:5,P1:15,P2:11});
  assert(queue.items.some(i=>i.recordId==='part_000022'&&i.reasonCode==='TAIWAN_PART_NAME_PENDING'));
  assert(queue.items.every(i=>i.reviewState==='pending'&&!i.evidenceVerified&&!i.canAutoPublish));
  assert.equal(derived.contentClaims.find(c=>c.contentClaimId==='content_000019').partId,'part_000013');
  for(const id of ['part_000034','part_000037']){
   const p=derived.parts.find(p=>p.partId===id);assert.equal(p.localizationStatus,'taiwan_name_pending');
   assert(!p.aliases.some(a=>['九尾','焰神'].includes(a)));
  }
  assert(derived.colors.every(c=>c.displayHex===null&&!c.physicalColorVerified));
  assert(derived.parts.every(p=>p.selectable===false));
  assert(derived.variants.every(v=>v.selectable===false&&v.canAutoPublish===false));
  await db.collection('users').doc(actor).set({role:'super_admin',active:true,isTestAccount:false});
  await db.collection('users').doc(player).set({role:'player',active:true,isTestAccount:false});
  const guards=createTw15AdminEmulatorGuards({db,target,Timestamp,FieldValue,secret,clock:()=>WINDOW_MS*99002});
  const dependencies={allowedAppIds:['data01b-test-app'],
   adminAppCheck:{verifyToken:async token=>{if(token!=='test-app')throw Error('INVALID_APP_CHECK');return {appId:'data01b-test-app'};}},
   adminAuth:{verifyIdToken:async(token,revoked)=>{assert.equal(revoked,true);assert(['admin-test-token','player-test-token'].includes(token));return {uid:token==='admin-test-token'?actor:player,firebase:{sign_in_provider:'password'}};}},
   adminFirestore:db,loadResearchBatch:async()=>{researchLoads++;return applyTw05ColorLabels(deriveTaiwanTw04(await loadStoredOriginal()));},
   consumeRateLimit:guards.consumeRateLimit,recordAudit:guards.recordAudit};
  const handler=createTw13HttpV2Handler({onRequest:(options,fn)=>fn,dependencies,allowedOrigins:['https://arena.bxh.com.tw']});
  async function request(body={},token='admin-test-token',appToken='test-app'){
   const response={headers:{},set(k,v){this.headers[k]=v;return this;},status(code){this.code=code;return this;},json(body){this.body=body;return this;},send(body){this.body=body;return this;}};
   await handler({method:'POST',headers:{origin:'https://arena.bxh.com.tw','content-type':'application/json',authorization:'Bearer '+token,'x-firebase-appcheck':appToken},body},response);
   return response;
  }
  const seen=[];let cursor=null;
  do{
   const r=await request({limit:10,cursor});assert.equal(r.code,200);
   assert.deepEqual({total:r.body.summary.total,P0:r.body.summary.P0,P1:r.body.summary.P1,P2:r.body.summary.P2},queue.summary);
   assert.equal(r.body.canApprove,false);assert.equal(r.body.canPublish,false);
   assert.equal(r.headers['Cache-Control'],'no-store');seen.push(...r.body.items);cursor=r.body.nextCursor;
  }while(cursor);
  assert.equal(seen.length,31);assert.equal(new Set(seen.map(i=>i.queueId)).size,31);
  assert.deepEqual(seen.map(i=>i.queueId).sort(),queue.items.map(i=>i.queueId).sort());
  const p0=await request({filter:'P0',limit:10});assert.equal(p0.code,200);assert.equal(p0.body.items.length,5);
  assert.equal((await request()).code,429);
  assert.equal(researchLoads,5);
  assert.equal((await request({},'player-test-token')).code,403);assert.equal(researchLoads,5);
  assert.equal((await request({},'admin-test-token','bad-app')).code,403);assert.equal(researchLoads,5);
  const audits=await db.collection('beyCatalogTw15Audit').get();
  const hash=uid=>crypto.createHmac('sha256',secret).update('actor\0'+uid).digest('hex');
  assert.equal(audits.docs.filter(d=>d.data().actorHash===hash(actor)&&d.data().outcome==='preview').length,5);
  assert.equal(audits.docs.filter(d=>d.data().actorHash===hash(player)&&d.data().outcome==='denied').length,1);
  assert(audits.docs.every(d=>d.data().emulatorOnly===true&&d.data().recordedAt instanceof Timestamp));
  assert.deepEqual(await loadStoredOriginal(),originalSnapshot);
  assert.deepEqual(fs.readFileSync(file),raw);
  console.log(JSON.stringify({batchId:base.batchId,originalSha256:EXPECTED_SHA,manifestDigest:EXPECTED_MANIFEST,verifiedDocuments:197,reviewQueue:queue.summary,paginatedItems:seen.length,adminRequests:5,rateLimitStatus:429,playerStatus:403,researchLoads,originalPreserved:true,published:0,cloudWrites:0,emulator:true,auth:'test-double',appCheck:'test-double',http:'in-process-handler'}));
 }finally{await deleteApp(app);await env.cleanup();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
