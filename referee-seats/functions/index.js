'use strict';
const {initializeApp,getApps}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {createHandler}=require('./service.cjs');
if(!getApps().length)initializeApp();
const handle=createHandler(getFirestore());
const {createStaffRosterHandler}=require('./staff-roster-service.cjs');
const readStaffRoster=createStaffRosterHandler(getFirestore());
exports.readStaffRegistrationRoster=onCall({region:'asia-east1',timeoutSeconds:30,maxInstances:10,invoker:'public'},async request=>{
 try{return await readStaffRoster(request);}catch(error){
  const reason=['unauthenticated','permission-denied','not-found','invalid-code'].includes(error.message)?error.message:'roster-read-failed';
  const code=reason==='invalid-code'?'invalid-argument':reason==='roster-read-failed'?'internal':reason;
  throw new HttpsError(code,reason);
 }
});
exports.manageRefereeSeats=onCall({region:'asia-east1',timeoutSeconds:30,maxInstances:10,invoker:'public'},async request=>{
 try{return await handle(request);}catch(error){
  const denied=['unauthenticated','permission-denied','not-event-staff','requester-ineligible','target-ineligible'];
  const code=error.message==='unauthenticated'?'unauthenticated':denied.includes(error.message)?'permission-denied':'failed-precondition';
  throw new HttpsError(code,error.seatCode||error.message);
 }
});

const {createScoringHandler}=require('./scoring-service.cjs');
const score=createScoringHandler(getFirestore());
exports.commitRefereeCommand=onCall({region:'asia-east1',timeoutSeconds:30,maxInstances:10,invoker:'public'},async request=>{
 try{return await score(request);}catch(error){
  const denied=['permission-denied','station-not-assigned','not-event-staff'];
  throw new HttpsError(error.message==='unauthenticated'?'unauthenticated':denied.includes(error.message)?'permission-denied':'failed-precondition',error.seatCode||error.message);
 }
});

