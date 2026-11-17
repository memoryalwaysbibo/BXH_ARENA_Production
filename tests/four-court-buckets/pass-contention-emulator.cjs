'use strict';
// Trusted server transactions against an isolated Emulator, never production.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
assert.equal(process.env.GCLOUD_PROJECT,'demo-bxh-four-court-buckets');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8188');
const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
const B=require('../../referee-seats/functions/bucket-state.cjs');
const {createEngine}=require('../../referee-seats/functions/engine/index.cjs');
const {createBucketScoringHandler}=require('../../referee-seats/functions/bucket-scoring-service.cjs');
const {createBucketPublicProjection}=require('../../referee-seats/functions/bucket-public-projection.cjs');
const {fixture,request}=require('./trusted-fixture.cjs');
const targetSchema=process.env.BXH_SCORE_LAB_SCHEMA||B.schema;assert([B.schema,B.perCourtSchema].includes(targetSchema));
const app=initializeApp({projectId:process.env.GCLOUD_PROJECT},'pass-contention-test'),db=getFirestore(app);
const records=[];let serial=0;
const op=()=> 'mixed-pass-operation-'+String(++serial).padStart(8,'0');
const cycles=2;
async function seed(players,courts){
 const f=fixture('BXH-MIX'+players+(targetSchema===B.perCourtSchema?'V2':''),courts,false);
 f.state.players=Array.from({length:players},(_,i)=>({id:'p'+i,name:'Synthetic '+i,checkedIn:true}));
 f.state.startedAt=null;
 const engine=createEngine(f.state,{uid:'host'},1000,'draw-'+players,'synthetic-fixed-seed-'+players);
 assert(engine.generateSingleElim());f.state.startedAt=1;engine.rebuildCourtAssignments();
 f.room.scoreStorage=B.makeManifest(f.state,'mixed-pass-epoch-'+players,targetSchema);f.room.data=JSON.stringify(f.state);
 const root=db.doc('tournaments/'+f.state.cloudCode),pub=db.doc('publicTournaments/'+f.state.cloudCode),batch=db.batch();
 batch.set(root,f.room);batch.set(pub,{bracketView:JSON.stringify(f.state),updatedAt:1});
 for(const b of B.encode(f.state,f.room.scoreStorage))batch.set(root.collection('matchBuckets').doc(b.bucketId),b);
 for(let i=1;i<=courts;i++)batch.set(db.doc('users/ref'+i),f.user);
 await batch.commit();return {...f,root,pub,players,courts};
}
async function read(room){
 // Fixture observation must be coherent across a simultaneous structural PASS.
 return db.runTransaction(async tx=>{
  const root=(await tx.get(room.root)).data();
  const buckets=await tx.getAll(...Array.from({length:root.scoreStorage.bucketCount},(_,i)=>room.root.collection('matchBuckets').doc('court-'+(i+1))));
  return {room:root,state:B.materialize(JSON.parse(root.data),root.scoreStorage,buckets.map(s=>s.data()))};
 });
}
async function measured(room,command){
 let attempts=0;const attemptTimings=[];
 const observed={projectId:db.projectId,doc:p=>db.doc(p),runTransaction:(fn,...options)=>db.runTransaction(async tx=>{
  attempts++;const timing={attempt:attempts,startedMs:Date.now(),readMs:0};attemptTimings.push(timing);
  const wrapped=new Proxy(tx,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;
   if(key==='get'||key==='getAll')return async(...args)=>{const began=Date.now();try{return await value.apply(target,args);}finally{timing.readMs+=Date.now()-began;}};
   return value.bind(target);
  }});
  try{return await fn(wrapped);}finally{timing.callbackEndedMs=Date.now();timing.callbackMs=timing.callbackEndedMs-timing.startedMs;}
 },...options)};
 const record={room:room.state.cloudCode,station:command.station,action:command.action,operationId:command.operationId},start=Date.now();
 try{
  const result=await createBucketScoringHandler(observed)({auth:{uid:'ref'+command.station},data:command});
  Object.assign(record,{ok:true,replayed:result.replayed===true});return result;
 }catch(error){Object.assign(record,{ok:false,errorCode:error.code??null,reason:error.seatCode||'unclassified'});throw error;}
 finally{const endedMs=Date.now();Object.assign(record,{elapsedMs:endedMs-start,attempts,attemptTimings:attemptTimings.map((t,i)=>({attempt:t.attempt,readMs:t.readMs,callbackMs:t.callbackMs,afterCallbackMs:(attemptTimings[i+1]?.startedMs??endedMs)-t.callbackEndedMs}))});records.push(record);}
}
async function workload(room){
 const initial=await read(room),passMatch=initial.state.matches.find(m=>m.id===initial.state.courtAssignments.court1.currentMatchId);
 assert(passMatch,'court 1 requires a real current match');
 const pass=request(initial.state,initial.room,passMatch.id,'skip',op());
 const scoreTasks=Array.from({length:room.courts-1},(_,i)=>i+2).map(async station=>{
  let state=structuredClone(initial.state);
  const id=state.courtAssignments['court'+station].currentMatchId;assert(id);
  for(let i=0;i<cycles*2;i++){
   const command=request(state,initial.room,id,i%2?'undo':'score',op(),i%2?{}:{side:'A',finish:'spin'});
   const result=await measured(room,command);assert(result.ok);
   state=(await read(room)).state;
   const match=state.matches.find(m=>m.id===id);assert.equal(match.scoreA,i%2?0:1);assert.equal(match.log.length,i%2?0:1);
  }
  return id;
 });
 // PASS, other courts' score/undo and publication intentionally overlap.
 const passTask=measured(room,pass);
 const publishTask=(async()=>{for(let i=0;i<cycles;i++){for(let attempt=0;;attempt++){try{assert((await createBucketPublicProjection(db)(room.state.cloudCode)).ok);break;}catch(error){if(error.message!=='projection-source-changed'||attempt>=2)throw error;}}}})();
 const results=await Promise.allSettled([...scoreTasks,passTask,publishTask]);
 const errors=results.filter(r=>r.status==='rejected');assert.equal(errors.length,0,JSON.stringify(errors.map(r=>r.reason?.message)));
 const beforeReplay=await room.root.get(),auditBefore=await room.root.collection('bucketScoreAudit').get();
 const replay=await measured(room,pass);assert(replay.replayed);
 assert((await room.root.get()).updateTime.isEqual(beforeReplay.updateTime));
 assert.equal((await room.root.collection('bucketScoreAudit').get()).size,auditBefore.size);
 const latest=await read(room),skipped=latest.state.matches.find(m=>m.id===passMatch.id);
 assert(skipped.skippedAt);assert.equal(skipped.dispatchRevision,1);assert.equal(skipped.refereeSeatScoreRevision,1);
 assert.notEqual(latest.state.courtAssignments.court1.currentMatchId,skipped.id);
 for(const item of results.slice(0,room.courts-1)){
  const match=latest.state.matches.find(m=>m.id===item.value);
  assert.equal(match.scoreA,0);assert.equal(match.log.length,0);assert.equal(match.refereeSeatScoreRevision,cycles*2);
 }
 const accepted=(room.courts-1)*cycles*2+1;
 assert.equal(auditBefore.size,accepted);assert.equal((await room.root.collection('bucketScoreOperations').get()).size,accepted);
 await createBucketPublicProjection(db)(room.state.cloudCode);
 const publicDoc=(await room.pub.get()).data(),publicState=JSON.parse(publicDoc.bracketView);
 for(const match of latest.state.matches){
  const published=publicState.matches.find(m=>m.id===match.id);assert(published);
  assert.equal(published.scoreA,match.scoreA);assert.equal(published.scoreB,match.scoreB);
  assert.equal(published.skippedAt||null,match.skippedAt||null);
 }
 return {players:room.players,courts:room.courts,matches:latest.state.matches.length,acceptedOperations:accepted,passReplaySafe:true,allScoresAndReceiptsVerified:true,publicCatchupVerified:true};
}
(async()=>{
 const report={kind:'two-room-score-pass-projection-contention',storageSchema:targetSchema,environment:'Firestore Emulator',productionWrites:0,cycles,records};
 try{
  await db.doc('systemConfig/fourCourtScoreBuckets').set({enabled:true});
  const rooms=[];for(const [players,courts] of [[128,5],[320,12]])rooms.push(await seed(players,courts));
  const runs=await Promise.allSettled(rooms.map(workload));
  report.rooms=runs.map(r=>r.status==='fulfilled'?r.value:{failed:true,message:r.reason?.message});
  report.ok=runs.every(r=>r.status==='fulfilled');
  const values=records.filter(r=>r.ok&&!r.replayed).map(r=>r.elapsedMs).sort((a,b)=>a-b);
  report.latencyMs={p50:values[Math.ceil(values.length*.5)-1]??null,p95:values[Math.ceil(values.length*.95)-1]??null,max:values.at(-1)??null};
  report.failedOperations=records.filter(r=>!r.ok).length;
  report.transactionRetries=records.reduce((sum,r)=>sum+Math.max(0,r.attempts-1),0);
  const dir=path.resolve('test-results/four-court-buckets');fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,targetSchema===B.perCourtSchema?'pass-contention-v2.json':'pass-contention.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({...report,records:undefined}));assert(report.ok,'mixed score/PASS workload failed; inspect pass-contention.json');
 }finally{await deleteApp(app);}
})().catch(error=>{console.error(error);process.exitCode=1;});
