'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fixture,load,specs,code}=require('../settlement/probe.cjs');
const {normalizeLifecycle}=require('./deployed-lifecycle.cjs');
const {readBucketLifecycle,readRoomLifecycle}=require('../../../release/buckets/my-events/lifecycle.cjs');
const B=require('../../../release/buckets/settlement/bucket-settlement/state.cjs');
async function status(f){
 return f.m.db.runTransaction(tx=>readBucketLifecycle({db:f.m.db,tx,code,normalizeRoom:normalizeLifecycle}));
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
test('waiting, live and added-court phases use current bucket context',async()=>{
 const waiting=fixture({courts:6}),rp='tournaments/'+code,pp='publicTournaments/'+code;
 const root=waiting.m.rows.get(rp),base=JSON.parse(root.data);
 delete base.startedAt;base.matches=[];
 const w={...root,data:JSON.stringify(base),tournamentPhase:'waiting'};
 waiting.m.put(rp,w);
 for(const bucket of B.encode(base,w.scoreStorage))waiting.m.put(rp+'/matchBuckets/'+bucket.bucketId,bucket);
 let life=await status(waiting);assert.equal(life.phase,'waiting');assert.equal(life.active,true);

 const live=fixture({courts:6}),old=live.m.rows.get(rp),state=JSON.parse(old.data);
 state.matches[0].completed=false;live.m.put(rp,{...old,data:JSON.stringify(state)});
 const bucketPath=rp+'/matchBuckets/court-1',bucket=live.m.rows.get(bucketPath),matches=JSON.parse(bucket.matches);
 matches.find(m=>m.id===state.matches[0].id).completed=false;
 live.m.put(bucketPath,{...bucket,matches:JSON.stringify(matches)});
 life=await status(live);assert.equal(life.phase,'live');assert.equal(life.active,true);

 const expanded=fixture({courts:6}),prior=expanded.m.rows.get(rp),newState=JSON.parse(prior.data);
 newState.meta.stations=12;
 const manifest=B.makeManifest(newState,prior.scoreStorage.epoch);
 expanded.m.put(rp,{...prior,data:JSON.stringify(newState),scoreStorage:manifest});
 expanded.m.put(rp+'/matchBuckets/court-3',B.encode(newState,manifest).find(b=>b.bucketId==='court-3'));
 const pub=expanded.m.rows.get(pp);
 expanded.m.put(pp,{...pub,scoreBucketProjection:{epoch:manifest.epoch,versions:{...pub.scoreBucketProjection.versions,'court-3':0}}});
 life=await status(expanded);assert.equal(life.phase,'settling');assert.equal(life.active,true);
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

async function readerStatus(f,roomPath='tournaments/'+code){
 return f.m.db.runTransaction(async tx=>{
  const room=await tx.get(f.m.db.doc(roomPath));
  return readRoomLifecycle({db:f.m.db,tx,room,code,normalizeRoom:normalizeLifecycle});
 });
}
test('reader seam preserves the legacy room normalizer without bucket reads',async()=>{
 const f=fixture({bucket:false,courts:6}),p='tournaments/'+code,top=f.m.rows.get(p),state=JSON.parse(top.data);
 state.matches[0].completed=false;f.m.put(p,{...top,data:JSON.stringify(state)});
 const life=await readerStatus(f);
 assert.deepEqual(life,normalizeLifecycle(f.m.rows.get(p)));
 assert.equal(life.status,'supported');assert.equal(life.phase,'live');
 assert.equal(f.m.writes.length,0);
});
test('reader seam uses the same transaction root and authoritative buckets',async()=>{
 const f=fixture({courts:6}),life=await readerStatus(f);
 assert.equal(life.status,'supported');assert.equal(life.source,'verified-buckets');
 assert.equal(life.phase,'settling');assert.equal(f.m.writes.length,0);
});
test('reader seam rejects missing room and incomplete ownership',async()=>{
 const missing=fixture({courts:6});missing.m.remove('tournaments/'+code);
 assert.deepEqual(await readerStatus(missing),{status:'invalid',reason:'room-lifecycle-input'});
 const partial=fixture({bucket:false,courts:6}),p='tournaments/'+code;
 partial.m.put(p,{...partial.m.rows.get(p),deletionStatus:null});
 const life=await readerStatus(partial);
 assert.equal(life.status,'invalid');assert.equal(life.reason,'bucket-lifecycle-unverified');
 assert.equal(partial.m.writes.length,0);
});
test('reader seam rejects a room snapshot from a different path',async()=>{
 const f=fixture({courts:6});
 const life=await readerStatus(f,'tournaments/OTHER');
 assert.deepEqual(life,{status:'invalid',reason:'room-lifecycle-input'});
});
