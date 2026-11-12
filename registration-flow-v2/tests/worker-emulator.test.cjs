'use strict';
const {test,after}=require('node:test'),assert=require('node:assert/strict');
const {db,service,seed,request,audit}=require('./harness.cjs');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
after(()=>db.terminate());

test('a foreign live lease is refused without an acquisition transaction',async()=>{
 const {code,ids:[uid]}=await seed(1),timings=[],worker=service({onTiming:x=>timings.push(x)});
 await worker.enqueue(uid,request(code,uid));
 const lease=db.doc('_registrationQueueV2/'+code);
 await lease.set({owner:'foreign-worker',token:'foreign-token',until:Date.now()+30000});
 assert.deepEqual(await worker.drain(code),{busy:true,processed:0});
 assert.equal(timings.filter(x=>x.phase==='lease-read').length,1);
 assert.equal(timings.filter(x=>x.phase==='lease-acquire').length,0);
 assert.equal((await lease.get()).data().token,'foreign-token');
 assert.equal((await audit(code,0)).summary.completed,0);
 await lease.update({until:0});await worker.drain(code);
 assert.equal((await audit(code,1)).summary.completed,1);
});

test('twenty local drains share a real Firestore batch and commit one registration',async()=>{
 const {code,ids:[uid]}=await seed(1),entered=deferred(),resume=deferred(),timings=[];
 const worker=service({onTiming:x=>{timings.push(x);},
  beforeExecute:async()=>{entered.resolve();await resume.promise;}});
 const operation=request(code,uid);await worker.enqueue(uid,operation);
 const id=worker.jobRef(code,uid,operation.operationId).id;
 const first=worker.drainCreatedJob(code,id);await entered.promise;
 const originalRead=db.doc('_registrationQueueV2/'+code+'/_registrationQueueJobsV2/'+id);
 assert.equal((await originalRead.get()).data().state,'running');
 // These calls synchronously join the in-flight drain before returning their
 // promises, so this assertion does not rely on a timed sleep.
 const calls=Array.from({length:19},()=>worker.drain(code));
 resume.resolve();await Promise.all([first,...calls]);
 const result=await audit(code,1);
 assert.equal(result.summary.jobs,1);assert.equal(result.summary.completed,1);
 assert.equal(result.jobs[0].attempts,1);
 assert.equal(timings.filter(x=>x.phase==='lease-acquire').length,1);
 assert.equal(timings.filter(x=>x.phase==='local-drain-wait').length,19);
 assert.ok(timings.some(x=>x.phase==='handler'));
});
