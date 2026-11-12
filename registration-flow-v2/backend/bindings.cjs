'use strict';
// Integration factory, deliberately not required by the production entrypoint.
// Operators must first capture every live writer and deploy server configuration,
// Rules/indexes and the frontend together. Tests do not deploy these exports.
const {createQueue}=require('./queue.cjs');
const {createApi}=require('./api.cjs');
const {createManagementApi}=require('./management.cjs');
const {createStartHandler,createDrawHandler}=require('./lifecycle.cjs');
function createBindings({db,FieldValue,createFamilyRegistration,rosterFactory,promotionFactory,authorizeManagement,stagedOnly=false,enabled=async()=>false,workersEnabled=async()=>false,startEnabled,drawEnabled,pilotRoom=null,retiredRoom=null}){
 if(createFamilyRegistration?.v2CapacityAware!==true)throw Error('queue-family-capacity-source-required');
 const familyFactory=store=>createFamilyRegistration(store,Date.now,{myEventsProofEnabled:true});
 if(typeof promotionFactory!=='function')throw Error('queue-promotion-factory-required');
 const {onCall,HttpsError}=require('firebase-functions/v2/https');
 const {onDocumentCreated}=require('firebase-functions/v2/firestore');
 const {onSchedule}=require('firebase-functions/v2/scheduler');
 const workersReady=async()=>!stagedOnly&&await workersEnabled()===true;
 const roomAllowed=code=>pilotRoom===null||code===pilotRoom;
 const isRetired=code=>retiredRoom!==null&&code===retiredRoom;
 const intakeEnabled=async(code,tx)=>roomAllowed(code)&&!stagedOnly&&
  (pilotRoom!==null||await workersReady())&&await enabled(code,tx)===true;
 const queue=createQueue(db,{FieldValue,requireRoomOwnership:true,
  onTiming:fields=>console.info(JSON.stringify({event:'registration-v2-worker-phase',...fields})),
  authorizeIntake:pilotRoom===null?undefined:intakeEnabled,
  handlers:{family:familyFactory,roster:rosterFactory,promotion:promotionFactory}});
 const api=createApi({queue,family:familyFactory(db),enabled:code=>isRetired(code)||intakeEnabled(code)});
 const managementApi=createManagementApi({queue,enabled:intakeEnabled,authorize:authorizeManagement});
 const bind=(handler,{options,preconditions=[],allowRetired=()=>false}={})=>onCall({region:'asia-east1',cors:true,timeoutSeconds:30,maxInstances:5,...options},async req=>{
  const data=req.data;
  if(stagedOnly||(!roomAllowed(data?.code)&&!(isRetired(data?.code)&&allowRetired(data)))){
   throw new HttpsError('failed-precondition','registration-queue-disabled');
  }
  try{return await handler(req);}catch(error){
   const m=String(error.message||'');
   if(m==='auth-required')throw new HttpsError('unauthenticated',m);
   if(m==='invalid-operation')throw new HttpsError('invalid-argument',m);
   if(m==='permission-denied'||m==='not-found')throw new HttpsError(m,m);
   if(['registration-queue-disabled','operation-conflict','tournament-started',...preconditions].includes(m))throw new HttpsError('failed-precondition',m);
   throw new HttpsError('unavailable','registration-operation-unconfirmed');
  }
 });
 const registrationQueueV2=bind(api,{allowRetired:data=>data.action==='status'||data.action==='mine'});
 const registrationRosterQueueV2=bind(managementApi,{allowRetired:data=>data.action==='status'});
 const lifecycleOptions={
  options:{enforceAppCheck:true},
  // Lifecycle validates the original receipt before checking the write gate.
  allowRetired:()=>true,
  preconditions:['bracket-room-changed','bracket-started','draw-mode-not-supported','start-mode-not-supported','early-start-confirmation-required',
   'registration-roster-stale','bracket-version-conflict','qr-checkin-state-stale','registration-queue-pending','bracket-roster-changed'],
 };
 const registrationStartV2=bind(createStartHandler({db,enabled:startEnabled}),lifecycleOptions);
 const registrationDrawV2=bind(createDrawHandler({db,enabled:drawEnabled}),lifecycleOptions);
 const registrationQueueV2Worker=onDocumentCreated({region:'asia-east1',document:'_registrationQueueV2/{code}/_registrationQueueJobsV2/{job}',timeoutSeconds:60,maxInstances:5,retry:true},async event=>{
  if(roomAllowed(event.params.code)&&await workersReady())await queue.drainCreatedJob(event.params.code,event.params.job,{limit:200,budgetMs:45000});
 });
 const registrationQueueV2Sweep=onSchedule({region:'asia-east1',schedule:'every 1 minutes',timeoutSeconds:540,maxInstances:1},async()=>{
  if(await workersReady())await queue.sweep(pilotRoom);
 });
 return {registrationQueueV2,registrationRosterQueueV2,registrationQueueV2Worker,registrationQueueV2Sweep,registrationStartV2,registrationDrawV2};
}
function createPilotBindings({pilotRoom,retiredRoom=null,...dependencies}){
 const validRoom=code=>typeof code==='string'&&/^BXH-[A-Z0-9]{4,16}$/.test(code);
 if(!validRoom(pilotRoom))throw Error('invalid-pilot-room');
 if(retiredRoom!==null&&(!validRoom(retiredRoom)||retiredRoom===pilotRoom))throw Error('invalid-retired-room');
 const ref=dependencies.db.doc('systemSettings/registrationFlowV2Pilot');
 const allows=async(field,tx)=>{
  const snapshot=tx?await tx.get(ref):await ref.get();
  const config=snapshot.data();
  return config?.roomCode===pilotRoom&&config.workersEnabled===true&&config[field]===true;
 };
 const lifecycle=(code,tx)=>code===pilotRoom&&allows('lifecycleEnabled',tx);
 return createBindings({...dependencies,pilotRoom,retiredRoom,stagedOnly:false,
  workersEnabled:()=>allows('workersEnabled'),
  enabled:(_code,tx)=>allows('intakeEnabled',tx),
  drawEnabled:lifecycle,startEnabled:lifecycle,
 });
}
module.exports={createBindings,createPilotBindings};

