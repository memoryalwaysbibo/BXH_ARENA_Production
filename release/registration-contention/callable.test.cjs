'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {wrap}=require('./callable-fixture.cjs');
const {definitive}=require('../../modules/main-app/registration-feedback.js');
test('captured onCall options retain region, timeout and maxInstances',()=>{
 assert.deepEqual(wrap(async()=>({ok:true})).options,{region:'asia-east1',cors:true,timeoutSeconds:60,maxInstances:5});
});
test('captured project guard prevents delegate invocation outside production',async()=>{
 let calls=0;const call=wrap(async()=>{calls++;},{projectId:'demo-bxh-registration40'});
 await assert.rejects(call({}),e=>e.code==='functions/failed-precondition'&&e.message==='production-only');assert.equal(calls,0);
});
for(const reason of ['queue-full','queue-timeout'])test('captured error adapter keeps '+reason+' uncertain at the frontend',async()=>{
 const call=wrap(async()=>{throw Object.assign(Error('registration-admission-pending: '+reason),{code:'registration-admission-pending',details:{reason}});});
 await assert.rejects(call({}),e=>e.code==='functions/internal'&&e.message==='family-registration-unavailable'&&definitive(e)===false);
});
test('captured adapter retains business rejection and authentication mapping',async()=>{
 await assert.rejects(wrap(async()=>{throw Error('closed');})({}),e=>e.code==='functions/failed-precondition'&&e.message==='closed'&&definitive(e));
 await assert.rejects(wrap(async()=>{throw Error('auth-required');})({}),e=>e.code==='functions/unauthenticated');
});
