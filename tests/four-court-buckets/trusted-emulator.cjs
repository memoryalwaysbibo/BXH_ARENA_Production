'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8188');
assert.equal(process.env.GCLOUD_PROJECT,'demo-bxh-four-court-buckets');
const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
const B=require('../../referee-seats/functions/bucket-state.cjs'),{createBucketScoringHandler}=require('../../referee-seats/functions/bucket-scoring-service.cjs');
const {createBucketPublicProjection}=require('../../referee-seats/functions/bucket-public-projection.cjs');
const {fixture,request}=require('./trusted-fixture.cjs');
const app=initializeApp({projectId:process.env.GCLOUD_PROJECT},'trusted-bucket-lab'),db=getFirestore(app),commit=createBucketScoringHandler(db),publish=createBucketPublicProjection(db);
const report={kind:'trusted-scoring-bucket-emulator',productionWrites:0,cases:[]};let serial=0;
const operation=()=> 'trusted-operation-'+String(++serial).padStart(6,'0');
async function seed(code,count=6,bracket=true){
 const f=fixture(code,count,bracket),root=db.doc('tournaments/'+code),pub=db.doc('publicTournaments/'+code);
 await root.set(f.room);await pub.set({bracketView:JSON.stringify(f.state),updatedAt:1});
 for(const b of B.encode(f.state,f.room.scoreStorage))await root.collection('matchBuckets').doc(b.bucketId).set(b);
 for(let i=1;i<=count;i++)await db.doc('users/ref'+i).set(f.user);
 await db.doc('systemConfig/fourCourtScoreBuckets').set({enabled:true});
 return {root,pub};
}
async function read(root){
 const room=(await root.get()).data(),base=JSON.parse(room.data),m=B.context(room,base),buckets=await Promise.all(Array.from({length:m.bucketCount},(_,i)=>root.collection('matchBuckets').doc('court-'+(i+1)).get()));
 return {room,state:B.materialize(base,m,buckets.map(s=>s.data()))};
}
async function send(root,id,action,extra={}){
 const {room,state}=await read(root),d=request(state,room,id,action,operation(),extra);
 return commit({auth:{uid:'ref'+d.station},data:d});
}
(async()=>{
 const deadline=setTimeout(()=>{console.error('trusted-lab-timeout');process.exit(2);},240000);
 try{
  for(const count of [6,12]){
   const {root,pub}=await seed('BXH-TRUST'+count,count,false),before=await root.get(),publicBefore=await pub.get(),{room,state}=await read(root);
   const result=await Promise.all(state.matches.map(match=>commit({auth:{uid:'ref'+match.station},data:request(state,room,match.id,'score',operation(),{side:'A',finish:'spin'})})));
   assert(result.every(r=>r.ok&&!r.structural&&!r.state));
   const latest=await read(root);assert(latest.state.matches.every(m=>m.scoreA===1&&m.log.length===1&&m.refereeSeatScoreRevision===1));
   assert((await root.get()).updateTime.isEqual(before.updateTime),'local score rewrote shared root');
   assert((await pub.get()).updateTime.isEqual(publicBefore.updateTime),'local score rewrote public mirror');
   assert.equal((await root.collection('bucketScoreAudit').get()).size,count);
   const projections=await Promise.all([publish(state.cloudCode),publish(state.cloudCode)]);
   assert.equal(projections.filter(x=>!x.skipped).length,1,'same generation must only be materialized once');
   const publicState=JSON.parse((await pub.get()).data().bracketView);assert(publicState.matches.every(m=>m.scoreA===1&&m.log.length===1));
   assert((await root.get()).updateTime.isEqual(before.updateTime),'publication rewrote root');
   await send(root,'m1','score',{side:'B',finish:'burst'});await publish(state.cloudCode);
   const newest=JSON.parse((await pub.get()).data().bracketView);assert.equal(newest.matches[0].scoreB,2);
   assert(newest.matches.slice(1).every(m=>m.scoreA===1&&m.scoreB===0),'publication lost another court');
   assert((await publish(state.cloudCode)).skipped,'unchanged generations should not republish');
   await send(root,'m1','pause');await publish(state.cloudCode);
   assert.equal(JSON.parse((await pub.get()).data().bracketView).courtAssignments.court1.status,'paused');
   await send(root,'m1','resume');await publish(state.cloudCode);
   assert.equal(JSON.parse((await pub.get()).data().bracketView).courtAssignments.court1.status,'in_progress');
   assert((await root.get()).updateTime.isEqual(before.updateTime));
   report.cases.push({name:'trusted-concurrent',courts:count,buckets:Math.ceil(count/4),success:result.length,rootUnchanged:true,publicUnchanged:true});
   report.cases.push({name:'public-projection',courts:count,concurrentWritersDeduplicated:true,newScoresVisible:true,rootUnchanged:true});
  }
  {
   const {root,pub}=await seed('BXH-CROSS1');
   for(const id of ['m1','m2']){await send(root,id,'score',{side:'A',finish:'extreme'});await send(root,id,'score',{side:'A',finish:'spin'});}
   const before=await read(root),commands=['m1','m2'].map(id=>{const d=request(before.state,before.room,id,'confirm',operation());return {auth:{uid:'ref'+d.station},data:d};});
   await Promise.all(commands.map(d=>commit(d)));
   const after=await read(root),final=after.state.matches.find(m=>m.id==='final');
   assert.equal(final.a.playerId,'a');assert.equal(final.b.playerId,'c');assert.equal(final.station,5);
   const publicState=JSON.parse((await pub.get()).data().bracketView);
   assert.equal(publicState.matches.find(m=>m.id==='final').b.playerId,'c');
   assert(after.state.matches.filter(m=>['m1','m2'].includes(m.id)).every(m=>m.completed&&m.hunterData.analyzable));
   await send(root,'final','score',{side:'B',finish:'extreme'});await send(root,'final','score',{side:'B',finish:'spin'});await send(root,'final','confirm');
   const complete=await read(root);assert.equal(complete.state.championId,'c');assert.equal(complete.state.runnerUpId,'a');
   assert.equal((await db.collection('staffActivityLogs/ref5/matches').where('tournamentCode','==','BXH-CROSS1').get()).size,2);
   report.cases.push({name:'cross-bucket-confirm-and-final',passed:true,champion:'c',sourceBuckets:2});
  }
  {
   const {root}=await seed('BXH-REPLAY1'),{room,state}=await read(root),d=request(state,room,'m1','score',operation(),{side:'A',finish:'spin'}),req={auth:{uid:'ref1'},data:d};
   const replies=await Promise.all([commit(req),commit(req)]);
   assert(replies.some(x=>x.replayed===true));assert.equal((await read(root)).state.matches[0].scoreA,1);assert.equal((await root.collection('bucketScoreAudit').get()).size,1);
   await assert.rejects(commit({auth:req.auth,data:{...d,finish:'burst'}}),/operation-conflict/);
   await assert.rejects(commit({auth:req.auth,data:{...d,operationId:operation()}}),/score-stale/);
   await assert.rejects(commit({auth:{uid:'ref2'},data:{...d,operationId:operation()}}),/station-not-assigned/);
   const revoked=structuredClone(room.refereeSeatsV1);revoked.courts['1'].main=null;await root.update({refereeSeatsV1:revoked});
   await assert.rejects(commit(req),/station-not-assigned/);
   report.cases.push({name:'lost-reply-conflict-stale-revoked-seat',passed:true});
  }
  {
   const {root}=await seed('BXH-EPOCH1'),{room,state}=await read(root),d=request(state,room,'m1','score',operation(),{side:'A',finish:'spin'});
   await root.collection('matchBuckets').doc('court-1').update({epoch:'wrong-generation'});
   await assert.rejects(commit({auth:{uid:'ref1'},data:d}),/bucket-context/);
   await db.doc('systemConfig/fourCourtScoreBuckets').set({enabled:false});
   await assert.rejects(commit({auth:{uid:'ref1'},data:d}),/release-not-ready/);
   report.cases.push({name:'epoch-and-closed-release',passed:true});
  }
  console.log('PASS trusted bucket adapter: '+JSON.stringify(report));
 }catch(e){console.error(e);report.error=e.message;process.exitCode=1;}
 finally{
  const dir=path.resolve('test-results/four-court-buckets');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'trusted-results.json'),JSON.stringify(report,null,2)+'\n');
  clearTimeout(deadline);await deleteApp(app);
 }
})();
