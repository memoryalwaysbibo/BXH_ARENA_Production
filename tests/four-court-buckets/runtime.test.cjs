'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createBucketRuntime}=require('../../referee-seats/functions/bucket-runtime.cjs');
const {createBucketScoringHandler}=require('../../referee-seats/functions/bucket-scoring-service.cjs'),{createBucketSeatHandler}=require('../../referee-seats/functions/bucket-seat-service.cjs'),{createBucketPublicProjection}=require('../../referee-seats/functions/bucket-public-projection.cjs');
const production={BXH_BUCKET_RUNTIME_ENABLED:'true',BXH_BUCKET_PROJECT_ID:'bxh-runtime-test',GCLOUD_PROJECT:'bxh-runtime-test'};
const manifest={schema:'bxh-match-buckets-v1',status:'active',code:'BXH-GATE6',roomId:'gate-room',epoch:'current-generation',courtCount:6,bucketCount:2};
const release={enabled:true,productionEnabled:true,productionRooms:{[manifest.code]:manifest.epoch}};
const envKeys=[...Object.keys(production),'FUNCTIONS_EMULATOR','FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','FIREBASE_DEBUG_MODE','FIREBASE_DEBUG_FEATURES'];
async function withEnv(values,run){const before=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));try{for(const k of envKeys){if(values[k]===undefined)delete process.env[k];else process.env[k]=values[k];}return await run();}finally{for(const k of envKeys){if(before[k]===undefined)delete process.env[k];else process.env[k]=before[k];}}}
test('production requires explicit opt-in, matching non-demo projects and no Emulator/debug environment',()=>{
 const db={projectId:production.GCLOUD_PROJECT};
 assert.throws(()=>createBucketRuntime(db,{runtime:'production',env:{}}),/bucket-runtime-disabled/);
 for(const env of [{...production,BXH_BUCKET_PROJECT_ID:'other'}, {...production,GCLOUD_PROJECT:'other'},{...production,BXH_BUCKET_PROJECT_ID:undefined}])assert.throws(()=>createBucketRuntime(db,{runtime:'production',env}),/bucket-project-mismatch/);
 for(const key of envKeys.filter(k=>!Object.hasOwn(production,k)))assert.throws(()=>createBucketRuntime(db,{runtime:'production',env:{...production,[key]:'true'}}),/bucket-runtime-mismatch/);
 const demo='demo-bxh-four-court-buckets';assert.throws(()=>createBucketRuntime({projectId:demo},{runtime:'production',env:{...production,BXH_BUCKET_PROJECT_ID:demo,GCLOUD_PROJECT:demo}}),/bucket-project-mismatch/);
 assert.throws(()=>createBucketRuntime(db,{env:production}),/emulator-only/);
 assert.throws(()=>createBucketRuntime(db,{runtime:'unknown',env:production}),/invalid-bucket-runtime/);
});
test('release and exact room epoch are checked on every authorization, including removal',()=>{
 const gate=createBucketRuntime({projectId:production.GCLOUD_PROJECT},{runtime:'production',env:production});
 assert.throws(()=>gate.assertRoom({},manifest),/release-not-ready/);
 for(const config of [{enabled:true},{...release,productionEnabled:false},{...release,productionRooms:{}},{...release,productionRooms:{[manifest.code]:'old-generation'}},{...release,productionRooms:Object.create(release.productionRooms)}])assert.throws(()=>gate.assertRoom(config,manifest),/bucket-room-not-enabled/);
 const config=structuredClone(release);gate.assertRoom(config,manifest);delete config.productionRooms[manifest.code];assert.throws(()=>gate.assertRoom(config,manifest),/bucket-room-not-enabled/);
});
test('all three real service transactions reject unlisted or old-epoch rooms before bucket reads and writes, including receipts',async()=>withEnv(production,async()=>{
 let config,reads=0,writes=0;
 const state={id:manifest.roomId,cloudCode:manifest.code,meta:{stations:6},matches:[]},room={data:JSON.stringify(state),scoreStorage:manifest};
 const ref=path=>({path,collection:name=>({doc:id=>ref(path+'/'+name+'/'+id)})});
 const db={projectId:production.GCLOUD_PROJECT,doc:ref,runTransaction:run=>run({getAll:async(...refs)=>refs.map(r=>{reads++;assert(!r.path.includes('/matchBuckets/'),'must reject before bucket reads');let data=r.path==='tournaments/'+manifest.code?room:r.path==='systemConfig/fourCourtScoreBuckets'?config:r.path==='systemConfig/refereeSeatsV1'?{enabled:true,perCourtScoringVerified:true}:{hash:'existing-receipt',epoch:manifest.epoch};return {exists:true,data:()=>data};}),set:()=>{writes++;},update:()=>{writes++;},create:()=>{writes++;}})};
 const score=createBucketScoringHandler(db,{runtime:'production'}),seat=createBucketSeatHandler(db,{runtime:'production'}),publish=createBucketPublicProjection(db,{runtime:'production'});
 for(config of [{enabled:true},{...release,productionRooms:{}},{...release,productionRooms:{[manifest.code]:'old-generation'}}]){
  await assert.rejects(score({auth:{uid:'ref1'},data:{code:manifest.code,operationId:'gate-operation-0001',action:'score',station:1}}),/bucket-room-not-enabled/);
  await assert.rejects(seat({auth:{uid:'ref1'},data:{code:manifest.code,operationId:'gate-operation-0002',action:'claim',station:1,slot:'backup1'}}),/bucket-room-not-enabled/);
  await assert.rejects(publish(manifest.code),/bucket-room-not-enabled/);
 }
 assert(reads>0);assert.equal(writes,0);
}));
test('formal index discovers all exports while closed; legacy commands work and bucket requests never access DB',async()=>withEnv({},async()=>{
 let reads=0;const db={projectId:'bxh-runtime-test',doc(){reads++;throw Error('unexpected DB access');},runTransaction(){reads++;throw Error('unexpected transaction');}};
 class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
 const definitions=[];const localRequire=id=>{
  if(id==='firebase-admin/app')return {getApps:()=>[{}],initializeApp:()=>assert.fail('unexpected app initialization')};
  if(id==='firebase-admin/firestore')return {getFirestore:()=>db};
  if(id==='firebase-functions/v2/https')return {HttpsError,onCall:(options,handler)=>{definitions.push(options);return handler;}};
  if(id==='firebase-functions/v2/firestore')return {onDocumentWritten:(options,handler)=>handler};
  if(id==='./service.cjs')return {createHandler:()=>async()=>({legacy:'seats'})};
  if(id==='./scoring-service.cjs')return {createScoringHandler:()=>async()=>({legacy:'score'})};
  if(id==='./bucket-runtime-entry.cjs')return require('../../referee-seats/functions/bucket-runtime-entry.cjs');
  throw Error('unexpected import '+id);
 };
 const context={exports:{},require:localRequire};vm.runInNewContext(fs.readFileSync(require.resolve('../../referee-seats/functions/index.js'),'utf8'),context);
 const f=context.exports;assert.deepEqual(Object.keys(f).sort(),['manageRefereeSeats','commitRefereeCommand','commitBucketRefereeCommand','manageBucketRefereeSeats','projectBucketPublicScore'].sort());
 assert.deepEqual(await f.manageRefereeSeats({}),{legacy:'seats'});assert.deepEqual(await f.commitRefereeCommand({}),{legacy:'score'});
 const request={auth:{uid:'ref1'},app:{appId:'verified-app'},data:{}};
 await assert.rejects(f.commitBucketRefereeCommand(request),/bucket-runtime-disabled/);await assert.rejects(f.manageBucketRefereeSeats(request),/bucket-runtime-disabled/);
 const event={params:{code:manifest.code,bucketId:'court-1'},data:{after:{exists:true,data:()=>({schema:manifest.schema,code:manifest.code,bucketId:'court-1',epoch:manifest.epoch,revision:1})}}};
 assert.equal((await f.projectBucketPublicScore(event)).reason,'bucket-runtime-disabled');assert.equal(reads,0);
 assert.equal(definitions.length,4);assert(definitions.slice(2).every(o=>o.enforceAppCheck===true));
}));
