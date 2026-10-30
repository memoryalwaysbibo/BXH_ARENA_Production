'use strict';
const {initializeApp,getApps}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {createStaffRosterHandler}=require('./service.cjs');
if(!getApps().length)initializeApp();
const read=createStaffRosterHandler(getFirestore());
exports.readStaffRegistrationRoster=onCall({region:'asia-east1',timeoutSeconds:30,maxInstances:10,invoker:'public'},async request=>{
 try{return await read(request);}catch(error){
  const reason=['unauthenticated','permission-denied','not-found','invalid-code'].includes(error.message)?error.message:'roster-read-failed';
  throw new HttpsError(reason==='invalid-code'?'invalid-argument':reason==='roster-read-failed'?'internal':reason,reason);
 }
});
