'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createDissolutionCoordinator,CONTROL}=require('./auto-dissolve-coordinator.cjs');
function fixture(enabled=true){let data=null,calls=0;const db={doc:p=>p,runTransaction:async fn=>fn({get:async()=>({exists:!!data,data:()=>data}),set:(p,v)=>{assert.equal(p,CONTROL);data={...data,...v};}})};
 const worker={runSweepFrom:async cursor=>{calls++;return {examined:100,dissolved:0,failed:100,batches:5,mayHaveMore:true,nextCursor:cursor?null:{dueAt:123,id:'team100'}};}};
 return {run:createDissolutionCoordinator({db,worker,enabled:()=>enabled,clock:()=>1000,newId:()=> 'lease'}).run,get data(){return data;},get calls(){return calls;}};
}
test('checkpoint resumes on a later run and resets after the sweep is complete',async()=>{const f=fixture();await f.run();assert.deepEqual(f.data.cursor,{dueAt:123,id:'team100'});await f.run();assert.equal(f.data.cursor,null);assert.equal(f.calls,2);});
test('disabled job has no database or worker work',async()=>{const f=fixture(false);assert.deepEqual(await f.run(),{status:'disabled'});assert.equal(f.data,null);assert.equal(f.calls,0);});
