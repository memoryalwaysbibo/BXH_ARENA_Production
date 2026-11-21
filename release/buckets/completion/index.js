'use strict';
// Candidate new endpoint only. Deploying other functions from this package is prohibited.
const {initializeApp,getApps}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{onCall,HttpsError}=require('firebase-functions/v2/https');
if(!getApps().length)initializeApp();
const handle=require('./general-completion.cjs').createGeneralCompletion(getFirestore());
exports.completeBucketTournament=onCall({region:'asia-east1',timeoutSeconds:120,maxInstances:5,invoker:'public'},async request=>{
 try{return await handle(request);}catch(e){const reason=e.completionCode||e.message;throw new HttpsError(reason==='unauthenticated'?'unauthenticated':reason==='permission-denied'?'permission-denied':'failed-precondition',e.completionCode||'bucket-completion-unavailable');}
});
