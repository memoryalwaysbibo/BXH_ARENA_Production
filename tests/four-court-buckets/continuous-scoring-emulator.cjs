'use strict';
// Deliberately keep publication stopped while independent courts keep scoring.
// This is a trusted-core Emulator test, not production Callable/network capacity.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
assert.equal(process.env.GCLOUD_PROJECT,'demo-bxh-four-court-buckets');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8188');
const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
const B=require('../../referee-seats/functions/bucket-state.cjs');
const {fixture,request}=require('./trusted-fixture.cjs');
const {createBucketScoringHandler}=require('../../referee-seats/functions/bucket-scoring-service.cjs');
const {createBucketPublicProjection}=require('../../referee-seats/functions/bucket-public-projection.cjs');
const app=initializeApp({projectId:process.env.GCLOUD_PROJECT},'continuous-score-test'),db=getFirestore(app);
const cycles=Number(process.env.BXH_SCORE_LAB_CYCLES||6);
assert(Number.isSafeInteger(cycles)&&cycles>=1&&cycles<=120,'cycles must be 1..120');
const records=[];let serial=0;
async function measured(req){
 let attempts=0;
 const observed={projectId:db.projectId,doc:p=>db.doc(p),runTransaction:(fn,...options)=>db.runTransaction(tx=>{attempts++;return fn(tx);},...options)};
 const started=Date.now(),result=await createBucketScoringHandler(observed)(req);
 records.push({room:req.data.code,station:req.data.station,action:req.data.action,replayed:result.replayed===true,elapsedMs:Date.now()-started,transactionAttempts:attempts,transactionRetries:Math.max(0,attempts-1)});
 return result;
}
(async()=>{
 const rooms=[];
 try{
  await db.doc('systemConfig/fourCourtScoreBuckets').set({enabled:true,automaticPublicProjectionEnabled:false});
  for(const count of [4,2]){
   const code='BXH-CONTINUOUS'+count,f=fixture(code,count,false),root=db.doc('tournaments/'+code),pub=db.doc('publicTournaments/'+code),batch=db.batch();
   batch.set(root,f.room);batch.set(pub,{bracketView:JSON.stringify(f.state),updatedAt:1,visibility:'public'});
   for(const b of B.encode(f.state,f.room.scoreStorage))batch.set(root.collection('matchBuckets').doc(b.bucketId),b);
   for(let i=1;i<=count;i++)batch.set(db.doc('users/ref'+i),f.user);
   await batch.commit();rooms.push({...f,root,pub,before:await root.get(),publicBefore:await pub.get()});
  }
  // Each court waits for its own receipt, never another court or public mirror.
  // Alternating score/undo keeps the match playable for a bounded long run.
  const started=Date.now();
  await Promise.all(rooms.flatMap(room=>room.state.matches.map(async match=>{
   let state=structuredClone(room.state),last;
   for(let i=0;i<cycles*2;i++){
    const data=request(state,room.room,match.id,i%2?'undo':'score','continuous-operation-'+String(++serial).padStart(8,'0'),i%2?{}:{side:'A',finish:'spin'});
    const req={auth:{uid:'ref'+match.station},data};
    const result=await measured(req);
    assert(result.ok);assert.equal(result.scoreRevision,i+1);
    state=B.materialize(room.state,room.room.scoreStorage,result.buckets,B.route(match.station,room.room.scoreStorage.courtCount));
    const current=state.matches.find(m=>m.id===match.id);
    assert.equal(current.scoreA,i%2?0:1);assert.equal(current.log.length,i%2?0:1);
    last=req;
   }
   assert.equal((await measured(last)).replayed,true,'lost reply replay must not score twice');
  })));
  const scoreElapsedMs=Date.now()-started;
  for(const room of rooms){
   assert((await room.root.get()).updateTime.isEqual(room.before.updateTime),'score rewrote shared room');
   assert((await room.pub.get()).updateTime.isEqual(room.publicBefore.updateTime),'score waited for or wrote public view');
   const buckets=await room.root.collection('matchBuckets').get();
   const state=B.materialize(room.state,room.room.scoreStorage,buckets.docs.map(s=>s.data()));
   assert(state.matches.every(m=>m.scoreA===0&&m.log.length===0&&m.refereeSeatScoreRevision===cycles*2));
   assert.equal((await room.root.collection('bucketScoreAudit').get()).size,room.state.meta.stations*cycles*2);
   assert.equal((await room.root.collection('bucketScoreOperations').get()).size,room.state.meta.stations*cycles*2);
   const result=await createBucketPublicProjection(db)(room.state.cloudCode);
   assert(result.ok,'manual catch-up failed');
   assert.equal(result.skipped,false,'catch-up must publish new bucket versions');
   const publicDoc=(await room.pub.get()).data();
   assert.equal(publicDoc.scoreBucketProjection.epoch,room.room.scoreStorage.epoch);
   assert.deepEqual(publicDoc.scoreBucketProjection.versions,Object.fromEntries(buckets.docs.map(s=>[s.id,s.data().revision])));
   const published=JSON.parse(publicDoc.bracketView);
   assert(published.matches.every(m=>m.scoreA===0&&m.log.length===0));
  }
  const accepted=records.filter(r=>!r.replayed),values=accepted.map(r=>r.elapsedMs).sort((a,b)=>a-b),percentile=p=>values[Math.ceil(values.length*p)-1];
  const report={kind:'continuous-four-plus-two-trusted-core',productionWrites:0,cycles,rooms:2,courts:6,scoreElapsedMs,acceptedOperations:accepted.length,replayedOperations:records.length-accepted.length,transactionRetries:records.reduce((n,r)=>n+r.transactionRetries,0),latencyMs:{p50:percentile(.5),p95:percentile(.95),p99:percentile(.99)},rootUnchanged:true,publicStoppedDuringScoring:true,publicCatchup:true,allScoresAndReceiptsVerified:true,records};
  const dir=path.resolve('test-results/four-court-buckets');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'continuous-scoring.json'),JSON.stringify(report,null,2)+'\n');
  console.log('PASS continuous scoring '+JSON.stringify({...report,records:undefined}));
 }finally{await deleteApp(app);}
})().catch(error=>{console.error(error);process.exitCode=1;});
