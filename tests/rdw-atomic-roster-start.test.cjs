const test=require('node:test'),assert=require('node:assert/strict');
const {commitAtomicRosterStart}=require('../scripts/lib/rdw-atomic-roster-start.cjs');
const eventRef={id:'event'},snapshotRef={id:'snapshot'},auditRef={id:'audit'};
function fixture(size=8){
 const rosterUids=Array.from({length:size},(_,i)=>'uid_'+i);
 const verifiedTiers=rosterUids.map(uid=>({ok:true,uid,tier:'c',computedAt:1000,sourceDigest:'f'.repeat(64),sourceScope:'public-official-canonical-self-history-v1'}));
 const store=new Map([['event',{code:'BXH-TEST01',drawRevision:7,started:false,rosterUids}]]);
 const writes=[],operations=[];let failAfterWrites=false;
 const tx={
  get:async ref=>{operations.push('get');if(writes.length)throw Error('read-after-write');return {exists:store.has(ref.id),data:()=>store.get(ref.id)};},
  create:(ref,record)=>{operations.push('create');writes.push(['create',ref.id,record]);},
  update:(ref,record)=>{operations.push('update');writes.push(['update',ref.id,record]);}
 };
 const input={tx,eventRef,snapshotRef,auditRef,eventCode:'BXH-TEST01',drawRevision:7,actorUid:'host',authorized:true,rosterValid:true,drawRevisionValid:true,rosterUids,verifiedTiers,capturedAt:2000,serverTime:2000,failureReason:'snapshot unavailable',idempotencyKey:'test-7'};
 return {input,writes,operations,store};
}
for(const size of [8,32,128,320])test(size+' player sealed snapshot and start never read after write',async()=>{const f=fixture(size),r=await commitAtomicRosterStart(f.input);assert.equal(r.committed,true);assert.equal(r.mode,'rdw-verified');assert.deepEqual(f.writes.map(v=>v[0]),['create','update']);assert.equal(f.writes[0][2].rosterSize,size);assert.equal(f.operations.filter(x=>x==='get').length,2);});
test('snapshot failure blocks start without explicit PASS',async()=>{const f=fixture();f.input.verifiedTiers[0].sourceDigest='not-sha';const r=await commitAtomicRosterStart(f.input);assert.equal(r.committed,false);assert.equal(f.writes.length,0);});
test('authorized explicit PASS appends audit and start atomically',async()=>{const f=fixture();f.input.verifiedTiers=null;f.input.passRequested=true;const r=await commitAtomicRosterStart(f.input);assert.equal(r.mode,'rdw-pass');assert.deepEqual(f.writes.map(v=>v[0]),['create','update']);assert.equal(f.writes[0][1],'audit');assert.equal(f.writes[1][2].rdwEligible,false);});
test('stale roster and unauthorized actor never write',async()=>{for(const mismatch of ['stale','unauthorized']){const f=fixture();if(mismatch==='stale')f.input.rosterUids=[...f.input.rosterUids].reverse();else f.input.authorized=false;if(mismatch==='stale')await assert.rejects(commitAtomicRosterStart(f.input),/event-roster-mismatch/);else assert.equal((await commitAtomicRosterStart(f.input)).committed,false);assert.equal(f.writes.length,0);}});
test('immutable snapshot conflict refuses start',async()=>{const f=fixture();f.store.set('snapshot',{snapshotDigest:'a'.repeat(64),rosterDigest:'b'.repeat(64)});await assert.rejects(commitAtomicRosterStart(f.input),/snapshot-immutable-conflict/);assert.equal(f.writes.length,0);});

test('forged previously sealed record is rejected even if digest matches',async()=>{
 const f=fixture(),{buildRosterSnapshot}=require('../scripts/lib/rdw-roster-tier-snapshot.cjs');
 const s=buildRosterSnapshot({eventCode:f.input.eventCode,drawRevision:f.input.drawRevision,rosterUids:f.input.rosterUids,verifiedTiers:f.input.verifiedTiers,capturedAt:f.input.capturedAt});
 f.store.set('snapshot',{...s,source:'client',verified:false});
 await assert.rejects(commitAtomicRosterStart(f.input),/snapshot-immutable-conflict/);
 assert.equal(f.writes.length,0);
});
test('snapshot capture after trusted server time cannot verify start',async()=>{
 const f=fixture();f.input.capturedAt=3000;
 const result=await commitAtomicRosterStart(f.input);
 assert.equal(result.committed,false);assert.equal(f.writes.length,0);
});
