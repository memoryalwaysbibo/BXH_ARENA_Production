'use strict';
const assert=require('node:assert/strict');
const B=require('../../referee-seats/functions/bucket-state.cjs'),{createBucketScoringHandler}=require('../../referee-seats/functions/bucket-scoring-service.cjs'),{createBucketPublicProjection}=require('../../referee-seats/functions/bucket-public-projection.cjs'),{fixture,request}=require('./trusted-fixture.cjs');
async function run(db,{automatic=false}={}){
 assert.equal(process.env.GCLOUD_PROJECT,'demo-bxh-four-court-buckets');assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8188');
 const score=createBucketScoringHandler(db),publish=createBucketPublicProjection(db),report={cases:[]};let serial=0;
 async function until(check,message){const started=Date.now();while(!await check()){if(Date.now()-started>20000)throw Error(message);await new Promise(resolve=>setTimeout(resolve,100));}}
  for(const count of [6,12]){
   await db.doc('systemConfig/fourCourtScoreBuckets').set({enabled:true,automaticPublicProjectionEnabled:true,skipPublicProjectionAsyncEnabled:true,perCourtStorageEnabled:true});
   const code='BXH-ASYNCPASS'+count,f=fixture(code,count,false),root=db.doc('tournaments/'+code),pub=db.doc('publicTournaments/'+code);
   f.state.courtAssignments=Object.fromEntries(f.state.matches.map(m=>['court'+m.station,{currentMatchId:m.id,nextMatchId:null,status:'in_progress'}]));
   f.room.data=JSON.stringify(f.state);f.room.scoreStorage=B.makeManifest(f.state,'async-pass-event-epoch',B.perCourtSchema);
   const batch=db.batch();batch.set(root,f.room);batch.set(pub,{bracketView:JSON.stringify(f.state),updatedAt:1});
   for(const bucket of B.encode(f.state,f.room.scoreStorage))batch.set(root.collection('matchBuckets').doc(bucket.bucketId),bucket);
   for(let n=1;n<=count;n++)batch.set(db.doc('users/ref'+n),f.user);await batch.commit();
   const current=async()=>{const room=(await root.get()).data(),all=await root.collection('matchBuckets').get();return {room,state:B.materialize(JSON.parse(room.data),room.scoreStorage,all.docs.map(s=>s.data()))};};
   const send=async(id,action,extra={})=>{const now=await current(),m=now.state.matches.find(m=>m.id===id);return score({auth:{uid:'ref'+m.station},data:request(now.state,now.room,id,action,'async-event-operation-'+(++serial),extra)});};
   await send('m3','score',{side:'A',finish:'extreme'});await send('m3','score',{side:'A',finish:'spin'});
   const before=await current(),pass=request(before.state,before.room,'m1','skip','async-event-operation-'+(++serial));
   const operations=[{auth:{uid:'ref1'},data:pass},...[['m2','pause',{}],['m3','confirm',{}],['m4','score',{side:'A',finish:'spin'}]].map(([id,action,extra])=>({auth:{uid:'ref'+before.state.matches.find(m=>m.id===id).station},data:request(before.state,before.room,id,action,'async-event-operation-'+(++serial),extra)}))];
   const results=await Promise.allSettled(operations.map(score));for(const result of results)assert.equal(result.status,'fulfilled',result.reason?.message);
   assert.equal(results[0].value.publicProjection,'deferred');
   const after=await current(),byId=id=>after.state.matches.find(m=>m.id===id);
   assert(byId('m1').skippedAt);assert.equal(byId('m1').dispatchRevision,1);assert.equal(byId('m2').status,'paused');
   assert.equal(byId('m3').completed,true);assert.equal(byId('m3').scoreA,4);assert.equal(byId('m4').scoreA,1);
   const rootBeforeReplay=await root.get(),audits=(await root.collection('bucketScoreAudit').get()).size;
   assert.equal((await score({auth:{uid:'ref1'},data:pass})).replayed,true);
   assert((await root.get()).updateTime.isEqual(rootBeforeReplay.updateTime));assert.equal((await root.collection('bucketScoreAudit').get()).size,audits);
   if(!automatic)await publish(code);
   await until(async()=>{const state=JSON.parse((await pub.get()).data().bracketView),match=id=>state.matches.find(m=>m.id===id);return match('m1').skippedAt===byId('m1').skippedAt&&match('m2').status==='paused'&&match('m3').completed&&match('m3').scoreA===4&&match('m4').scoreA===1;},'deferred PASS public state did not catch up');
   report.cases.push({name:'async-pass-with-score-pause-confirm',schema:B.perCourtSchema,courts:count,ackDoesNotRequirePublicWrite:true,automaticEventCatchup:automatic,explicitCatchup:!automatic,concurrentResultsVerified:true,replayPreservesRootAndAudit:true});
  }
 return report.cases;
}
module.exports={run};
