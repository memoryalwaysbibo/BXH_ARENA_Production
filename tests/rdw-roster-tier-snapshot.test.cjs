const test=require('node:test'),assert=require('node:assert/strict');
const {buildRosterSnapshot,sealRosterSnapshot}=require('../scripts/lib/rdw-roster-tier-snapshot.cjs');
const capturedAt=2000,scope='public-official-canonical-self-history-v1';
function input(size){const rosterUids=Array.from({length:size},(_,i)=>'player_'+i);return {eventCode:'BXH-TEST01',drawRevision:2,capturedAt,rosterUids,verifiedTiers:rosterUids.map((uid,i)=>({ok:true,uid,tier:i%2?'c':'e',computedAt:1900,sourceDigest:'a'.repeat(64),sourceScope:scope}))};}
function mockTx(){let saved;const writes=[];return {writes,get saved(){return saved;},tx:{get:async()=>({exists:!!saved,data:()=>saved}),create:(_,record)=>{saved=record;writes.push(record);}}};}
for(const size of [8,32,128,320]){
 test('seals '+size+' unique UID tiers in canonical roster order',async()=>{
  const data=input(size),first=buildRosterSnapshot(data),again=buildRosterSnapshot(data);
  assert.deepEqual(first,again);assert.equal(first.rosterSize,size);
  assert.equal(first.tiers[0].uid,'player_0');
  const f=mockTx(),ref={id:'snapshot'};
  assert.equal((await sealRosterSnapshot({tx:f.tx,snapshotRef:ref,snapshot:first})).created,true);
  assert.equal((await sealRosterSnapshot({tx:f.tx,snapshotRef:ref,snapshot:again})).created,false);
  assert.equal(f.writes.length,1);
 });
}
test('rejected duplicate UID, swapped attribution and stale or incomplete tiers have no writes',async()=>{
 const scenarios=[
  d=>{d.rosterUids[1]=d.rosterUids[0];},
  d=>{d.verifiedTiers[1].uid=d.verifiedTiers[0].uid;},
  d=>{d.verifiedTiers[0].sourceDigest='bad';},
  d=>{d.verifiedTiers[0].computedAt=3000;},
  d=>{d.verifiedTiers[0].ok=false;},
  d=>{d.verifiedTiers[0].sourceScope='client-replay';}
 ];
 for(const patch of scenarios){const d=input(8),f=mockTx();patch(d);assert.throws(()=>buildRosterSnapshot(d),/snapshot-/);assert.equal(f.writes.length,0);}
});
test('rejects inconsistent sealed retries',async()=>{
 const f=mockTx(),a=buildRosterSnapshot(input(8));await sealRosterSnapshot({tx:f.tx,snapshotRef:{id:'snapshot'},snapshot:a});
 const changed=input(8);changed.verifiedTiers[0].tier='s';const b=buildRosterSnapshot(changed);
 await assert.rejects(sealRosterSnapshot({tx:f.tx,snapshotRef:{id:'snapshot'},snapshot:b}),/immutable-conflict/);
 assert.equal(f.writes.length,1);
});
