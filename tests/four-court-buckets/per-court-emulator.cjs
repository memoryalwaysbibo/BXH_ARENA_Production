'use strict';
const assert=require('node:assert/strict');
assert.equal(process.env.GCLOUD_PROJECT,'demo-bxh-four-court-buckets');assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8188');
const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
const B=require('../../referee-seats/functions/bucket-state.cjs'),{fixture,request}=require('./trusted-fixture.cjs'),{command}=require('./dispatch-fixture.cjs');
const {createBucketMigrationService}=require('../../referee-seats/functions/bucket-migration-service.cjs');
const {createBucketScoringHandler}=require('../../referee-seats/functions/bucket-scoring-service.cjs');
const {createBucketPublicProjection}=require('../../referee-seats/functions/bucket-public-projection.cjs');
const app=initializeApp({projectId:process.env.GCLOUD_PROJECT},'per-court-v2'),db=getFirestore(app),migration=createBucketMigrationService(db),score=createBucketScoringHandler(db);let serial=0;
const op=()=> 'per-court-v2-operation-'+String(++serial).padStart(8,'0');
async function seed(code,count,bracket=false){
 const f=fixture(code,count,bracket);delete f.room.scoreStorage;
 const root=db.doc('tournaments/'+code),pub=db.doc('publicTournaments/'+code),batch=db.batch();
 batch.set(root,f.room);batch.set(pub,{bracketView:JSON.stringify(f.state),updatedAt:1});
 batch.set(db.doc('systemConfig/fourCourtScoreBuckets'),{enabled:true,migrationEnabled:true,activationStorageSchema:B.perCourtSchema});
 batch.set(db.doc('users/operator'),{active:true,role:'super_admin'});batch.set(db.doc('users/host'),f.user);
 for(let i=1;i<=count;i++)batch.set(db.doc('users/ref'+i),f.user);await batch.commit();return {...f,root,pub};
}
async function planned(f,action){
 const input={code:f.state.cloudCode,epoch:'per-court-epoch-'+f.root.id,actorUid:'operator',action},plan=await migration.preflight(input);
 assert.equal(plan.version,2);assert.equal(plan.storageSchema,B.perCourtSchema);
 const data={...input,operationId:op(),sourceDigest:plan.sourceDigest};await migration.commit(data);return data;
}
async function current(f){
 return db.runTransaction(async tx=>{const room=(await tx.get(f.root)).data(),snaps=await tx.getAll(...Array.from({length:room.scoreStorage.bucketCount},(_,i)=>f.root.collection('matchBuckets').doc('court-'+(i+1))));return {room,state:B.materialize(JSON.parse(room.data),room.scoreStorage,snaps.map(s=>s.data()))};},{readOnly:true});
}
async function send(f,id,action,extra={}){const now=await current(f),data=request(now.state,now.room,id,action,op(),extra);return score({auth:{uid:'ref'+data.station},data});}
(async()=>{try{
 for(const count of [6,12]){
  const f=await seed('BXH-NATIVEV'+count,count),activate=await planned(f,'activate');
  let now=await current(f);assert.equal(now.room.scoreStorage.bucketCount,count);
  assert.equal((await migration.commit(activate)).replayed,true);
  const rootBefore=await f.root.get(),publicBefore=await f.pub.get();
  await Promise.all(now.state.matches.map(m=>send(f,m.id,'score',{side:'A',finish:'spin'})));
  assert((await f.root.get()).updateTime.isEqual(rootBefore.updateTime));assert((await f.pub.get()).updateTime.isEqual(publicBefore.updateTime));
  now=await current(f);assert(now.state.matches.every(m=>m.scoreA===1&&m.log.length===1));
  const data=request(now.state,now.room,'m1','skip',op()),passed=await score({auth:{uid:'ref1'},data});assert.equal(passed.lifecycleRevision,1);
  assert.equal((await score({auth:{uid:'ref1'},data})).replayed,true);
  now=await current(f);const growth=command(now,'resize',null,op(),{count:count+1,expectedTarget:count,expectedPlanRevision:0});
  await score({auth:{uid:'host'},data:growth});now=await current(f);
  assert.equal(now.room.scoreStorage.schema,B.perCourtSchema);assert.equal(now.room.scoreStorage.bucketCount,count+1);
  assert((await f.root.collection('matchBuckets').doc('court-'+(count+1)).get()).exists);
  await createBucketPublicProjection(db)(f.state.cloudCode);assert.equal(JSON.parse((await f.pub.get()).data().bracketView).matches.find(m=>m.id==='m2').scoreA,1);
  await db.doc('systemConfig/fourCourtScoreBuckets').set({enabled:false,migrationEnabled:false,perCourtStorageEnabled:false});
  const rollback=await planned(f,'rollback'),restored=(await f.root.get()).data(),state=JSON.parse(restored.data);
  assert.equal(restored.scoreStorage,undefined);assert(state.matches.every(m=>m.scoreA===1&&m.log.length===1));assert(state.matches.find(m=>m.id==='m1').skippedAt);
  assert.equal((await f.root.collection('matchBuckets').get()).size,0);assert.equal((await migration.commit(rollback)).replayed,true);
 }
 const f=await seed('BXH-NATIVEFINAL',6,true);await planned(f,'activate');
 for(const id of ['m1','m2']){await send(f,id,'score',{side:'A',finish:'extreme'});await send(f,id,'score',{side:'A',finish:'spin'});await send(f,id,'confirm');}
 const before=await current(f),final=before.state.matches.find(m=>m.id==='final');assert(final.a&&final.b);
 await send(f,'final','score',{side:'A',finish:'extreme'});await send(f,'final','score',{side:'A',finish:'spin'});await send(f,'final','confirm');
 assert.equal((await current(f)).state.championId,final.a.playerId);
 console.log('PASS native per-court v2: 6/12-court migration, independent scores, PASS/replay, resize, publication, disabled-release rollback and final progression; productionWrites=0');
}finally{await deleteApp(app);}})().catch(error=>{console.error(error);process.exitCode=1;});
