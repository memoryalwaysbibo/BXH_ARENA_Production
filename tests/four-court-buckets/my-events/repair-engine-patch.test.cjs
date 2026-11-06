'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {patchRepairEngine}=require('../../../release/buckets/my-events/patch-repair-engine.cjs');
const {readRoomLifecycle}=require('../../../release/buckets/my-events/lifecycle.cjs');
const {normalizeLifecycle}=require('./deployed-lifecycle.cjs');
const B=require('../../../release/buckets/completion/protocol/state.cjs');
const sourcePath=path.join(__dirname,'deployed-engine.cjs');
const source=fs.readFileSync(sourcePath,'utf8');
function candidate(){
 const file=path.join(__dirname,'patched-engine.cjs'),m=new Module(file,module);
 m.filename=file;m.paths=Module._nodeModulePaths(__dirname);
 m.require=id=>id==='./lifecycle'?{normalizeLifecycle}:id==='./owners'?{collectOwners:()=>{throw Error('not used');}}:module.require(id);
 m._compile(patchRepairEngine(source),file);return m.exports;
}
function fixture({bucket=true,missing=false}={}){
 const code='BXH-TEST01',rootPath='tournaments/'+code,pubPath='publicTournaments/'+code;
 const state={id:'room-1',cloudCode:code,meta:{stations:6},players:[],matches:[{id:'m1',station:1,completed:bucket,isBye:false,a:{playerId:'a'},b:{playerId:'b'},dispatchRevision:0,refereeSeatScoreRevision:0}],startedAt:1};
 const top={data:JSON.stringify(state),tournamentPhase:'live'},pub={},rows=new Map(),ops=[];
 if(bucket){const manifest=B.makeManifest(state,'epoch-1');top.scoreStorage=manifest;
  const buckets=B.encode(state,manifest);pub.scoreBucketProjection={epoch:manifest.epoch,versions:Object.fromEntries(buckets.map(b=>[b.bucketId,b.revision]))};
  for(const b of buckets)rows.set(rootPath+'/matchBuckets/'+b.bucketId,b);
  if(missing)rows.delete(rootPath+'/matchBuckets/court-2');
 }
 rows.set(rootPath,top);rows.set(pubPath,pub);
 const ref=p=>({path:p,id:p.split('/').at(-1),collection:x=>({doc:y=>ref(p+'/'+x+'/'+y)})});
 const query=p=>({path:p,isQuery:true,orderBy(){return this;},limit(){return this;},startAfter(){return this;}});
 const bridge={doc:ref,collection:query,run:async (_name,fn)=>{
  let wrote=false;
  const tx={get:async r=>{assert(!wrote,'transaction read after write');ops.push(['read',r.path]);if(r.isQuery)return {docs:[],size:0};return {exists:rows.has(r.path),ref:r,id:r.id,data:()=>rows.get(r.path),createTime:rows.has(r.path)?{seconds:r.path===rootPath?1:2,nanoseconds:0}:undefined};},set:(r,value)=>{wrote=true;ops.push(['write',r.path]);rows.set(r.path,value);}};
  return {value:await fn(tx)};
 }};
 return {code,rows,ops,bridge,rootPath,pubPath};
}
test('exact deployed engine patch refuses source drift and missing resolver',()=>{
 assert.throws(()=>patchRepairEngine(source+'\n'),/source-drift/);
 assert.throws(()=>candidate().createEngine({enabled:true,bridge:fixture().bridge}),/lifecycle-required/);
});
test('room-intent uses verified six-court phase inside one transaction',async()=>{
 const f=fixture(),e=candidate().createEngine({enabled:true,bridge:f.bridge,resolveRoomLifecycle:readRoomLifecycle});
 assert.deepEqual(await e.recordRoom({code:f.code}),{status:'queued',revision:1});
 assert.equal(f.rows.get('myEventRoomJobs/'+f.code).target,'active');
 assert(f.ops.some(x=>x[1]===f.pubPath));
 assert(f.ops.some(x=>x[1]===f.rootPath+'/matchBuckets/court-2'));
});
test('missing bucket remains unresolved; legacy room remains active',async()=>{
 const broken=fixture({missing:true}),e=candidate().createEngine({enabled:true,bridge:broken.bridge,resolveRoomLifecycle:readRoomLifecycle});
 await e.recordRoom({code:broken.code});assert.equal(broken.rows.get('myEventRoomJobs/'+broken.code).target,'invalid');
 const legacy=fixture({bucket:false}),v=candidate().createEngine({enabled:true,bridge:legacy.bridge,resolveRoomLifecycle:readRoomLifecycle});
 await v.recordRoom({code:legacy.code});assert.equal(legacy.rows.get('myEventRoomJobs/'+legacy.code).target,'active');
 assert.equal(legacy.ops.filter(x=>x[0]==='read').length,3);
});
test('page repair rechecks bucket context after the claim and supersedes a stale job',async()=>{
 const f=fixture(),e=candidate().createEngine({enabled:true,bridge:f.bridge,clock:()=>100,resolveRoomLifecycle:readRoomLifecycle,
  hooks:{afterClaim:()=>f.rows.delete(f.rootPath+'/matchBuckets/court-2')}});
 await e.recordRoom({code:f.code});
 assert.equal(f.rows.get('myEventRoomJobs/'+f.code).target,'active');
 assert.deepEqual(await e.processPage(f.code),{status:'superseded'});
 assert.equal(f.rows.get('myEventRoomJobs/'+f.code).target,'invalid');
 assert.equal(f.rows.get('myEventRoomJobs/'+f.code).revision,2);
});
test('registration ingest resolves split-room target in its existing transaction',async()=>{
 const f=fixture(),e=candidate().createEngine({enabled:true,bridge:f.bridge,resolveRoomLifecycle:readRoomLifecycle});
 const result=await e.ingestRegistration({code:f.code,id:'registration-1'});
 assert.equal(result.roomTarget,'active');
 assert.equal(result.status,'applied');
 assert(f.ops.some(x=>x[1]===f.pubPath));
 assert(f.ops.some(x=>x[1]===f.rootPath+'/matchBuckets/court-2'));
});
