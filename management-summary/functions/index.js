'use strict';
const {initializeApp,getApps}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {createSummaryHandler}=require('./service.cjs');
if(!getApps().length)initializeApp();
const list=createSummaryHandler(getFirestore());
exports.listManagementTournamentSummaries=onCall({region:'asia-east1',timeoutSeconds:30,maxInstances:10,invoker:'public'},async request=>{
 try{return await list(request);}catch(error){
  const reason=['unauthenticated','permission-denied','invalid-argument','invalid-cursor'].includes(error.message)?error.message:'summary-read-failed';
  throw new HttpsError(reason==='invalid-cursor'?'invalid-argument':reason==='summary-read-failed'?'internal':reason,reason);
 }
});
