'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createBucketProjectionDefinition,createBucketProjectionEventHandler}=require('../../referee-seats/functions/bucket-projection-trigger.cjs');
const event=()=>({params:{code:'BXH-PROJECT1',bucketId:'court-1'},data:{after:{exists:true,data:()=>({schema:'bxh-match-buckets-v1',code:'BXH-PROJECT1',bucketId:'court-1',epoch:'generation-1',revision:4,matches:'stale score payload'})}}});
test('trigger is bounded to one concurrent writer and forwards only identity/epoch',async()=>{
 let options,called,delay;
 const handle=createBucketProjectionDefinition({onDocumentWritten:(o,h)=>{options=o;return h;},wait:async ms=>delay=ms,publish:async(...args)=>{called=args;return {ok:true};}});
 await handle(event());assert.equal(options.maxInstances,1);assert.equal(options.concurrency,1);assert.equal(options.retry,true);assert.equal(delay,150);assert.deepEqual(called,['BXH-PROJECT1',{automatic:true,expectedEpoch:'generation-1'}]);
});
test('deletion and malformed identity do not invoke the projection writer',async()=>{
 let count=0;const handle=createBucketProjectionEventHandler({wait:async()=>{},publish:async()=>count++});
 const deleted=event();deleted.data.after.exists=false;assert.equal((await handle(deleted)).reason,'bucket-deleted');
 const wrong=event();wrong.params.code='BXH-OTHER1';assert.equal((await handle(wrong)).reason,'invalid-bucket-event');assert.equal(count,0);
});
test('closed releases/removed rooms are skipped, while integrity and transient errors remain failures',async()=>{
 for(const reason of ['release-not-ready','not-found','bucket-not-ready','bucket-room-not-enabled'])assert.equal((await createBucketProjectionEventHandler({wait:async()=>{},publish:async()=>{throw Error(reason);}})(event())).reason,reason);
 for(const reason of ['bucket-context','unavailable'])await assert.rejects(createBucketProjectionEventHandler({wait:async()=>{},publish:async()=>{throw Error(reason);}})(event()),new RegExp(reason));
});
test('same-room events queue without losing later work and other rooms remain independent',async()=>{
 let release,started=0,active=0,max=0;const hold=new Promise(r=>release=r);
 const handle=createBucketProjectionEventHandler({wait:async()=>{},publish:async(code)=>{started++;active++;max=Math.max(max,active);if(started===1)await hold;active--;return {ok:true,code};}});
 const first=handle(event());await new Promise(setImmediate);const second=handle(event());
 const other=event();other.params.code='BXH-PROJECT2';other.data.after.data=()=>({...event().data.after.data(),code:'BXH-PROJECT2'});
 await handle(other);assert.equal(started,2);release();await Promise.all([first,second]);assert.equal(started,3);assert.equal(max,2);
});
test('source changes are re-captured with bounded retries and exhaustion releases the queue',async()=>{
 let calls=0;const handle=createBucketProjectionEventHandler({wait:async()=>{},publish:async()=>{if(++calls<=3)throw Error('projection-source-changed');return {ok:true};}});
 await assert.rejects(handle(event()),/projection-source-changed/);assert.equal(calls,3);
 assert.equal((await handle(event())).ok,true);assert.equal(calls,4);
 let attempts=0;const recover=createBucketProjectionEventHandler({wait:async()=>{},publish:async()=>{if(++attempts===1)throw Error('projection-source-changed');return {ok:true};}});
 assert.equal((await recover(event())).ok,true);assert.equal(attempts,2);
});
