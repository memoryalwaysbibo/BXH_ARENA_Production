'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),B=require('../../referee-seats/functions/bucket-state.cjs'),{createBucketScoringHandler}=require('../../referee-seats/functions/bucket-scoring-service.cjs'),{roomFixture,command}=require('./dispatch-fixture.cjs');
function setup(count=6){
 const f=roomFixture('BXH-DISPATCH'+count,count),root='tournaments/'+f.state.cloudCode,docs=new Map([[root,f.room],['publicTournaments/'+f.state.cloudCode,{bracketView:JSON.stringify(f.state),updatedAt:1}],['users/host',f.user],['users/ref1',f.user],['users/ref5',f.user],['users/ref2',f.user],['systemConfig/fourCourtScoreBuckets',{enabled:true}]]);
 for(const b of B.encode(f.state,f.room.scoreStorage))docs.set(root+'/matchBuckets/'+b.bucketId,b);
 const ref=path=>({path,collection:name=>({doc:id=>ref(path+'/'+name+'/'+id)})});let seq=1;
 const db={projectId:'demo-bxh-four-court-buckets',doc:ref,async runTransaction(run){const writes=[];const get=async ref=>{assert.equal(writes.length,0,'transaction read after write');const data=docs.get(ref.path);return {exists:!!data,data:()=>structuredClone(data)};};const result=await run({get,getAll:(...refs)=>Promise.all(refs.map(get)),set:(r,d)=>writes.push([r.path,d]),update:(r,d)=>writes.push([r.path,{...docs.get(r.path),...d}]),create:(r,d)=>{assert(!docs.has(r.path));writes.push([r.path,d]);}});for(const [p,d]of writes)docs.set(p,structuredClone(d));return result;}};
 const previous=process.env.FIRESTORE_EMULATOR_HOST;process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8188';let commit;try{commit=createBucketScoringHandler(db,{clock:()=>1000+seq++});}finally{if(previous===undefined)delete process.env.FIRESTORE_EMULATOR_HOST;else process.env.FIRESTORE_EMULATOR_HOST=previous;}
 function read(){const room=docs.get(root),state=B.materialize(JSON.parse(room.data),room.scoreStorage,Array.from({length:room.scoreStorage.bucketCount},(_,i)=>docs.get(root+'/matchBuckets/court-'+(i+1))));return {room,state};}
 const send=(uid,data)=>commit({auth:{uid},data});return {docs,root,read,send,cmd:(action,id,extra={})=>command(read(),action,id,'dispatch-operation-'+seq++,extra)};
}
function prepare(h,mutate){const f=h.read();mutate(f.state);f.room.data=JSON.stringify(f.state);h.docs.set(h.root,f.room);for(const b of B.encode(f.state,f.room.scoreStorage))h.docs.set(h.root+'/matchBuckets/'+b.bucketId,b);}
for(const count of [6,12])test(count+' courts: cross-bucket swap keeps canonical score/ledger and replay performs no writes',async()=>{
 const h=setup(count),score={code:h.read().state.cloudCode,action:'score',matchId:'m2',station:2,operationId:'dispatch-initial-score',expectedCourtRevision:1,expectedScoreRevision:0,expectedDispatchRevision:0,playerAId:'a1',playerBId:'b1',side:'A',finish:'burst'};
 await h.send('ref2',score);const d=h.cmd('swap','m1',{targetMatchId:'m5'}),result=await h.send('host',d),after=h.read();assert.equal(result.lifecycleRevision,1);assert.equal(after.state.matches[0].station,5);assert.equal(after.state.matches[1].scoreA,2);assert.equal(after.state.matches[1].log.length,1);assert.equal(after.state.matches.find(m=>m.id==='m5').station,1);
 const all=JSON.stringify([...h.docs]);assert.equal((await h.send('host',d)).replayed,true);assert.equal(JSON.stringify([...h.docs]),all);assert.equal([...h.docs.keys()].filter(p=>p.startsWith('staffActivityLogs/')).length,0);
 assert.equal(JSON.parse(h.docs.get('publicTournaments/'+after.state.cloudCode).bracketView).matches[1].scoreA,2);
 await assert.rejects(h.send('host',{...d,targetMatchId:'m6'}),/operation-conflict/);await assert.rejects(h.send('ref2',{...score,operationId:'dispatch-stale-score'}),/score-stale/);
});
test('force exit detaches latest score, reopen and cross-bucket reattach preserve ledger',async()=>{
 const h=setup();let d=h.cmd('force-exit','m1',{expectedExitRevision:0});await h.send('ref1',d);assert.equal(h.read().state.matches[0].station,0);assert(h.read().state.matches[0].forceDetached);assert(!JSON.parse(h.docs.get(h.root+'/matchBuckets/court-1').matches).some(m=>m.id==='m1'));
 await h.send('host',h.cmd('reopen',null,{station:1,expectedExitRevision:1}));await h.send('host',h.cmd('claim-detached','m1',{targetStation:5}));assert.equal(h.read().state.matches[0].station,5);assert.equal(h.read().state.matches[0].forceDetached,undefined);assert.equal(h.read().state.courtLifecycleEpoch,3);
});
test('stale versions, revoked replay authority, PASS, unsupported resize and missing bucket commit nothing',async()=>{
 const h=setup(),d=h.cmd('swap','m1',{targetMatchId:'m5'}),before=JSON.stringify([...h.docs]);
 for(const bad of [{...d,expectedScoreRevision:99},{...d,expectedDispatchRevision:99},{...d,expectedCourtRevisions:{1:99,5:1}},{...d,playerAId:'other'},{...d,action:'resize'}])await assert.rejects(h.send('host',bad),/score-stale|dispatch-stale|seat-stale|player-mismatch|unsupported-bucket-action/);
 assert.equal(JSON.stringify([...h.docs]),before);await h.send('host',d);h.docs.set('users/host',{active:false,role:'staff'});await assert.rejects(h.send('host',d),/station-not-assigned/);
 const fresh=setup(),bucket=fresh.docs.get(fresh.root+'/matchBuckets/court-1'),rows=JSON.parse(bucket.matches);rows[0].callPass={waitFor:['m2']};bucket.matches=JSON.stringify(rows);await assert.rejects(fresh.send('host',fresh.cmd('swap','m1',{targetMatchId:'m5'})),/pass-protected/);
 const missing=fresh.cmd('reopen',null,{station:1,expectedExitRevision:1});fresh.docs.delete(fresh.root+'/matchBuckets/court-2');await assert.rejects(fresh.send('host',missing),/bucket-context/);
});
test('manual assignment, idle claim and skipped claim move complete match records across bucket boundary',async()=>{
 for(const action of ['manual-assign','idle-claim','claim-skipped']){
  const h=setup();prepare(h,state=>{state.matches[0].status='pending';if(action!=='manual-assign'){state.courtAssignments.court1.currentMatchId=null;state.courtAssignments.court5.currentMatchId=null;}if(action==='claim-skipped')state.matches[0].skippedAt=10;});
  await h.send('host',h.cmd(action,'m1',{targetStation:5}));const f=h.read();assert.equal(f.state.matches[0].station,5);assert.equal(f.state.matches[0].refereeSeatScoreRevision,1);assert(JSON.parse(h.docs.get(h.root+'/matchBuckets/court-2').matches).some(m=>m.id==='m1'));assert(!JSON.parse(h.docs.get(h.root+'/matchBuckets/court-1').matches).some(m=>m.id==='m1'));
 }
});
test('retirement transfer preserves an active physical count, but a transition that shrinks it commits nothing',async()=>{
 const h=setup();prepare(h,state=>{state.matches.find(m=>m.id==='m5').status='paused';state.matches.find(m=>m.id==='m6').status='paused';state.courtRetirementPlan={targetCount:4,revision:1,courts:{5:{status:'draining'},6:{status:'draining'}}};});
 await h.send('host',h.cmd('retirement-transfer','m5',{targetStation:1}));assert.equal(h.read().state.meta.stations,6);assert.equal(h.read().state.matches.find(m=>m.id==='m5').station,1);
 const before=JSON.stringify([...h.docs]);await assert.rejects(h.send('host',h.cmd('retirement-transfer','m6',{targetStation:1})),/bucket-court-count-change-required/);assert.equal(JSON.stringify([...h.docs]),before);
});
test('swap replay rechecks both original court permissions even after the matches exchanged stations',async()=>{
 const h=setup(),room=h.docs.get(h.root);room.refereeSeatsV1.courts['5'].backup1={uid:'ref1'};const d=h.cmd('swap','m1',{targetMatchId:'m5'});await h.send('ref1',d);h.docs.get(h.root).refereeSeatsV1.courts['5'].backup1=null;const before=JSON.stringify([...h.docs]);await assert.rejects(h.send('ref1',d),/station-not-assigned/);assert.equal(JSON.stringify([...h.docs]),before);
});
