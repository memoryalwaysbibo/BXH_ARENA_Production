'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
assert.equal(process.env.GCLOUD_PROJECT,'demo-bxh-four-court-buckets');assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8188');assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9198');
const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
const B=require('../../referee-seats/functions/bucket-state.cjs'),{createBucketScoringHandler}=require('../../referee-seats/functions/bucket-scoring-service.cjs'),{createBucketPublicProjection}=require('../../referee-seats/functions/bucket-public-projection.cjs'),{fixture,request}=require('./trusted-fixture.cjs');
const app=initializeApp({projectId:process.env.GCLOUD_PROJECT},'bucket-trigger-test'),db=getFirestore(app),score=createBucketScoringHandler(db),publish=createBucketPublicProjection(db);let serial=0;
async function until(check,message){const start=Date.now();while(!await check()){if(Date.now()-start>20000)throw Error(message);await new Promise(resolve=>setTimeout(resolve,100));}}
(async()=>{
 const report={kind:'bucket-real-firestore-trigger',productionWrites:0,cases:[]};
 try{
  await db.doc('systemConfig/fourCourtScoreBuckets').set({enabled:true,automaticPublicProjectionEnabled:true});
  for(const count of [6,12]){
   const code='BXH-AUTOPUB'+count,f=fixture(code,count,false),root=db.doc('tournaments/'+code),pub=db.doc('publicTournaments/'+code),batch=db.batch();
   batch.set(root,f.room);batch.set(pub,{bracketView:JSON.stringify(f.state),updatedAt:1,visibility:'public'});
   for(const bucket of B.encode(f.state,f.room.scoreStorage))batch.set(root.collection('matchBuckets').doc(bucket.bucketId),bucket);
   for(let n=1;n<=count;n++)batch.set(db.doc('users/ref'+n),f.user);await batch.commit();
   const rootBefore=await root.get();
   await Promise.all(f.state.matches.map(match=>score({auth:{uid:'ref'+match.station},data:request(f.state,f.room,match.id,'score','auto-projection-operation-'+(++serial),{side:'A',finish:'spin'})})));
   await until(async()=>{const doc=(await pub.get()).data();if(!doc.scoreBucketProjection)return false;const state=JSON.parse(doc.bracketView);return state.matches.every(m=>m.scoreA===1&&m.log.length===1)&&Object.keys(doc.scoreBucketProjection.versions).length===Math.ceil(count/4);},'trigger did not publish all '+count+' scores');
   assert((await root.get()).updateTime.isEqual(rootBefore.updateTime),'projection rewrote shared root');
   const settled=await pub.get();
   assert.equal((await publish(code,{automatic:true,expectedEpoch:'old-generation'})).reason,'epoch-mismatch');
   assert((await pub.get()).updateTime.isEqual(settled.updateTime),'old generation changed public state');
   assert.equal((await publish(code,{automatic:true,expectedEpoch:f.room.scoreStorage.epoch})).skipped,true);
   await db.doc('systemConfig/fourCourtScoreBuckets').update({automaticPublicProjectionEnabled:false});
   const all=await root.collection('matchBuckets').get(),current=B.materialize(f.state,f.room.scoreStorage,all.docs.map(s=>s.data())),d=request(current,f.room,'m1','score','auto-projection-operation-'+(++serial),{side:'A',finish:'spin'});
   await score({auth:{uid:'ref1'},data:d});
   assert.equal((await publish(code,{automatic:true,expectedEpoch:f.room.scoreStorage.epoch})).reason,'automatic-projection-disabled');
   await new Promise(resolve=>setTimeout(resolve,600));assert((await pub.get()).updateTime.isEqual(settled.updateTime),'disabled trigger published');
   await db.doc('systemConfig/fourCourtScoreBuckets').update({automaticPublicProjectionEnabled:true});
   const changed=await root.collection('matchBuckets').get(),next=B.materialize(f.state,f.room.scoreStorage,changed.docs.map(s=>s.data()));
   await score({auth:{uid:'ref1'},data:request(next,f.room,'m1','score','auto-projection-operation-'+(++serial),{side:'A',finish:'spin'})});
   await until(async()=>JSON.parse((await pub.get()).data().bracketView).matches.find(m=>m.id==='m1').scoreA===3,'re-enabled trigger failed to converge');
   const latest=JSON.parse((await pub.get()).data().bracketView);assert(latest.matches.slice(1).every(m=>m.scoreA===1&&m.log.length===1));assert.equal(latest.matches[0].log.length,3);
   assert((await root.get()).updateTime.isEqual(rootBefore.updateTime));
   report.cases.push({courts:count,buckets:Math.ceil(count/4),automaticEventPublication:true,allScoresPreserved:true,rootUnchanged:true,duplicateVectorSkipped:true,oldEpochSkipped:true,disabledWriterSkipped:true,reEnabledConverges:true});
  }
  const dir=path.resolve('test-results/four-court-buckets');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'automatic-projection.json'),JSON.stringify(report,null,2)+'\n');console.log('PASS automatic Firestore projection: '+JSON.stringify(report));
 }finally{await deleteApp(app);}
})().catch(error=>{console.error(error);process.exitCode=1;});
