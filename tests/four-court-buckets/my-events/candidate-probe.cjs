'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fixture,load,specs,code}=require('../settlement/probe.cjs');
const {normalizeLifecycle}=require('./deployed-lifecycle.cjs');
const {readBucketLifecycle}=require('../../../release/buckets/my-events/lifecycle.cjs');
async function status(f){
 return f.m.db.runTransaction(async tx=>{
  const root=await tx.get(f.m.db.doc('tournaments/'+code));
  const pub=await tx.get(f.m.db.doc('publicTournaments/'+code));
  return readBucketLifecycle({db:f.m.db,tx,root,pub,normalizeRoom:normalizeLifecycle});
 });
}
test('4, 6 and 12 courts stay active while authoritative matches wait for settlement',async()=>{
 for(const courts of [4,6,12]){
  const f=fixture({courts}),life=await status(f);
  assert.equal(life.status,'supported');assert.equal(life.source,'verified-buckets');
  assert.equal(life.phase,'settling');assert.equal(life.active,true);
  assert.equal(life.epoch,'epoch-1');assert.ok(life.roomIncarnation);
 }
});
test('completed private and public certificates close the verified room',async()=>{
 const f=fixture({courts:6}),spec=specs.find(x=>x.function==='settleLadderTournament');
 const done=await load(spec,true,f.m).invoke();assert.equal(done.ok,true,done.reason);
 const life=await status(f);assert.equal(life.status,'supported');assert.equal(life.phase,'done');assert.equal(life.active,false);
});
test('partial ownership, migration, missing or corrupted bucket fail closed',async()=>{
 const variants=[
  f=>{const p='tournaments/'+code;f.m.put(p,{...f.m.rows.get(p),bucketMigration:{status:'migrating'}});},
  f=>{const p='publicTournaments/'+code;f.m.put(p,{...f.m.rows.get(p),deletionStatus:null});},
  f=>f.m.remove('tournaments/'+code+'/matchBuckets/court-2'),
  f=>{const p='tournaments/'+code+'/matchBuckets/court-1';f.m.put(p,{...f.m.rows.get(p),matches:'{'});},
  f=>{const p='publicTournaments/'+code;f.m.put(p,{...f.m.rows.get(p),scoreBucketProjection:{epoch:'different',versions:{}}});},
 ];
 for(const mutate of variants){const f=fixture({courts:6});mutate(f);const life=await status(f);assert.equal(life.status,'invalid');assert.equal(life.reason,'bucket-lifecycle-unverified');}
});
test('root-only forged done phase cannot hide an active bucket room',async()=>{
 const f=fixture({courts:6}),p='tournaments/'+code;
 f.m.put(p,{...f.m.rows.get(p),tournamentPhase:'done'});
 const life=await status(f);assert.equal(life.status,'invalid');assert.equal(life.reason,'bucket-phase-conflict');
});
