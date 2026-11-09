'use strict';
// Integration factory, deliberately not required by the production entrypoint.
// Operators must first capture every live writer and deploy server configuration,
// Rules/indexes and the frontend together. Tests do not deploy these exports.
const {createQueue}=require('./queue.cjs');
const {createApi}=require('./api.cjs');
const {createManagementApi}=require('./management.cjs');
const {createStartHandler,createDrawHandler}=require('./lifecycle.cjs');
function createBindings({db,FieldValue,createFamilyRegistration,rosterFactory,promotionFactory,authorizeManagement,enabled=async()=>false,workersEnabled=async()=>false,startEnabled,drawEnabled}){
 if(createFamilyRegistration?.v2CapacityAware!==true)throw Error('queue-family-capacity-source-required');
 const familyFactory=store=>createFamilyRegistration(store,Date.now,{myEventsProofEnabled:true});
 if(typeof promotionFactory!=='function')throw Error('queue-promotion-factory-required');
 const {onCall,HttpsError}=require('firebase-functions/v2/https');
 const {onDocumentCreated}=require('firebase-functions/v2/firestore');
 const {onSchedule}=require('firebase-functions/v2/scheduler');
 const queue=createQueue(db,{FieldValue,requireRoomOwnership:true,handlers:{family:familyFactory,roster:rosterFactory,promotion:promotionFactory}});
 const workersReady=async()=>await workersEnabled()===true;
 const intakeEnabled=async code=>await workersReady()&&await enabled(code)===true;
 const api=createApi({queue,family:familyFactory(db),enabled:intakeEnabled});
 const managementApi=createManagementApi({queue,enabled:intakeEnabled,authorize:authorizeManagement});
 const bind=(handler,{options,preconditions=[]}={})=>onCall({region:'asia-east1',cors:true,timeoutSeconds:30,maxInstances:5,...options},async req=>{
  try{return await handler(req);}catch(error){
   const m=String(error.message||'');
   if(m==='auth-required')throw new HttpsError('unauthenticated',m);
   if(m==='invalid-operation')throw new HttpsError('invalid-argument',m);
   if(m==='permission-denied'||m==='not-found')throw new HttpsError(m,m);
   if(['registration-queue-disabled','operation-conflict','tournament-started',...preconditions].includes(m))throw new HttpsError('failed-precondition',m);
   throw new HttpsError('unavailable','registration-operation-unconfirmed');
  }
 });
 const registrationQueueV2=bind(api);
 const registrationRosterQueueV2=bind(managementApi);
 const lifecycleOptions={
  options:{enforceAppCheck:true},
  preconditions:['bracket-room-changed','bracket-started','draw-mode-not-supported','start-mode-not-supported','early-start-confirmation-required',
   'registration-roster-stale','bracket-version-conflict','qr-checkin-state-stale','registration-queue-pending','bracket-roster-changed'],
 };
 const registrationStartV2=bind(createStartHandler({db,enabled:startEnabled}),lifecycleOptions);
 const registrationDrawV2=bind(createDrawHandler({db,enabled:drawEnabled}),lifecycleOptions);
 const registrationQueueV2Worker=onDocumentCreated({region:'asia-east1',document:'_registrationQueueV2/{code}/_registrationQueueJobsV2/{job}',timeoutSeconds:60,maxInstances:5,retry:true},async event=>{
  if(await workersReady())await queue.drainCreatedJob(event.params.code,event.params.job,{limit:200,budgetMs:45000});
 });
 const registrationQueueV2Sweep=onSchedule({region:'asia-east1',schedule:'every 1 minutes',timeoutSeconds:540,maxInstances:1},async()=>{
  if(await workersReady())await queue.sweep();
 });
 return {registrationQueueV2,registrationRosterQueueV2,registrationQueueV2Worker,registrationQueueV2Sweep,registrationStartV2,registrationDrawV2};
}
module.exports={createBindings};
