'use strict';
const assert=require('node:assert/strict');
assert.equal(process.env.GCLOUD_PROJECT,'demo-bxh-four-court-buckets');assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8188');
const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
const {fixture,request}=require('./trusted-fixture.cjs'),B=require('../../referee-seats/functions/bucket-state.cjs'),{createBucketScoringHandler}=require('../../referee-seats/functions/bucket-scoring-service.cjs'),{verify}=require('../../modules/scoring/four-court-archive.cjs');
const app=initializeApp({projectId:process.env.GCLOUD_PROJECT},'general-bucket-archive'),db=getFirestore(app),commit=createBucketScoringHandler(db);let serial=0;
async function read(root){const room=(await root.get()).data(),base=JSON.parse(room.data),rows=(await root.collection('matchBuckets').get()).docs.map(d=>d.data());return {room,state:B.materialize(base,room.scoreStorage,rows)};}
(async()=>{try{
 await db.doc('systemConfig/fourCourtScoreBuckets').set({enabled:true});
 for(const mode of ['general','ranked']){
  const f=fixture(mode==='general'?'BXH-ARCGEN':'BXH-ARCRNK',6,true),root=db.doc('tournaments/'+f.state.cloudCode),pub=db.doc('publicTournaments/'+f.state.cloudCode);f.room.ladderMode=mode;f.state.meta.ladderMode=mode;f.state.archiveStatus='ongoing';f.room.data=JSON.stringify(f.state);
  await root.set(f.room);await pub.set({ladderMode:mode,bracketView:JSON.stringify(f.state),updatedAt:1});for(const b of B.encode(f.state,f.room.scoreStorage))await root.collection('matchBuckets').doc(b.bucketId).set(b);for(const uid of ['ref1','ref5'])await db.doc('users/'+uid).set(f.user);
  let last;
  for(const id of ['m1','m2','final'])for(const [action,extra]of [['score',{side:'A',finish:'extreme'}],['score',{side:'A',finish:'spin'}],['confirm',{}]]){
   const current=await read(root);last={auth:{uid:'ref'+current.state.matches.find(m=>m.id===id).station},data:request(current.state,current.room,id,action,'archive-operation-'+String(++serial).padStart(8,'0'),extra)};const result=await commit(last);assert(result.ok);
   if(id!=='final'||action!=='confirm')assert.notEqual((await root.get()).data().archiveStatus,'completed');
  }
  const current=await read(root),publicDocument=(await pub.get()).data();assert.equal(current.state.championId,'a');
  if(mode==='general'){
   assert.equal(current.room.tournamentPhase,'done');assert.equal(publicDocument.tournamentPhase,'done');const acknowledged=verify({code:f.state.cloudCode,expected:{roomId:f.state.id,epoch:f.room.scoreStorage.epoch},room:current.room,publicDocument});assert.equal(acknowledged.archiveStatus,'completed');assert.equal(acknowledged.ladderPointsAwarded,false);
   const before=(await root.collection('bucketScoreAudit').get()).size;assert.equal((await commit(last)).replayed,true);assert.equal((await root.collection('bucketScoreAudit').get()).size,before);await assert.rejects(commit({...last,data:{...last.data,operationId:'archive-after-completed-0001',action:'score',side:'B',finish:'spin',expectedScoreRevision:3}}),/room-read-only/);
  }else{assert.notEqual(current.room.archiveStatus,'completed');assert.notEqual(current.state.ladderPointsAwarded,true);}
 }
 console.log('PASS general bucket closure: full cross-bucket tournament, public acknowledgement, replay and ranked isolation; productionWrites=0');
}finally{await deleteApp(app);}})().catch(error=>{console.error(error);process.exitCode=1;});
