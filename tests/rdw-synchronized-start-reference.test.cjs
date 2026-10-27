const {buildRosterSnapshot}=require('../scripts/lib/rdw-roster-tier-snapshot.cjs');
const makeSnapshot=(eventCode,drawRevision,rosterUids)=>buildRosterSnapshot({eventCode,drawRevision,rosterUids,capturedAt:150,verifiedTiers:rosterUids.map(uid=>({ok:true,uid,tier:'d',computedAt:100,sourceScope:'public-official-canonical-self-history-v1',sourceDigest:'a'.repeat(64)}))});
const test=require('node:test'),assert=require('node:assert/strict');
const {writeSynchronizedStart}=require('../scripts/lib/rdw-synchronized-start-reference.cjs');
const code='BXH-ABC123',eventRef={id:'private'},publicRef={id:'public'},snapshotRef={id:'snapshot'};
function fixture({general=false,stale=false,missingSnapshot=false}={}){
 const p={cloudCode:code,registrationRosterRevision:4,meta:{ladderMode:general?'general':'ranked',eventAuthority:'official',stations:1},players:[{id:'p1',uid:'u1'},{id:'p2',uid:'u2'}],matches:[{id:'m1',a:{playerId:'p1'},b:{playerId:'p2'},completed:false}],drawnAt:100,startedAt:null,rosterLocked:false};
 const q={cloudCode:code,registrationRosterRevision:stale?3:4,players:[{id:'p1'},{id:'p2'}],matches:[{id:'m1',a:{playerId:'p1'},b:{playerId:'p2'},completed:false}],drawnAt:100,startedAt:null};
 const dispatchCandidate={matches:p.matches,courtAssignments:{court1:{currentMatchId:'m1',nextMatchId:null}}};
 const doc={private:{code,data:JSON.stringify(p)},public:{bracketView:JSON.stringify(q)},snapshot:makeSnapshot(code,9,['u1','u2'])};
 const reads=[],writes=[];const tx={get:async ref=>{reads.push(ref.id);return {exists:ref.id!=='snapshot'||!missingSnapshot,data:()=>doc[ref.id]};},update:(ref,payload)=>{writes.push({id:ref.id,payload});}};
 return {tx,reads,writes,args:{tx,eventRef,publicRef,snapshotRef,eventCode:code,expectedRosterRevision:4,drawRevision:9,serverTime:200,authorized:true,bracketVerified:true,dispatchCandidate}};
}
test('atomic writer updates both mirror JSON records only after all reads',async()=>{
 const f=fixture(),result=await writeSynchronizedStart(f.args);
 assert.equal(result.committed,true);
 assert.deepEqual(f.reads,['private','public','snapshot']);
 assert.deepEqual(f.writes.map(w=>w.id),['private','public']);
 assert.equal(JSON.parse(f.writes[0].payload.data).startedAt,200);
 assert.equal(JSON.parse(f.writes[0].payload.data).rosterLocked,true);
 assert.equal(JSON.parse(f.writes[0].payload.data).rdwSnapshotDigest,makeSnapshot(code,9,['u1','u2']).snapshotDigest);
 assert.equal(f.writes[0].payload.rdwSnapshotDigest,makeSnapshot(code,9,['u1','u2']).snapshotDigest);
 assert.equal(JSON.parse(f.writes[1].payload.bracketView).startedAt,200);
});
test('general room, stale mirror and missing snapshot are never written',async()=>{
 for(const cfg of [{general:true},{stale:true},{missingSnapshot:true}]){
  const f=fixture(cfg),result=await writeSynchronizedStart(f.args);
  assert.equal(result.committed,false);assert.equal(f.writes.length,0);
 }
});
test('unverified caller and wrong snapshot draw revision cannot write',async()=>{
 const f=fixture();assert.equal((await writeSynchronizedStart({...f.args,authorized:false})).committed,false);
 const g=fixture();assert.equal((await writeSynchronizedStart({...g.args,drawRevision:10})).committed,false);
 assert.equal(f.writes.length+g.writes.length,0);
});

test('server dispatch is mandatory and failures never produce writes',async()=>{
 const f=fixture();const result=await writeSynchronizedStart({...f.args,dispatchCandidate:null});
 assert.equal(result.committed,false);assert.equal(result.reason,'server-dispatch-unavailable');assert.equal(f.writes.length,0);
 const g=fixture();const bad={matches:g.args.dispatchCandidate.matches,courtAssignments:{}};
 const rejected=await writeSynchronizedStart({...g.args,dispatchCandidate:bad});
 assert.equal(rejected.committed,false);assert.equal(rejected.reason,'missing-court');assert.equal(g.writes.length,0);
});

test('start locks registration and required check-in in both mirrors without exposing private match/court fields',async()=>{
 const f=fixture();const original=f.tx.get;f.tx.get=async ref=>{const snap=await original(ref),doc=snap.data();if(ref.id==='private'){const state=JSON.parse(doc.data);state.meta.checkinRequired=true;state.meta.registrationStatus='open';state.matches[0].refereeUid='private-referee';doc.data=JSON.stringify(state);}return {...snap,data:()=>doc};};
 f.args.dispatchCandidate.matches[0].refereeUid='private-referee';f.args.dispatchCandidate.matches[0].a.privateNote='secret';f.args.dispatchCandidate.courtAssignments.court1.lockedBy='private-referee';
 assert.equal((await writeSynchronizedStart(f.args)).committed,true);
 const privateState=JSON.parse(f.writes[0].payload.data),publicState=JSON.parse(f.writes[1].payload.bracketView);
 for(const [i,state] of [privateState,publicState].entries()){assert.equal(state.meta.registrationStatus,'started');assert.equal(state.meta.checkinClosedEarly,true);assert.equal(state.meta.checkinClosedAt,200);assert.equal(f.writes[i].payload.registrationStatus,'started');assert.equal(f.writes[i].payload.tournamentPhase,'live');}
 assert.equal(privateState.matches[0].refereeUid,'private-referee');assert.ok(!JSON.stringify(publicState).includes('private-referee'));assert.ok(!JSON.stringify(publicState).includes('secret'));
});
