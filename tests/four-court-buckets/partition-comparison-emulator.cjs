'use strict';
// Test-only partition adapter: production schema/routing and room flags are unchanged.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
assert.equal(process.env.GCLOUD_PROJECT,'demo-bxh-four-court-buckets');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8188');
const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
const {fixture,request}=require('./trusted-fixture.cjs');
const {createEngine}=require('../../referee-seats/functions/engine/index.cjs');
const app=initializeApp({projectId:process.env.GCLOUD_PROJECT},'partition-comparison'),db=getFirestore(app);
const records=[],runs=[];let serial=0;
function adapter(width){
 assert([1,4].includes(width));
 const file=require.resolve('../../referee-seats/functions/bucket-state.cjs');
 let source=fs.readFileSync(file,'utf8');
 // Exact anchors prevent silently benchmarking an unadapted/changed layout.
 assert.equal((source.match(/Math\.ceil\(station\/4\)/g)||[]).length,1);
 assert.equal((source.match(/Math\.ceil\(count\/4\)/g)||[]).length,1);
 assert.equal((source.match(/Math\.ceil\(state\.meta\.stations\/4\)/g)||[]).length,1);
 if(width===1)source=source.replace("schema='bxh-match-buckets-v1'","schema='bxh-match-buckets-lab-per-court-v1'").replace('Math.ceil(station/4)','station').replace('Math.ceil(count/4)','count').replace('Math.ceil(state.meta.stations/4)','state.meta.stations');
 const module={exports:{}};vm.runInNewContext(source,{module},{filename:file});return module.exports;
}
function handler(B,metric){
 const file=require.resolve('../../referee-seats/functions/bucket-scoring-service.cjs'),local=createRequire(file),module={exports:{}};
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,console:{log(){}},require:id=>id==='./bucket-state.cjs'?B:local(id)},{filename:file});
 const observed={projectId:db.projectId,doc:p=>db.doc(p),runTransaction:(fn,...options)=>db.runTransaction(async tx=>{metric.attempts++;return await fn(tx);},...options)};
 return module.exports.createBucketScoringHandler(observed);
}
async function seed(players,courts,width,round,B){
 const code='BXH-PC'+players+'W'+width+'R'+round,f=fixture(code,courts,false);
 f.state.players=Array.from({length:players},(_,i)=>({id:'p'+i,name:'Synthetic '+i,checkedIn:true}));
 f.state.startedAt=null;
 const engine=createEngine(f.state,{uid:'host'},1000,'partition-draw-'+players,'same-layout-seed-'+players);
 assert(engine.generateSingleElim());f.state.startedAt=1;engine.rebuildCourtAssignments();
 f.room.scoreStorage=B.makeManifest(f.state,'partition-lab-'+width);f.room.data=JSON.stringify(f.state);
 const root=db.doc('tournaments/'+code),pub=db.doc('publicTournaments/'+code),batch=db.batch();
 batch.set(root,f.room);batch.set(pub,{bracketView:JSON.stringify(f.state),updatedAt:1});
 for(const b of B.encode(f.state,f.room.scoreStorage))batch.set(root.collection('matchBuckets').doc(b.bucketId),b);
 for(let i=1;i<=courts;i++)batch.set(db.doc('users/ref'+i),f.user);
 await batch.commit();return {...f,root,pub,players,courts};
}
async function measured(room,B,width,round,data){
 const metric={width,round,room:room.state.cloudCode,players:room.players,courts:room.courts,station:data.station,action:data.action,attempts:0},started=Date.now();
 try{const result=await handler(B,metric)({auth:{uid:'ref'+data.station},data});metric.ok=true;metric.replayed=result.replayed===true;return result;}
 catch(error){metric.ok=false;metric.errorCode=error.code??null;metric.reason=error.seatCode||'unclassified';throw error;}
 finally{metric.elapsedMs=Date.now()-started;records.push(metric);}
}
async function run(width,round){
 const B=adapter(width),rooms=[];
 for(const [players,courts]of [[128,5],[320,12]])rooms.push(await seed(players,courts,width,round,B));
 const before=await Promise.all(rooms.map(async room=>({root:await room.root.get(),pub:await room.pub.get()})));
 const started=Date.now(),outcomes=await Promise.allSettled(rooms.flatMap(room=>Array.from({length:room.courts},(_,i)=>i+1).map(async station=>{
  let state=structuredClone(room.state),last;
  const id=state.courtAssignments['court'+station].currentMatchId;assert(id);
  for(let index=0;index<4;index++){
   const data=request(state,room.room,id,index%2?'undo':'score','partition-lab-operation-'+String(++serial).padStart(8,'0'),index%2?{}:{side:'A',finish:'spin'});
   const result=await measured(room,B,width,round,data);assert(result.ok);
   state=B.materialize(room.state,room.room.scoreStorage,result.buckets,B.route(station,room.courts));
   const match=state.matches.find(m=>m.id===id);assert.equal(match.scoreA,index%2?0:1);assert.equal(match.log.length,index%2?0:1);
   last=data;
  }
  assert((await measured(room,B,width,round,last)).replayed);
 })));
 const entry={width,round,rooms:2,courts:17,acceptedTarget:68,elapsedMs:Date.now()-started,errors:outcomes.filter(r=>r.status==='rejected').map(r=>r.reason?.message)};
 runs.push(entry);assert.equal(entry.errors.length,0,JSON.stringify(entry.errors));
 for(let index=0;index<rooms.length;index++){
  const room=rooms[index];assert((await room.root.get()).updateTime.isEqual(before[index].root.updateTime));
  assert((await room.pub.get()).updateTime.isEqual(before[index].pub.updateTime));
  const buckets=await room.root.collection('matchBuckets').get(),final=B.materialize(room.state,room.room.scoreStorage,buckets.docs.map(s=>s.data()));
  for(let station=1;station<=room.courts;station++){
   const id=room.state.courtAssignments['court'+station].currentMatchId,m=final.matches.find(x=>x.id===id);
   assert.equal(m.scoreA,0);assert.equal(m.log.length,0);assert.equal(m.refereeSeatScoreRevision,4);
  }
  assert.equal((await room.root.collection('bucketScoreOperations').get()).size,room.courts*4);
  assert.equal((await room.root.collection('bucketScoreAudit').get()).size,room.courts*4);
 }
 entry.allScoresReceiptsAndReplayVerified=true;console.log(JSON.stringify(entry));
}
(async()=>{
 const report={kind:'trusted-core-partition-comparison',productionWrites:0,publicProjection:false,structuralCommands:false,testOnlyPerCourtSchema:true,runs,records};
 try{
  await db.doc('systemConfig/fourCourtScoreBuckets').set({enabled:true});
  // Reverse order on the second repeat to reduce simple warmup/order bias.
  for(const [width,round]of [[4,1],[1,1],[1,2],[4,2]])await run(width,round);
  report.ok=true;
 }finally{
  report.summary=[4,1].map(width=>{
   const rows=records.filter(r=>r.width===width&&!r.replayed),values=rows.filter(r=>r.ok).map(r=>r.elapsedMs).sort((a,b)=>a-b);
   return {width,attempted:rows.length,failed:rows.filter(r=>!r.ok).length,retries:rows.reduce((n,r)=>n+Math.max(0,r.attempts-1),0),latencyMs:{p50:values[Math.ceil(values.length*.5)-1]??null,p95:values[Math.ceil(values.length*.95)-1]??null,max:values.at(-1)??null}};
  });
  const dir=path.resolve('test-results/four-court-buckets');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'partition-comparison.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({...report,records:undefined}));await deleteApp(app);
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
