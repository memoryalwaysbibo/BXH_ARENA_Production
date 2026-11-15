'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module');
const {fixture,request}=require('./trusted-fixture.cjs');
const B=require('../../referee-seats/functions/bucket-state.cjs');
const {createScoreDiagnostics}=require('../../referee-seats/functions/score-diagnostics.cjs');
const {createBucketRuntime}=require('../../referee-seats/functions/bucket-runtime.cjs');
function setup({attempts=1,failure=null,brokenLogger=false,holdCommit=false,holdBucketRead=false}={}){
 const f=fixture('BXH-DIAG6',6,false),docs=new Map(),records=[],writes=[],reads=[];
 const root='tournaments/'+f.state.cloudCode;
 docs.set(root,f.room);docs.set('users/ref1',f.user);docs.set('systemConfig/fourCourtScoreBuckets',{enabled:true});
 for(const b of B.encode(f.state,f.room.scoreStorage))docs.set(root+'/matchBuckets/'+b.bucketId,b);
 const ref=path=>({path,collection:n=>({doc:id=>ref(path+'/'+n+'/'+id)})});
 let alarm,cancelled=0,tick=0,acknowledge,queued;
 const gate=new Promise(resolve=>{acknowledge=resolve;}),pending=new Promise(resolve=>{queued=resolve;});
 const db={projectId:'demo-bxh-four-court-buckets',doc:ref,async runTransaction(fn){
  let result;
  for(let i=0;i<attempts;i++){
   const changes=[],put=(type,r,v)=>changes.push([type,r.path,v]);
   result=await fn({getAll:async(...refs)=>{if(holdBucketRead&&refs.some(r=>r.path.includes('/matchBuckets/'))){queued();await gate;}return refs.map(r=>{reads.push(r.path);return {exists:docs.has(r.path),data:()=>docs.get(r.path)};});},get:async r=>{reads.push(r.path);return {exists:docs.has(r.path),data:()=>docs.get(r.path)};},set:(r,v)=>put('set',r,v),update:(r,v)=>put('update',r,v),create:(r,v)=>put('create',r,v),delete:r=>put('delete',r)});
   queued();if(holdCommit)await gate;
   if(failure)throw failure;
   if(i===attempts-1)for(const [type,path,value]of changes){writes.push([type,path]);docs.set(path,type==='update'?{...docs.get(path),...value}:value);}
  }
  return result;
 }};
 const source=require.resolve('../../referee-seats/functions/bucket-scoring-service.cjs'),local=createRequire(source);
 const context={module:{exports:{}},console:{log:value=>{if(brokenLogger)throw Error('logger failed');records.push(JSON.parse(value));}},require:name=>{
  if(name==='./bucket-runtime.cjs')return {createBucketRuntime:(db,options)=>createBucketRuntime(db,{...options,env:{FIRESTORE_EMULATOR_HOST:'127.0.0.1:8188'}})};
  if(name==='./score-diagnostics.cjs')return {createScoreDiagnostics:(req,opts)=>createScoreDiagnostics(req,{...opts,now:()=>tick,schedule:fn=>{alarm=fn;return {unref(){}};},cancel:()=>{cancelled++;}})};
  return local(name);
 }};
 vm.runInNewContext(fs.readFileSync(source,'utf8'),context,{filename:source});
 const req={auth:{uid:'ref1'},rawRequest:{headers:{authorization:'PRIVATE_TOKEN'}},data:request(f.state,f.room,'m1','score','private-operation-identifier',{side:'A',finish:'spin',privateName:'PRIVATE_PLAYER'})};
 return {docs,records,writes,reads,root,req,pending,acknowledge,alarm:()=>alarm(),advance:ms=>{tick+=ms;},cancelled:()=>cancelled,handle:context.module.exports.createBucketScoringHandler(db,{clock:()=>1000})};
}
test('bucket retry diagnostics preserve one score and exclude public/root writes and private data',async()=>{
 const f=setup({attempts:2}),result=await f.handle(f.req);
 assert(result.ok);assert.equal(result.scoreRevision,1);assert.equal(JSON.parse(result.buckets[0].matches)[0].scoreA,1);
 assert.equal(f.writes.length,3);assert(!f.writes.some(([,p])=>p===f.root||p.startsWith('publicTournaments/')));
 assert(!f.reads.some(p=>p.startsWith('publicTournaments/')));
 assert.equal(f.records.at(-1).event,'complete');assert.equal(f.records.at(-1).attempt,2);assert.equal(f.records.at(-1).storage,'bucket');
 for(const phase of ['read-buckets','materialize','transition','queue-writes','commit'])assert(f.records.some(r=>r.phase===phase));
 assert(f.records.some(r=>r.event==='retry'));assert.equal(f.cancelled(),1);
 for(const secret of ['PRIVATE_TOKEN','PRIVATE_PLAYER','private-operation-identifier','ref1'])assert(!JSON.stringify(f.records).includes(secret));
});
test('bucket completion waits for commit acknowledgement; watchdog observes without cancelling',async()=>{
 const f=setup({holdCommit:true}),promise=f.handle(f.req);await f.pending;
 assert(!f.records.some(r=>r.event==='complete'));assert.equal(f.writes.length,0);
 f.advance(20000);f.alarm();assert.equal(f.records.at(-1).event,'slow');assert.equal(f.records.at(-1).phase,'commit');assert.equal(f.cancelled(),0);
 f.acknowledge();assert((await promise).ok);assert.equal(f.records.at(-1).event,'complete');assert.equal(f.cancelled(),1);
});
test('bucket receipt replay logs a separate replay completion without another write',async()=>{
 const f=setup();await f.handle(f.req);const before=f.writes.length;
 assert.equal((await f.handle(f.req)).replayed,true);assert.equal(f.writes.length,before);
 assert.equal(f.records.at(-1).phase,'commit-replay');assert.equal(f.records.at(-1).event,'complete');assert.equal(f.cancelled(),2);
});
test('bucket read watchdog identifies the waiting read separately from commit',async()=>{
 const f=setup({holdBucketRead:true}),promise=f.handle(f.req);await f.pending;
 f.advance(20000);f.alarm();assert.equal(f.records.at(-1).event,'slow');assert.equal(f.records.at(-1).phase,'read-buckets');assert.equal(f.writes.length,0);
 f.acknowledge();assert((await promise).ok);assert.equal(f.records.at(-1).event,'complete');assert.equal(f.cancelled(),1);
});
test('bucket transaction failure preserves original error and never claims success',async()=>{
 const error=Object.assign(Error('PRIVATE_DATABASE_FAILURE'),{code:4}),f=setup({failure:error});
 await assert.rejects(f.handle(f.req),e=>e===error);assert.equal(f.writes.length,0);
 assert(!f.records.some(r=>r.event==='complete'));assert.equal(f.records.at(-1).event,'failed');assert.equal(f.records.at(-1).errorCode,4);assert.equal(f.cancelled(),1);
 assert(!JSON.stringify(f.records).includes('PRIVATE_DATABASE_FAILURE'));
});
test('bucket logging failure cannot prevent scoring; invalid input starts no diagnostic',async()=>{
 const f=setup({brokenLogger:true});assert((await f.handle(f.req)).ok);assert.equal(f.cancelled(),1);
 const g=setup();g.req.auth=null;await assert.rejects(g.handle(g.req),/unauthenticated/);assert.equal(g.records.length,0);assert.equal(g.cancelled(),0);
});
