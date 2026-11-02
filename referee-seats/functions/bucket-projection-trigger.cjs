'use strict';
const SCHEMA='bxh-match-buckets-v1';
function createBucketProjectionEventHandler({publish,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 return async event=>{
  const code=event.params?.code,id=event.params?.bucketId,after=event.data?.after;
  if(!after?.exists)return {ok:true,skipped:true,reason:'bucket-deleted'};
  const bucket=after.data();
  if(!/^BXH-[A-Z0-9]{4,16}$/.test(code||'')||!/^court-[1-9][0-9]*$/.test(id||'')||bucket?.schema!==SCHEMA||bucket.code!==code||bucket.bucketId!==id||typeof bucket.epoch!=='string'||!bucket.epoch||!Number.isSafeInteger(bucket.revision)||bucket.revision<0)return {ok:true,skipped:true,reason:'invalid-bucket-event'};
  // Briefly gather a burst. The transaction reads current buckets, never the
  // event's score payload. Version-vector deduplication suppresses old repeats.
  await wait(150);
  try{return await publish(code,{automatic:true,expectedEpoch:bucket.epoch});}
  catch(error){
   if(['release-not-ready','not-found','bucket-not-ready','bucket-room-not-enabled'].includes(error.message))return {ok:true,skipped:true,reason:error.message};
   throw error;
  }
 };
}
function createBucketProjectionDefinition({onDocumentWritten,publish,wait}){
 return onDocumentWritten({document:'tournaments/{code}/matchBuckets/{bucketId}',region:'asia-east1',maxInstances:1,concurrency:1,timeoutSeconds:30,retry:true},createBucketProjectionEventHandler({publish,wait}));
}
module.exports={createBucketProjectionEventHandler,createBucketProjectionDefinition};
