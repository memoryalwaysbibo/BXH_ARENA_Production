'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const B=require('../../../release/buckets/completion/protocol/state.cjs');
const {readRoomLifecycle}=require('../../../release/buckets/my-events/lifecycle.cjs');
const {normalizeLifecycle,parseState}=require('./deployed-lifecycle.cjs');
const sourceFile=path.join(__dirname,'deployed-bootstrap.cjs');
function capturedBootstrap(){
 const source=fs.readFileSync(sourceFile,'utf8');
 assert.equal(createHash('sha256').update(source).digest('hex'),'8ff7a99e0b571aa56052f1774029c693c0001622115b674f8bc5fc6daf8b71d2');
 const m=new Module(sourceFile,module);m.filename=sourceFile;m.paths=Module._nodeModulePaths(__dirname);
 m.require=id=>id==='./engine.cjs'?{SCHEMA:24,RELEASE:'individual-family-v24'}:id==='./rebuild.cjs'?{ENGINE_VERSION:'membership-v26-generation-1',RUNS:'myEventBootstrapRunsV26',ROOT:'myEventRebuildsV26'}:id==='./lifecycle.js'?{normalizeLifecycle,parseState}:module.require(id);
 m._compile(source,sourceFile);return m.exports;
}
test('captured bootstrap excludes a valid six-court split room before reading buckets',async()=>{
 const code='BXH-TEST01',p='tournaments/'+code,pp='publicTournaments/'+code;
 const state={id:'room-1',cloudCode:code,meta:{stations:6},players:[],matches:[{id:'m1',station:1,completed:true,isBye:false,a:{playerId:'a'},b:{playerId:'b'},dispatchRevision:0,refereeSeatScoreRevision:0}],startedAt:1};
 const manifest=B.makeManifest(state,'epoch-1'),buckets=B.encode(state,manifest);
 const top={data:JSON.stringify(state),scoreStorage:manifest,tournamentPhase:'live'},pub={scoreBucketProjection:{epoch:manifest.epoch,versions:Object.fromEntries(buckets.map(b=>[b.bucketId,b.revision]))}};
 const rows=new Map([[p,top],[pp,pub],...buckets.map(b=>[p+'/matchBuckets/'+b.bucketId,b])]);
 const ref=x=>({path:x,id:x.split('/').at(-1),collection:y=>({doc:z=>ref(x+'/'+y+'/'+z)})});
 const tx={get:async r=>({exists:rows.has(r.path),ref:r,id:r.id,data:()=>rows.get(r.path),createTime:{seconds:r.path===p?1:2,nanoseconds:0}})};
 const life=await readRoomLifecycle({db:{doc:ref},tx,room:await tx.get(ref(p)),code,normalizeRoom:normalizeLifecycle});
 assert.equal(life.status,'supported');assert.equal(life.phase,'settling');assert.equal(life.active,true);
 assert.equal(capturedBootstrap().discoveryScope(top),'unresolved');
});
