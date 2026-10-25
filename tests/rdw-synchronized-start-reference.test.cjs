const {buildRosterSnapshot}=require('../scripts/lib/rdw-roster-tier-snapshot.cjs');
const makeSnapshot=(eventCode,drawRevision,rosterUids)=>buildRosterSnapshot({eventCode,drawRevision,rosterUids,capturedAt:150,verifiedTiers:rosterUids.map(uid=>({ok:true,uid,tier:'d',computedAt:100,sourceScope:'public-official-canonical-self-history-v1',sourceDigest:'a'.repeat(64)}))});
const test=require('node:test'),assert=require('node:assert/strict');
const {writeSynchronizedStart}=require('../scripts/lib/rdw-synchronized-start-reference.cjs');
const code='BXH-ABC123',eventRef={id:'private'},publicRef={id:'public'},snapshotRef={id:'snapshot'};
function fixture({general=false,stale=false,missingSnapshot=false}={}){
 const p={cloudCode:code,registrationRosterRevision:4,meta:{ladderMode:general?'general':'ranked',eventAuthority:'official'},players:[{id:'p1',uid:'u1'},{id:'p2',uid:'u2'}],matches:[{id:'m1',a:{playerId:'p1'},b:{playerId:'p2'},completed:false}],drawnAt:100,startedAt:null,rosterLocked:false};
 const q={cloudCode:code,registrationRosterRevision:stale?3:4,players:[{id:'p1'},{id:'p2'}],matches:[{id:'m1',a:{playerId:'p1'},b:{playerId:'p2'},completed:false}],drawnAt:100,startedAt:null};
 const doc={private:{code,data:JSON.stringify(p)},public:{bracketView:JSON.stringify(q)},snapshot:makeSnapshot(code,9,['u1','u2'])};
 const reads=[],writes=[];const tx={get:async ref=>{reads.push(ref.id);return {exists:ref.id!=='snapshot'||!missingSnapshot,data:()=>doc[ref.id]};},update:(ref,payload)=>{writes.push({id:ref.id,payload});}};
 return {tx,reads,writes,args:{tx,eventRef,publicRef,snapshotRef,eventCode:code,expectedRosterRevision:4,drawRevision:9,serverTime:200,authorized:true,bracketVerified:true}};
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
