'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{createBucketCallableDefinitions,wrapBucketHandler}=require('../../referee-seats/functions/bucket-callable.cjs');
class HttpsError extends Error{constructor(code,message,details){super(message);this.code=code;this.details=details;}}
test('both candidate Callable definitions always enforce App Check',()=>{
 const options=[];const definitions=createBucketCallableDefinitions({onCall:(o,handler)=>{options.push(o);return handler;},HttpsError,scoreHandler:async()=>({ok:true}),seatHandler:async()=>({ok:true})});assert.equal(Object.keys(definitions).length,2);assert(options.every(o=>o.enforceAppCheck===true&&o.region==='asia-east1'));
});
test('missing Auth or App Check is rejected before any trusted handler call',async()=>{
 let calls=0;const handle=wrapBucketHandler(async()=>{calls++;return {ok:true};},HttpsError);
 await assert.rejects(handle({data:{}}),e=>e.code==='unauthenticated'&&e.message==='auth-required');await assert.rejects(handle({auth:{uid:'ref'},data:{}}),/app-check-required/);assert.equal(calls,0);
 assert.equal((await handle({auth:{uid:'ref'},app:{appId:'verified-app'},data:{}})).ok,true);assert.equal(calls,1);
});
test('domain errors stay typed and unexpected errors do not expose backend details',async()=>{
 const req={auth:{uid:'ref'},app:{appId:'verified-app'}};
 await assert.rejects(wrapBucketHandler(async()=>{throw Error('station-not-assigned');},HttpsError)(req),e=>e.code==='permission-denied'&&e.details.reason==='station-not-assigned');
 await assert.rejects(wrapBucketHandler(async()=>{throw Error('database details must stay private');},HttpsError)(req),e=>e.code==='internal'&&e.message==='bucket-unavailable');
});
