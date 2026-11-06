'use strict';
// Integration factory, deliberately not required by the production entrypoint.
// Operators must first capture every live writer and deploy server configuration,
// Rules/indexes and the frontend together. Tests do not deploy these exports.
const {createQueue}=require('./queue.cjs');
const {createApi}=require('./api.cjs');
function createBindings({db,FieldValue,familyFactory,rosterFactory,enabled=async()=>false}){
 const {onCall,HttpsError}=require('firebase-functions/v2/https');
 const {onDocumentCreated}=require('firebase-functions/v2/firestore');
 const {onSchedule}=require('firebase-functions/v2/scheduler');
 const queue=createQueue(db,{FieldValue,handlers:{family:familyFactory,roster:rosterFactory}});
 const api=createApi({queue,family:familyFactory(db),enabled});
 const registrationQueueV2=onCall({region:'asia-east1',cors:true,timeoutSeconds:30,maxInstances:5},async req=>{
  try{return await api(req);}catch(error){
   const m=String(error.message||'');
   if(m==='auth-required')throw new HttpsError('unauthenticated',m);
   if(m==='invalid-operation')throw new HttpsError('invalid-argument',m);
   if(m==='permission-denied')throw new HttpsError('permission-denied',m);
   if(['registration-queue-disabled','operation-conflict'].includes(m))throw new HttpsError('failed-precondition',m);
   throw new HttpsError('unavailable','registration-operation-unconfirmed');
  }
 });
 const registrationQueueV2Worker=onDocumentCreated({region:'asia-east1',document:'_registrationQueueV2/{code}/_registrationQueueJobsV2/{job}',timeoutSeconds:60,maxInstances:5,retry:true},event=>queue.drain(event.params.code,{limit:200,budgetMs:45000}));
 const registrationQueueV2Sweep=onSchedule({region:'asia-east1',schedule:'every 1 minutes',timeoutSeconds:540,maxInstances:1},()=>queue.sweep());
 return {registrationQueueV2,registrationQueueV2Worker,registrationQueueV2Sweep};
}
module.exports={createBindings};
