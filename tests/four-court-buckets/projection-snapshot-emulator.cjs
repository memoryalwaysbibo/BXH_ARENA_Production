'use strict';
const assert=require('node:assert/strict');
assert.equal(process.env.GCLOUD_PROJECT,'demo-bxh-four-court-buckets');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8188');
const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
const B=require('../../referee-seats/functions/bucket-state.cjs');
const {fixture,request}=require('./trusted-fixture.cjs');
const {createBucketScoringHandler}=require('../../referee-seats/functions/bucket-scoring-service.cjs');
const {createBucketPublicProjection}=require('../../referee-seats/functions/bucket-public-projection.cjs');
const app=initializeApp({projectId:process.env.GCLOUD_PROJECT},'projection-snapshot-races'),db=getFirestore(app);
async function seed(code){
 const f=fixture(code,6,false),root=db.doc('tournaments/'+code),pub=db.doc('publicTournaments/'+code),batch=db.batch();
 batch.set(root,f.room);batch.set(pub,{bracketView:JSON.stringify(f.state),updatedAt:1});
 batch.set(db.doc('users/ref1'),f.user);batch.set(db.doc('systemConfig/fourCourtScoreBuckets'),{enabled:true,automaticPublicProjectionEnabled:true});
 for(const b of B.encode(f.state,f.room.scoreStorage))batch.set(root.collection('matchBuckets').doc(b.bucketId),b);
 await batch.commit();return {...f,root,pub};
}
function delayedPublisher(){
 let release,ready;const hold=new Promise(resolve=>release=resolve),captured=new Promise(resolve=>ready=resolve),reads=[];
 const observed={projectId:db.projectId,doc:p=>db.doc(p),runTransaction:async(fn,options)=>{
  const result=await db.runTransaction(async tx=>fn({get:r=>{reads.push({readOnly:options?.readOnly===true,path:r.path});return tx.get(r);},getAll:(...refs)=>{for(const r of refs)reads.push({readOnly:options?.readOnly===true,path:r.path});return tx.getAll(...refs);},update:(...args)=>tx.update(...args)}),options);
  if(options?.readOnly){ready();await hold;}return result;
 }};
 return {publish:createBucketPublicProjection(observed),release,captured,reads};
}
(async()=>{try{
 // A late publisher captured score 0, while a newer publisher already stored score 1.
 const f=await seed('BXH-LATEPUB6'),late=delayedPublisher(),pending=late.publish(f.state.cloudCode);
 await late.captured;
 await createBucketScoringHandler(db)({auth:{uid:'ref1'},data:request(f.state,f.room,'m1','score','late-publisher-score-operation',{side:'A',finish:'spin'})});
 await createBucketPublicProjection(db)(f.state.cloudCode);const before=await f.pub.get();late.release();
 assert.equal((await pending).reason,'newer-projection');assert((await f.pub.get()).updateTime.isEqual(before.updateTime));
 assert.equal(JSON.parse((await f.pub.get()).data().bracketView).matches[0].scoreA,1);
 assert(late.reads.filter(r=>r.path.includes('/matchBuckets/')).every(r=>r.readOnly));
 assert(late.reads.some(r=>!r.readOnly),'short publication transaction must execute');
 // A successful structural PASS cannot be overwritten by the earlier snapshot.
 const pass=await seed('BXH-LATEPASS6'),older=delayedPublisher(),passPending=older.publish(pass.state.cloudCode);
 await older.captured;
 await createBucketScoringHandler(db)({auth:{uid:'ref1'},data:request(pass.state,pass.room,'m1','skip','late-publisher-pass-operation')});
 const passBefore=await pass.pub.get();older.release();await assert.rejects(passPending,/projection-source-changed/);
 assert((await pass.pub.get()).updateTime.isEqual(passBefore.updateTime));
 assert(JSON.parse(passBefore.data().bracketView).matches[0].skippedAt);
 // Closing the automatic publisher after its snapshot prevents a late write.
 const stopped=await seed('BXH-LATESTOP6'),worker=delayedPublisher(),stopPending=worker.publish(stopped.state.cloudCode,{automatic:true});
 await worker.captured;await db.doc('systemConfig/fourCourtScoreBuckets').update({automaticPublicProjectionEnabled:false});
 const stopBefore=await stopped.pub.get();worker.release();assert.equal((await stopPending).reason,'automatic-projection-disabled');
 assert((await stopped.pub.get()).updateTime.isEqual(stopBefore.updateTime));
 console.log('PASS real snapshot publication races: newer score preserved, PASS protected, shutdown respected; productionWrites=0');
}finally{await deleteApp(app);}})().catch(error=>{console.error(error);process.exitCode=1;});
