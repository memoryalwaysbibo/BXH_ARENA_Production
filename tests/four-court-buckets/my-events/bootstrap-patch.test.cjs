'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {patchBootstrap}=require('../../../release/buckets/my-events/patch-bootstrap.cjs');
const {readRoomLifecycle}=require('../../../release/buckets/my-events/lifecycle.cjs');
const B=require('../../../release/buckets/completion/protocol/state.cjs');
const {normalizeLifecycle,parseState}=require('./deployed-lifecycle.cjs');
const source=readFileSync(path.join(__dirname,'deployed-bootstrap.cjs'),'utf8');
const tick=n=>({seconds:n,nanoseconds:0});
function candidate(){
 const module={exports:{}};
 const stamp=t=>t&&Number.isInteger(t.seconds)?{seconds:t.seconds,nanoseconds:t.nanoseconds}:null;
 const same=(a,b)=>!!a&&!!b&&a.seconds===b.seconds&&a.nanoseconds===b.nanoseconds;
 const requireFixture=id=>id==='node:crypto'?require(id):id==='./engine.cjs'?{SCHEMA:24,RELEASE:'test',stamp,same}:id==='./rebuild.cjs'?{ENGINE_VERSION:'membership-v26-generation-1',RUNS:'runs',ROOT:'jobs'}:id==='./lifecycle.js'?{normalizeLifecycle,parseState}:require(id);
 vm.runInNewContext(patchBootstrap(source),{module,exports:module.exports,require:requireFixture},{filename:'candidate-bootstrap.cjs'});
 return module.exports;
}
function fixture({changeBeforeCheckpoint=false}={}){
 const sourceData=new Map(),queued=[],observed=[];
 const snap=(p,v,version=1)=>({id:p.split('/').at(-1),exists:v!==null,ref:{path:p},data:()=>v,createTime:tick(1),updateTime:tick(version)});
 const roomPath='tournaments/SIX';
 sourceData.set(roomPath,snap(roomPath,{data:'{}',tournamentPhase:'live'}));
 const doc=p=>({path:p});
 const collection=p=>({path:p,isQuery:true,cursor:null,orderBy(){return this},limit(){return this},startAfter(cursor){this.cursor=cursor;return this}});
 const bridge={doc,collection,collectionGroup:collection,run:async (_name,fn)=>{
  const tx={get:async ref=>ref.isQuery?ref.path==='tournaments'&&!ref.cursor?{docs:[sourceData.get(roomPath)],size:1}:{docs:[],size:0}:sourceData.get(ref.path)||snap(ref.path,null),set:(ref,value)=>sourceData.set(ref.path,snap(ref.path,value))};
  return {value:await fn(tx)};
 }};
 const rebuilder={beginRoom:async args=>{queued.push(args);return {status:'queued'}}};
 const bootstrap=candidate().createBootstrap({bridge,rebuilder,enabled:true,clock:()=>1000,resolveRoomLifecycle:async ({tx,room,code})=>{assert.ok(tx);assert.equal(room.ref.path,roomPath);assert.equal(code,'SIX');observed.push(room.updateTime.seconds);return {status:'supported',active:true}},hooks:{beforeCheckpoint:changeBeforeCheckpoint?()=>sourceData.set(roomPath,snap(roomPath,{data:'{}',tournamentPhase:'done'},2)):undefined}});
 return {bootstrap,queued,observed,sourceData};
}
test('exact bootstrap patch requires a transactional bucket adapter',()=>{
 assert.throws(()=>patchBootstrap(source+'\n'),/source-drift/);
 assert.throws(()=>candidate().createBootstrap({enabled:true,bridge:{run(){},doc(){},collection(){},collectionGroup(){}},rebuilder:{beginRoom(){}}}),/bootstrap-dependencies/);
 assert.equal(candidate().PAGE,1);
 assert.equal(candidate().LEASE_MS,60000);
});
test('capture and room page enqueue a verified split room with pinned source',async()=>{
 const {bootstrap,queued,observed,sourceData}=fixture();
 assert.equal((await bootstrap.beginRun({runId:'run1'})).status,'started');
 assert.equal((await bootstrap.captureRoom({code:'SIX'})).status,'queued');
 const beforeFirstPage=sourceData.get('runs/run1');
 const page=await bootstrap.processPage('run1');
 assert.equal(page.status,'page');
 assert.equal(page.phase,'rooms');
 assert.equal(queued.length,2);
 assert.equal(queued[0].expectedTarget,'active');
 assert.deepEqual(queued[0].expectedSourceUpdateTime,tick(1));
 assert.equal(queued[1].expectedTarget,'active');
 assert.deepEqual(queued[1].expectedSourceUpdateTime,tick(1));
 assert.ok(observed.length>=3);
 const firstPage=sourceData.get('runs/run1');
 assert.equal(candidate().shouldProcessBootstrap({data:{before:beforeFirstPage,after:firstPage}},1000),true);
 assert.equal(candidate().shouldProcessBootstrap({data:{before:firstPage,after:firstPage}},1000),false);
 const next=await bootstrap.processPage('run1');
 assert.equal(next.status,'phase-complete');
 assert.equal(next.phase,'rooms');
 assert.equal(next.rows,0);
 assert.equal(sourceData.get('runs/run1').data().phase,'summaries');
 assert.equal(sourceData.get('runs/run1').data().roomDiscoveryCursor,'SIX');
 assert.equal(queued.length,2);
 assert.equal(candidate().shouldProcessBootstrap({data:{before:firstPage,after:sourceData.get('runs/run1')}},1000),true);
});
test('room changed before checkpoint retries the page without advancing cursor',async()=>{
 const {bootstrap,queued,sourceData}=fixture({changeBeforeCheckpoint:true});
 await bootstrap.beginRun({runId:'run2'});
 assert.equal((await bootstrap.processPage('run2')).status,'stale-source');
 assert.equal(queued.length,1);
 const run=sourceData.get('runs/run2').data();
 assert.equal(run.phase,'rooms');
 assert.equal(run.roomDiscoveryCursor,null);
 assert.equal(run.leaseToken,null);
});
function sixCourtFixture({omitBucket=false}={}){
 const code='SIX',roomPath='tournaments/'+code,rows=new Map(),reads=[],queued=[];
 const ref=p=>({path:p,id:p.split('/').at(-1),collection:x=>({doc:y=>ref(p+'/'+x+'/'+y)})});
 const snap=(p,data)=>({id:p.split('/').at(-1),ref:ref(p),exists:data!==null,data:()=>data,createTime:tick(p===roomPath?1:2),updateTime:tick(p===roomPath?1:2)});
 const state={id:'room-1',cloudCode:code,meta:{stations:6},players:[],matches:[{id:'m1',station:1,completed:true,isBye:false,a:{playerId:'a'},b:{playerId:'b'},dispatchRevision:0,refereeSeatScoreRevision:0}],startedAt:1};
 const m=B.makeManifest(state,'epoch-1'),buckets=B.encode(state,m);
 rows.set(roomPath,snap(roomPath,{data:JSON.stringify(state),scoreStorage:m,tournamentPhase:'live'}));
 rows.set('publicTournaments/'+code,snap('publicTournaments/'+code,{scoreBucketProjection:{epoch:m.epoch,versions:Object.fromEntries(buckets.map(b=>[b.bucketId,b.revision]))}}));
 for(const b of buckets)if(!omitBucket||b.bucketId!=='court-2')rows.set(roomPath+'/matchBuckets/'+b.bucketId,snap(roomPath+'/matchBuckets/'+b.bucketId,b));
 const query=p=>({path:p,isQuery:true,orderBy(){return this},limit(){return this},startAfter(){return this}});
 const bridge={doc:ref,collection:query,collectionGroup:query,run:async (_name,fn)=>{
  let wrote=false;
  const tx={get:async r=>{assert.equal(wrote,false,'transaction read after write');reads.push(r.path);return r.isQuery?{docs:[rows.get(roomPath)],size:1}:rows.get(r.path)||snap(r.path,null)},set:(r,data)=>{wrote=true;rows.set(r.path,snap(r.path,data))}};
  return {value:await fn(tx)};
 }};
 const bootstrap=candidate().createBootstrap({enabled:true,bridge,clock:()=>1000,rebuilder:{beginRoom:async input=>{queued.push(input);return {status:'queued'}}},resolveRoomLifecycle:readRoomLifecycle});
 return {bootstrap,rows,reads,queued,roomPath,code};
}
test('six-court discovery reads real bucket and public proof in the same read-only transactions',async()=>{
 const {bootstrap,reads,queued,roomPath,code}=sixCourtFixture();
 assert.equal((await bootstrap.beginRun({runId:'real-six'})).status,'started');
 assert.equal((await bootstrap.processPage('real-six')).status,'page');
 assert.equal(queued[0].expectedTarget,'active');
 assert(reads.includes('publicTournaments/'+code));
 assert(reads.includes(roomPath+'/matchBuckets/court-2'));
});
test('missing six-court bucket blocks discovery without advancing the cursor',async()=>{
 const {bootstrap,rows,queued,roomPath}=sixCourtFixture({omitBucket:true});
 assert.equal((await bootstrap.beginRun({runId:'missing-six'})).status,'started');
 const result=await bootstrap.processPage('missing-six');
 assert.equal(result.status,'needs-repair');
 assert.equal(result.reason,'unresolved-room-scope');
 assert.equal(queued.length,0);
 assert.equal(rows.get('runs/missing-six').data().roomDiscoveryCursor,null);
 assert.equal(rows.get('runs/missing-six').data().state,'needs-repair');
 assert.equal(rows.has(roomPath+'/matchBuckets/court-2'),false);
});
