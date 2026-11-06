'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const B=require('../../../release/buckets/completion/protocol/state.cjs');
const {readRoomLifecycle}=require('../../../release/buckets/my-events/lifecycle.cjs');
const {normalizeLifecycle}=require('./deployed-lifecycle.cjs');
const code='BXH-TEST01', rootPath='tournaments/'+code, pubPath='publicTournaments/'+code;
function harness(courts=6,{bucket=true}={}){
 const state={id:'room',cloudCode:code,meta:{stations:courts},players:[],matches:[{id:'a',station:1,completed:true,isBye:false,a:{playerId:'p1'},b:{playerId:'p2'},refereeSeatScoreRevision:0,dispatchRevision:0}],startedAt:1};
 const top={data:JSON.stringify(state),tournamentPhase:'live'};
 const pub={};const rows=new Map(),reads=[];
 if(bucket){top.scoreStorage=B.makeManifest(state,'epoch-1');const buckets=B.encode(state,top.scoreStorage);
  pub.scoreBucketProjection={epoch:'epoch-1',versions:Object.fromEntries(buckets.map(b=>[b.bucketId,b.revision]))};
  for(const b of buckets)rows.set(rootPath+'/matchBuckets/'+b.bucketId,b);
 }else{state.matches[0].completed=false;top.data=JSON.stringify(state);}
 rows.set(rootPath,top);rows.set(pubPath,pub);
 const ref=p=>({path:p,id:p.split('/').at(-1),collection:x=>({doc:y=>ref(p+'/'+x+'/'+y)})});
 const db={doc:ref};const tx={get:async r=>{reads.push(r.path);const exists=rows.has(r.path);return {exists,id:r.id,ref:r,data:()=>rows.get(r.path),createTime:exists?{seconds:r.path===rootPath?1:2,nanoseconds:0}:undefined};}};
 return {rows,reads,db,tx,read:async()=>readRoomLifecycle({db,tx,room:await tx.get(ref(rootPath)),code,normalizeRoom:normalizeLifecycle})};
}
test('legacy room keeps original phase and reads no buckets',async()=>{
 const f=harness(6,{bucket:false}),life=await f.read();
 assert.equal(life.status,'supported');assert.equal(life.phase,'live');
 assert.deepEqual(f.reads,[rootPath,pubPath]);
});
test('split room derives settling through the 32-court protocol bound',async()=>{
 for(const n of [4,6,12,32]){const f=harness(n),life=await f.read();
  assert.equal(life.status,'supported');assert.equal(life.phase,'settling');
  assert.equal(life.source,'verified-buckets');
  assert.equal(f.reads.length,2+Math.ceil(n/4));
 }
});
test('public-only ownership marker fails closed',async()=>{
 const f=harness(6,{bucket:false});f.rows.get(pubPath).scoreBucketProjection={epoch:'orphan',versions:{}};
 const life=await f.read();assert.equal(life.status,'invalid');assert.equal(life.reason,'bucket-lifecycle-unverified');
});
test('missing bucket fails closed',async()=>{
 const f=harness(6);f.rows.delete(rootPath+'/matchBuckets/court-2');
 const life=await f.read();assert.equal(life.status,'invalid');assert.equal(life.reason,'bucket-lifecycle-unverified');
});
