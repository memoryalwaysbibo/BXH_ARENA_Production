'use strict';
// Integration factory, deliberately not required by the production entrypoint.
// Operators must first capture every live writer and deploy server configuration,
// Rules/indexes and the frontend together. Tests do not deploy these exports.
const {createQueue}=require('./queue.cjs');
const {createApi}=require('./api.cjs');
const {createManagementApi}=require('./management.cjs');
function createBindings({db,FieldValue,createFamilyRegistration,rosterFactory,promotionFactory,authorizeManagement,enabled=async()=>false}){
 if(createFamilyRegistration?.v2CapacityAware!==true)throw Error('queue-family-capacity-source-required');
 const familyFactory=store=>createFamilyRegistration(store,Date.now,{myEventsProofEnabled:true});
 if(typeof promotionFactory!=='function')throw Error('queue-promotion-factory-required');
 const {onCall,HttpsError}=require('firebase-functions/v2/https');
 const {onDocumentCreated}=require('firebase-functions/v2/firestore');
 const {onSchedule}=require('firebase-functions/v2/scheduler');
 const queue=createQueue(db,{FieldValue,requireRoomOwnership:true,handlers:{family:familyFactory,roster:rosterFactory,promotion:promotionFactory}});
 const api=createApi({queue,family:familyFactory(db),enabled});
 const managementApi=createManagementApi({queue,enabled,authorize:authorizeManagement});
 const bind=handler=>onCall({region:'asia-east1',cors:true,timeoutSeconds:30,maxInstances:5},async req=>{
  try{return await handler(req);}catch(error){
   const m=String(error.message||'');
   if(m==='auth-required')throw new HttpsError('unauthenticated',m);
   if(m==='invalid-operation')throw new HttpsError('invalid-argument',m);
   if(m==='permission-denied'||m==='not-found')throw new HttpsError(m,m);
   if(['registration-queue-disabled','operation-conflict'].includes(m))throw new HttpsError('failed-precondition',m);
   throw new HttpsError('unavailable','registration-operation-unconfirmed');
  }
 });
 const registrationQueueV2=bind(api);
 const registrationRosterQueueV2=bind(managementApi);
 const registrationQueueV2Worker=onDocumentCreated({region:'asia-east1',document:'_registrationQueueV2/{code}/_registrationQueueJobsV2/{job}',timeoutSeconds:60,maxInstances:5,retry:true},event=>queue.drainCreatedJob(event.params.code,event.params.job,{limit:200,budgetMs:45000}));
 const registrationQueueV2Sweep=onSchedule({region:'asia-east1',schedule:'every 1 minutes',timeoutSeconds:540,maxInstances:1},()=>queue.sweep());
 return {registrationQueueV2,registrationRosterQueueV2,registrationQueueV2Worker,registrationQueueV2Sweep};
}
module.exports={createBindings};
