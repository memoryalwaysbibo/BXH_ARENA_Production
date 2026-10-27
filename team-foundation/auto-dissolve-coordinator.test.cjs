'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createDissolutionCoordinator,CONTROL}=require('./auto-dissolve-coordinator.cjs');
function fixture(enabled=true){let data=null,calls=0;const db={doc:p=>p,runTransaction:async fn=>fn({get:async()=>({exists:!!data,data:()=>data}),set:(p,v)=>{assert.equal(p,CONTROL);data={...data,...v};}})};
 const worker={runSweepFrom:async cursor=>{calls++;return {examined:100,dissolved:0,failed:100,batches:5,mayHaveMore:true,nextCursor:cursor?null:{dueAt:123,id:'team100'}};}};
 return {run:createDissolutionCoordinator({db,worker,enabled:()=>enabled,clock:()=>1000,newId:()=> 'lease'}).run,get data(){return data;},get calls(){return calls;}};
}
test('checkpoint resumes on a later run and resets after the sweep is complete',async()=>{const f=fixture();await f.run();assert.deepEqual(f.data.cursor,{dueAt:123,id:'team100'});await f.run();assert.equal(f.data.cursor,null);assert.equal(f.calls,2);});
test('disabled job has no database or worker work',async()=>{const f=fixture(false);assert.deepEqual(await f.run(),{status:'disabled'});assert.equal(f.data,null);assert.equal(f.calls,0);});
test('overlapping invocations do not run another sweep while the lease is active',async()=>{
 let data=null,release,calls=0;const gate=new Promise(resolve=>{release=resolve;});
 const db={doc:p=>p,runTransaction:async fn=>fn({get:async()=>({exists:!!data,data:()=>data}),set:(p,v)=>{data={...data,...v};}})};
 const worker={runSweepFrom:async()=>{calls++;await gate;return {examined:0,dissolved:0,failed:0,batches:1,mayHaveMore:false,nextCursor:null};}};
 let seq=0;const run=createDissolutionCoordinator({db,worker,enabled:()=>true,clock:()=>1000,newId:()=>String(++seq)}).run;
 const first=run();while(!calls)await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(await run(),{status:'busy'});release();assert.equal((await first).status,'completed');assert.equal(calls,1);
});
test('failed sweeps release their own lease without advancing cursor',async()=>{
 let data={cursor:{dueAt:10,id:'t'}},calls=0;const db={doc:p=>p,runTransaction:async fn=>fn({get:async()=>({exists:true,data:()=>data}),set:(p,v)=>{data={...data,...v};}})};
 const run=createDissolutionCoordinator({db,worker:{runSweepFrom:async()=>{calls++;throw Error('offline');}},enabled:()=>true,clock:()=>1000,newId:()=> 'lease'}).run;
 await assert.rejects(run(),/offline/);assert.equal(data.leaseId,null);assert.deepEqual(data.cursor,{dueAt:10,id:'t'});await assert.rejects(run(),/offline/);assert.equal(calls,2);
});
test('expired worker cannot overwrite a newer owner checkpoint',async()=>{
 let data=null,now=1000;const db={doc:p=>p,runTransaction:async fn=>fn({get:async()=>({exists:!!data,data:()=>data}),set:(p,v)=>{data={...data,...v};}})};
 const worker={runSweepFrom:async()=>{now+=700000;data={...data,leaseId:'new',leaseUntil:now+1000,cursor:{dueAt:1,id:'new'}};return {examined:1,dissolved:0,failed:0,batches:1,mayHaveMore:true,nextCursor:{dueAt:2,id:'old'}};}};
 const result=await createDissolutionCoordinator({db,worker,enabled:()=>true,clock:()=>now,newId:()=> 'old'}).run();assert.equal(result.status,'lease-expired');assert.deepEqual(data.cursor,{dueAt:1,id:'new'});assert.equal(data.leaseId,'new');
});
