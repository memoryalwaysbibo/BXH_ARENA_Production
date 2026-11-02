'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8188');assert.equal(process.env.GCLOUD_PROJECT,'demo-bxh-four-court-buckets');
const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),B=require('../../referee-seats/functions/bucket-state.cjs'),{createBucketScoringHandler}=require('../../referee-seats/functions/bucket-scoring-service.cjs'),{roomFixture,command}=require('./dispatch-fixture.cjs'),{request}=require('./trusted-fixture.cjs');
const app=initializeApp({projectId:process.env.GCLOUD_PROJECT},'bucket-dispatch'),db=getFirestore(app),commit=createBucketScoringHandler(db);let serial=0;const op=()=> 'dispatch-emulator-'+String(++serial).padStart(6,'0');
async function seed(code,count){const f=roomFixture(code,count),root=db.doc('tournaments/'+code);await root.set(f.room);await db.doc('publicTournaments/'+code).set({bracketView:JSON.stringify(f.state),updatedAt:1});for(const b of B.encode(f.state,f.room.scoreStorage))await root.collection('matchBuckets').doc(b.bucketId).set(b);for(const uid of ['host',...Array.from({length:count},(_,i)=>'ref'+(i+1))])await db.doc('users/'+uid).set(f.user);await db.doc('systemConfig/fourCourtScoreBuckets').set({enabled:true});return root;}
async function read(root){const room=(await root.get()).data(),buckets=await Promise.all(Array.from({length:room.scoreStorage.bucketCount},(_,i)=>root.collection('matchBuckets').doc('court-'+(i+1)).get()));return {room,state:B.materialize(JSON.parse(room.data),room.scoreStorage,buckets.map(s=>s.data()))};}
const send=(uid,data)=>commit({auth:{uid},data});
async function dispatch(root,action,id,extra={},uid='host'){return send(uid,command(await read(root),action,id,op(),extra));}
async function score(root,id,finish='spin'){const f=await read(root),d=request(f.state,f.room,id,'score',op(),{side:'A',finish});return send('ref'+d.station,d);}
(async()=>{const report={kind:'bucket-dispatch-emulator',productionWrites:0,cases:[]};try{
 for(const count of [6,12]){
  const root=await seed('BXH-DMOVE'+count,count);await score(root,'m1','burst');await score(root,'m5');const before=await read(root);assert.equal(JSON.parse(before.room.data).matches[0].scoreA,0);
  const d=command(before,'force-exit','m1',op(),{expectedExitRevision:0});await send('ref1',d);let latest=await read(root);assert.equal(latest.state.matches[0].station,0);assert.equal(latest.state.matches[0].scoreA,2);assert.equal(latest.state.matches[0].log.length,1);assert.equal(latest.state.matches.find(m=>m.id==='m5').scoreA,1);
  const baseline=await root.get(),buckets=await root.collection('matchBuckets').get();assert.equal((await send('ref1',d)).replayed,true);assert((await root.get()).updateTime.isEqual(baseline.updateTime));const same=await root.collection('matchBuckets').get();buckets.docs.forEach((b,i)=>assert(b.updateTime.isEqual(same.docs[i].updateTime)));
  await dispatch(root,'reopen',null,{station:1,expectedExitRevision:1});await dispatch(root,'claim-detached','m1',{targetStation:5});latest=await read(root);assert.equal(latest.state.matches[0].station,5);assert.equal(latest.state.matches[0].scoreA,2);assert.equal(latest.state.matches[0].log.length,1);assert.equal(latest.state.matches.find(m=>m.id==='m5').scoreA,1);assert.equal(latest.state.courtLifecycleEpoch,3);
  assert(JSON.parse((await root.collection('matchBuckets').doc('court-2').get()).data().matches).some(m=>m.id==='m1'&&m.scoreA===2));assert(!JSON.parse((await root.collection('matchBuckets').doc('court-1').get()).data().matches).some(m=>m.id==='m1'));
  const publicState=JSON.parse((await db.doc('publicTournaments/'+root.id).get()).data().bracketView);assert.equal(publicState.matches[0].station,5);assert.equal(publicState.matches[0].scoreA,2);assert.equal(publicState.meta.refereeSeatsV1,undefined);assert.equal((await db.collection('staffActivityLogs/host/matches').get()).size,0);
  await db.doc('users/ref1').update({active:false});await assert.rejects(send('ref1',d),/station-not-assigned/);await db.doc('users/ref1').update({active:true});
  report.cases.push({courts:count,buckets:Math.ceil(count/4),latestScoresPreserved:true,detachReopenReattach:true,crossBucketMove:true,noDuplicateReplayWrites:true,revokedReplayDenied:true,noFalseDutyLog:true,publicMirrorCurrent:true});
 }
 {
  const root=await seed('BXH-DSWAP6',6);await score(root,'m2','burst');const original=await read(root),d=command(original,'swap','m1',op(),{targetMatchId:'m5'});await send('host',d);const latest=await read(root);assert.equal(latest.state.matches[0].station,5);assert.equal(latest.state.matches.find(m=>m.id==='m5').station,1);assert.equal(latest.state.matches.find(m=>m.id==='m2').scoreA,2);assert.equal(latest.state.matches.find(m=>m.id==='m2').log.length,1);
  const before=await root.get();await assert.rejects(send('host',{...d,operationId:op()}),/score-stale|station-mismatch|dispatch-stale/);await assert.rejects(dispatch(root,'resize',null,{station:1,count:0}),/invalid-court-count/);assert((await root.get()).updateTime.isEqual(before.updateTime));report.crossBucketSwap={untouchedCourtScorePreserved:true,staleCommandDenied:true,invalidResizeDenied:true};
 }
 {
  const root=await seed('BXH-DRACE6',6),f=await read(root),s=request(f.state,f.room,'m1','score',op(),{side:'A',finish:'spin'}),d=command(f,'force-exit','m1',op(),{expectedExitRevision:0});
  const [scored,exited]=await Promise.allSettled([send('ref1',s),send('ref1',d)]);if(exited.status==='rejected'){assert.match(exited.reason.message,/score-stale/);await dispatch(root,'force-exit','m1',{expectedExitRevision:0},'ref1');}
  const latest=await read(root),m=latest.state.matches.find(m=>m.id==='m1');assert.equal(m.station,0);assert.equal(m.scoreA,scored.status==='fulfilled'?1:0);assert.equal(m.log.length,m.scoreA);report.scoreRace={acknowledgedScorePreserved:true,accepted:scored.status==='fulfilled',score:m.scoreA};
 }
 {
  const root=await seed('BXH-DCOUNT6',6),f=await read(root);for(const m of f.state.matches.filter(m=>m.station>=5))m.status='paused';f.state.courtRetirementPlan={targetCount:4,revision:1,courts:{5:{status:'draining'},6:{status:'draining'}}};await root.update({data:JSON.stringify(f.state)});for(const b of B.encode(f.state,f.room.scoreStorage))await root.collection('matchBuckets').doc(b.bucketId).set(b);
  await dispatch(root,'retirement-transfer','m5',{targetStation:1});await dispatch(root,'retirement-transfer','m6',{targetStation:1});const after=await read(root);assert.equal(after.state.meta.stations,4);assert.equal(after.room.scoreStorage.bucketCount,1);assert.equal((await root.collection('matchBuckets').doc('court-2').get()).exists,false);assert.equal((await db.doc('publicTournaments/'+root.id).get()).data().scoreBucketProjection.versions['court-2'],undefined);report.manifestCountChange={drained:true,removedBucketAndUpdatedPublic:true};
 }
 for(const count of [4,8]){
  const root=await seed('BXH-DGROW'+count,count),f=await read(root),request=command(f,'resize',null,op(),{count:count+1,expectedTarget:count,expectedPlanRevision:0});
  await send('host',request);const after=await read(root);assert.equal(after.state.meta.stations,count+1);assert.equal(after.room.scoreStorage.bucketCount,Math.ceil((count+1)/4));assert.equal((await send('host',request)).replayed,true);report.cases.push({growth:count+'→'+(count+1),newBucketCreated:true,replaySafe:true});
 }
 fs.mkdirSync('test-results/four-court-buckets',{recursive:true});fs.writeFileSync(path.resolve('test-results/four-court-buckets/dispatch.json'),JSON.stringify(report,null,2)+'\n');console.log('PASS bucket dispatch: '+JSON.stringify(report));
}finally{await deleteApp(app);}})().catch(error=>{console.error(error);process.exitCode=1;});
