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
 for(const reason of ['release-not-ready','not-found','bucket-not-ready'])assert.equal((await createBucketProjectionEventHandler({wait:async()=>{},publish:async()=>{throw Error(reason);}})(event())).reason,reason);
 for(const reason of ['bucket-context','unavailable'])await assert.rejects(createBucketProjectionEventHandler({wait:async()=>{},publish:async()=>{throw Error(reason);}})(event()),new RegExp(reason));
});
