'use strict';
const SCHEMAS=new Set(['bxh-match-buckets-v1','bxh-court-buckets-v2']);
function createBucketProjectionEventHandler({publish,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 const pending=new Map();
 return async event=>{
  const code=event.params?.code,id=event.params?.bucketId,after=event.data?.after;
  if(!after?.exists)return {ok:true,skipped:true,reason:'bucket-deleted'};
  const bucket=after.data();
  if(!/^BXH-[A-Z0-9]{4,16}$/.test(code||'')||!/^court-[1-9][0-9]*$/.test(id||'')||!SCHEMAS.has(bucket?.schema)||bucket.code!==code||bucket.bucketId!==id||typeof bucket.epoch!=='string'||!bucket.epoch||!Number.isSafeInteger(bucket.revision)||bucket.revision<0)return {ok:true,skipped:true,reason:'invalid-bucket-event'};
  // Serialize this process's publications for a room. Event delivery can overlap
  // in the emulator or across retries; never discard the later event's work.
  const previous=pending.get(code)||Promise.resolve();
  const task=previous.catch(()=>{}).then(async()=>{
   await wait(150);
   for(let attempt=0;attempt<3;attempt++){
    try{return await publish(code,{automatic:true,expectedEpoch:bucket.epoch});}
    catch(error){
     if(['release-not-ready','not-found','bucket-not-ready','bucket-room-not-enabled'].includes(error.message))return {ok:true,skipped:true,reason:error.message};
     // Re-capture the complete snapshot after structural/public authority changes.
     // Exhaustion still rejects, allowing the platform's durable event retry.
     if(error.message!=='projection-source-changed'||attempt===2)throw error;
     await wait(50*(attempt+1));
    }
   }
  });
  pending.set(code,task);
  try{return await task;}finally{if(pending.get(code)===task)pending.delete(code);}
 };
}
function createBucketProjectionDefinition({onDocumentWritten,publish,wait}){
 return onDocumentWritten({document:'tournaments/{code}/matchBuckets/{bucketId}',region:'asia-east1',maxInstances:1,concurrency:1,timeoutSeconds:30,retry:true},createBucketProjectionEventHandler({publish,wait}));
}
module.exports={createBucketProjectionEventHandler,createBucketProjectionDefinition};
