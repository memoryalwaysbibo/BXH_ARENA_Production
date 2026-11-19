'use strict';
// Integration factory, deliberately not required by the production entrypoint.
// Operators must first capture every live writer and deploy server configuration,
// Rules/indexes and the frontend together. Tests do not deploy these exports.
const {createQueue}=require('./queue.cjs');
const {createApi}=require('./api.cjs');
const {createManagementApi}=require('./management.cjs');
const {createStartHandler,createDrawHandler,createTicketForfeitHandler}=require('./lifecycle.cjs');
const {createTicketRoomHandler,createTicketRoomStateHandler,createTicketRemoveHandler}=require('./ticket-room-create.cjs');
function createBindings({db,FieldValue,createFamilyRegistration,rosterFactory,promotionFactory,authorizeManagement,stagedOnly=false,enabled=async()=>false,workersEnabled=async()=>false,startEnabled,drawEnabled,pilotRoom=null,retiredRoom=null,retiredRooms=[],ticketPilot=async()=>null}){
 if(createFamilyRegistration?.v2CapacityAware!==true)throw Error('queue-family-capacity-source-required');
 const familyFactory=store=>createFamilyRegistration(store,Date.now,{myEventsProofEnabled:true});
 if(typeof promotionFactory!=='function')throw Error('queue-promotion-factory-required');
 const {onCall,HttpsError}=require('firebase-functions/v2/https');
 const {onDocumentCreated}=require('firebase-functions/v2/firestore');
 const {onSchedule}=require('firebase-functions/v2/scheduler');
 const workersReady=async()=>!stagedOnly&&await workersEnabled()===true;
 const primaryRoom=code=>pilotRoom===null||code===pilotRoom;
 const ticketAllowed=async(code,tx)=>typeof code==='string'&&!!await ticketPilot(code,tx);
 const retired=new Set([...(retiredRoom===null?[]:[retiredRoom]),...retiredRooms]);
 const isRetired=code=>retired.has(code);
 const intakeEnabled=async(code,tx)=>!stagedOnly&&(primaryRoom(code)
  ?(pilotRoom!==null||await workersReady())&&await enabled(code,tx)===true
  :await ticketAllowed(code,tx));
 const queue=createQueue(db,{FieldValue,requireRoomOwnership:true,
  onTiming:fields=>console.info(JSON.stringify({event:'registration-v2-worker-phase',...fields})),
  authorizeIntake:pilotRoom===null?undefined:intakeEnabled,
  handlers:{family:familyFactory,roster:rosterFactory,promotion:promotionFactory}});
 const api=createApi({queue,family:familyFactory(db),enabled:code=>isRetired(code)||intakeEnabled(code)});
 const managementApi=createManagementApi({queue,enabled:intakeEnabled,authorize:authorizeManagement});
 const bind=(handler,{options,preconditions=[],allowRetired=()=>false}={})=>onCall({region:'asia-east1',cors:true,timeoutSeconds:30,maxInstances:5,...options},async req=>{
  const data=req.data;
  if(stagedOnly||(!primaryRoom(data?.code)&&!(isRetired(data?.code)&&allowRetired(data))&&
      !(req.auth?.uid&&await ticketAllowed(data?.code)))){
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
 const ticketRoomActions={
  'create-ticket-room':createTicketRoomHandler({db}),
  'ticket-room-state':createTicketRoomStateHandler({db}),
  'ticket-room-forfeit':createTicketForfeitHandler({db,enabled:startEnabled}),
  'ticket-room-remove':createTicketRemoveHandler({db,queue,enabled:intakeEnabled}),
 };
 const registrationRosterQueueV2=bind(req=>{
  const action=req.data?.action;
  return Object.hasOwn(ticketRoomActions,action)?ticketRoomActions[action](req):managementApi(req);
 },{
  allowRetired:data=>data.action==='status',
  preconditions:['ticket-lifecycle-disabled','ticket-binding-invalid','ticket-expired','ticket-unavailable',
   'room-code-conflict','room-receipt-inconsistent','bracket-room-changed',
   'forfeit-room-not-live','forfeit-match-stale','forfeit-round-waiting'],
 });
 const lifecycleOptions={
  options:{enforceAppCheck:true},
  // Lifecycle validates the original receipt before checking the write gate.
  allowRetired:()=>true,
  preconditions:['bracket-room-changed','bracket-started','draw-mode-not-supported','start-mode-not-supported','early-start-confirmation-required',
   'ticket-lifecycle-disabled','ticket-binding-invalid','ticket-expired','ticket-capacity-invalid',
   'registration-roster-stale','bracket-version-conflict','qr-checkin-state-stale','registration-queue-pending','bracket-roster-changed'],
 };
 const registrationStartV2=bind(createStartHandler({db,enabled:startEnabled}),lifecycleOptions);
 const registrationDrawV2=bind(createDrawHandler({db,enabled:drawEnabled}),lifecycleOptions);
 const registrationQueueV2Worker=onDocumentCreated({region:'asia-east1',document:'_registrationQueueV2/{code}/_registrationQueueJobsV2/{job}',timeoutSeconds:60,maxInstances:5,retry:true},async event=>{
  const {code,job}=event.params;
  if(!stagedOnly&&(primaryRoom(code)?await workersReady():await ticketAllowed(code))){
   await queue.drainCreatedJob(code,job,{limit:200,budgetMs:45000});
  }
 });
 const registrationQueueV2Sweep=onSchedule({region:'asia-east1',schedule:'every 1 minutes',timeoutSeconds:540,maxInstances:1},async()=>{
  if(await workersReady())await queue.sweep(pilotRoom);
  if(!stagedOnly&&pilotRoom!==null){
   const ticket=await ticketPilot();
   if(ticket)await queue.sweep(ticket.roomCode);
  }
 });
 return {registrationQueueV2,registrationRosterQueueV2,registrationQueueV2Worker,registrationQueueV2Sweep,registrationStartV2,registrationDrawV2};
}
function createPilotBindings({pilotRoom,retiredRoom=null,retiredRooms=[],...dependencies}){
 const validRoom=code=>typeof code==='string'&&/^BXH-[A-Z0-9]{4,16}$/.test(code);
 if(!validRoom(pilotRoom))throw Error('invalid-pilot-room');
 if(!Array.isArray(retiredRooms)||retiredRooms.length>8)throw Error('invalid-retired-room');
 const retired=[...(retiredRoom===null?[]:[retiredRoom]),...retiredRooms];
 if(retired.some(code=>!validRoom(code)||code===pilotRoom)||new Set(retired).size!==retired.length)throw Error('invalid-retired-room');
 const ref=dependencies.db.doc('systemSettings/registrationFlowV2Pilot');
 const allows=async(field,tx)=>{
  const snapshot=tx?await tx.get(ref):await ref.get();
  const config=snapshot.data();
  return config?.roomCode===pilotRoom&&config.workersEnabled===true&&config[field]===true;
 };
 const ticketRef=dependencies.db.doc('systemSettings/commerceTicketLifecycleV1');
 const ticketPilot=async(code,tx)=>{
  if(code!==undefined&&(!validRoom(code)||code===pilotRoom||retired.includes(code)))return null;
  const snapshot=tx?await tx.get(ticketRef):await ticketRef.get();
  const config=snapshot.data();
  if(config?.enabled!==true||config.bindingEnabled!==true||!validRoom(config.roomCode)||
     config.roomCode===pilotRoom||retired.includes(config.roomCode)||
     (code!==undefined&&code!==config.roomCode)||
     !/^[A-Za-z0-9_-]{1,128}$/.test(config.ownerUid||'')||
     !/^[A-Za-z0-9_-]{8,100}$/.test(config.roomId||''))return null;
  return config;
 };
 const lifecycle=async(code,tx)=>code===pilotRoom
  ?allows('lifecycleEnabled',tx):!!await ticketPilot(code,tx);
 return createBindings({...dependencies,pilotRoom,retiredRoom,retiredRooms,stagedOnly:false,
  workersEnabled:()=>allows('workersEnabled'),
  enabled:(_code,tx)=>allows('intakeEnabled',tx),
  ticketPilot,drawEnabled:lifecycle,startEnabled:lifecycle,
 });
}
module.exports={createBindings,createPilotBindings};
