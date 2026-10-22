const test=require('node:test'),assert=require('node:assert/strict');
const {commitStart}=require('../scripts/lib/rdw-atomic-start-reference.cjs');
const eventRef={id:'event'},auditRef={id:'audit'},snapshotRef={id:'snapshot'};
const base={eventRef,auditRef,snapshotRef,eventCode:'BXH-TEST',drawRevision:1,actorUid:'host',authorized:true,rosterValid:true,drawRevisionValid:true,serverTime:123,failureReason:'timeout',idempotencyKey:'BXH-TEST:1:pass'};
function fixture(event={code:'BXH-TEST',drawRevision:1,started:false},snapshot={source:'server',verified:true,eventCode:'BXH-TEST',drawRevision:1,sealed:true}){const db=new Map([['event',event]]);if(snapshot!==null)db.set('snapshot',snapshot);const writes=[];const tx={get:async r=>({exists:db.has(r.id),data:()=>db.get(r.id)}),create:(r,d)=>writes.push(['create',r.id,d]),update:(r,d)=>writes.push(['update',r.id,d])};return {tx,writes};}
test('verified start only updates event in supplied transaction',async()=>{const f=fixture(),r=await commitStart({...base,tx:f.tx,snapshotState:'verified',readbackStatus:'verified'});assert.equal(r.mode,'rdw-verified');assert.deepEqual(f.writes.map(x=>x[0]),['update']);});
test('PASS writes audit and start in same transaction',async()=>{const f=fixture(),r=await commitStart({...base,tx:f.tx,snapshotState:'failed',readbackStatus:'missing',passRequested:true});assert.equal(r.mode,'rdw-pass');assert.deepEqual(f.writes.map(x=>x[0]),['create','update']);assert.equal(f.writes[1][2].rdwEligible,false);});
test('invalid roster, stale revision and unknown readback never write',async()=>{for(const patch of [{rosterValid:false},{drawRevision:2},{readbackStatus:'unknown'}]){const f=fixture();try{const r=await commitStart({...base,tx:f.tx,snapshotState:'failed',readbackStatus:'missing',passRequested:true,...patch});assert.equal(r.committed,false);}catch(e){assert.match(e.message,/revision/);}assert.equal(f.writes.length,0);}});

test('verified start requires same-event sealed server snapshot',async()=>{
 for(const snapshot of [null,{source:'client',verified:true,eventCode:'BXH-TEST',drawRevision:1,sealed:true},{source:'server',verified:true,eventCode:'OTHER',drawRevision:1,sealed:true},{source:'server',verified:true,eventCode:'BXH-TEST',drawRevision:2,sealed:true}]){
  const f=fixture(undefined,snapshot);
  await assert.rejects(commitStart({...base,tx:f.tx,snapshotState:'verified',readbackStatus:'verified'}),/verified-snapshot-(missing|invalid)/);
  assert.equal(f.writes.length,0);
 }
 const f=fixture();await assert.rejects(commitStart({...base,tx:f.tx,snapshotRef:undefined,snapshotState:'verified',readbackStatus:'verified'}),/verified-snapshot-reference-required/);
 assert.equal(f.writes.length,0);
});
