'use strict';
const {initializeApp,getApps}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {createHandler}=require('./service.cjs');
if(!getApps().length)initializeApp();
const handle=createHandler(getFirestore());
exports.manageRefereeSeats=onCall({region:'asia-east1',timeoutSeconds:30,maxInstances:10,invoker:'public'},async request=>{
 try{return await handle(request);}catch(error){
  const denied=['unauthenticated','permission-denied','not-event-staff','requester-ineligible','target-ineligible'];
  const code=error.message==='unauthenticated'?'unauthenticated':denied.includes(error.message)?'permission-denied':'failed-precondition';
  throw new HttpsError(code,error.seatCode||error.message);
 }
});
