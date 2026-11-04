'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {patchBootstrap}=require('../../../release/buckets/my-events/patch-bootstrap.cjs');
const source=readFileSync(path.join(__dirname,'deployed-bootstrap.cjs'),'utf8');
const tick=n=>({seconds:n,nanoseconds:0});
function candidate(){
 const module={exports:{}};
 const stamp=t=>t&&Number.isInteger(t.seconds)?{seconds:t.seconds,nanoseconds:t.nanoseconds}:null;
 const same=(a,b)=>!!a&&!!b&&a.seconds===b.seconds&&a.nanoseconds===b.nanoseconds;
 const requireFixture=id=>id==='node:crypto'?require(id):id==='./engine.cjs'?{SCHEMA:24,RELEASE:'test',stamp,same}:id==='./rebuild.cjs'?{ENGINE_VERSION:'membership-v26-generation-1',RUNS:'runs',ROOT:'jobs'}:id==='./lifecycle.js'?{normalizeLifecycle:()=>({status:'invalid'}),parseState:()=>({})}:require(id);
 vm.runInNewContext(patchBootstrap(source),{module,exports:module.exports,require:requireFixture},{filename:'candidate-bootstrap.cjs'});
 return module.exports;
}
function fixture({changeBeforeCheckpoint=false}={}){
 const sourceData=new Map(),queued=[],observed=[];
 const snap=(p,v,version=1)=>({id:p.split('/').at(-1),exists:v!==null,ref:{path:p},data:()=>v,createTime:tick(1),updateTime:tick(version)});
 const roomPath='tournaments/SIX';
 sourceData.set(roomPath,snap(roomPath,{data:'{}',tournamentPhase:'live'}));
 const doc=p=>({path:p});
 const collection=p=>({path:p,orderBy(){return this},limit(){return this},startAfter(){return this}});
 const bridge={doc,collection,collectionGroup:collection,run:async (_name,fn)=>{
  const tx={get:async ref=>ref.path==='tournaments'?{docs:[sourceData.get(roomPath)],size:1}:sourceData.get(ref.path)||snap(ref.path,null),set:(ref,value)=>sourceData.set(ref.path,snap(ref.path,value))};
  return {value:await fn(tx)};
 }};
 const rebuilder={beginRoom:async args=>{queued.push(args);return {status:'queued'}}};
 const bootstrap=candidate().createBootstrap({bridge,rebuilder,enabled:true,clock:()=>1000,resolveRoomLifecycle:async ({tx,room,code})=>{assert.ok(tx);assert.equal(room.ref.path,roomPath);assert.equal(code,'SIX');observed.push(room.updateTime.seconds);return {status:'supported',active:true}},hooks:{beforeCheckpoint:changeBeforeCheckpoint?()=>sourceData.set(roomPath,snap(roomPath,{data:'{}',tournamentPhase:'done'},2)):undefined}});
 return {bootstrap,queued,observed,sourceData};
}
test('exact bootstrap patch requires a transactional bucket adapter',()=>{
 assert.throws(()=>patchBootstrap(source+'\n'),/source-drift/);
 assert.throws(()=>candidate().createBootstrap({enabled:true,bridge:{run(){},doc(){},collection(){},collectionGroup(){}},rebuilder:{beginRoom(){}}}),/bootstrap-dependencies/);
});
test('capture and room page enqueue a verified split room with pinned source',async()=>{
 const {bootstrap,queued,observed}=fixture();
 assert.equal((await bootstrap.beginRun({runId:'run1'})).status,'started');
 assert.equal((await bootstrap.captureRoom({code:'SIX'})).status,'queued');
 const page=await bootstrap.processPage('run1');
 assert.equal(page.status,'phase-complete');
 assert.equal(page.phase,'rooms');
 assert.equal(queued.length,2);
 assert.equal(queued[0].expectedTarget,'active');
 assert.deepEqual(queued[0].expectedSourceUpdateTime,tick(1));
 assert.equal(queued[1].expectedTarget,'active');
 assert.deepEqual(queued[1].expectedSourceUpdateTime,tick(1));
 assert.ok(observed.length>=3);
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
