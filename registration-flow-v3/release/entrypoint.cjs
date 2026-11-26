'use strict';
const {initializeApp,getApps}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {createApi}=require('./registration-flow-v3/api.cjs');
const {createRoomHandler}=require('./registration-flow-v3/create-room.cjs');
if(!getApps().length)initializeApp();
const db=getFirestore();
const settings={region:'asia-east1',timeoutSeconds:60,maxInstances:10,enforceAppCheck:true,invoker:'public'};
const invalid=new Set(['invalid-code','invalid-operation','invalid-cursor','invalid-limit','invalid-room-settings','invalid-participant']);
const denied=new Set(['permission-denied','super-admin-required','app-check-required']);
const expected=new Set(['registration-busy','registration-v3-required','registration-state-conflict','already-registered','full','not-pending-review','not-active-registration','registration-attempt-changed','operation-conflict','room-code-conflict','registration-name-missing','tournament-started','registration-mode-not-supported']);
function wrap(handler){
 return onCall(settings,async request=>{
  // Deployment alone does not enable the candidate. Never accept a client flag.
  if(process.env.BXH_REGISTRATION_V3_ENABLED!=='true')throw new HttpsError('failed-precondition','registration-v3-disabled');
  try{return await handler(request);}catch(error){
   const reason=error.message;
   if(reason==='auth-required')throw new HttpsError('unauthenticated',reason);
   if(denied.has(reason))throw new HttpsError('permission-denied',reason);
   if(invalid.has(reason))throw new HttpsError('invalid-argument',reason);
   if(expected.has(reason))throw new HttpsError('failed-precondition',reason);
   throw new HttpsError('internal','registration-v3-service-error');
  }
 });
}
const observe=metrics=>console.info(JSON.stringify({event:'registration-v3-transaction',...metrics}));
exports.registrationFlowV3=wrap(createApi({db,observe}));
exports.createRegistrationRoomV3=wrap(createRoomHandler({db}));
