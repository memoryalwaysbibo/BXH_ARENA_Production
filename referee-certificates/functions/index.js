'use strict';
const {initializeApp,getApps}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {createService}=require('./service.cjs');
if(!getApps().length)initializeApp();
const handle=createService(getFirestore());
exports.refereeCertificateService=onCall({region:'asia-east1',timeoutSeconds:60,maxInstances:10,invoker:'public'},async request=>{
  try{return await handle(request);}catch(error){
    const codes=new Set(['unauthenticated','permission-denied','invalid-argument','failed-precondition','not-found','already-exists','aborted']);
    if(codes.has(error.code))throw new HttpsError(error.code,error.message);
    console.error('refereeCertificateService failed',{code:error.code||'internal'});
    throw new HttpsError('internal','referee-certificate-service-error');
  }
});
// Independently gated public projection; private get remains self/super_admin only.
const publicSummary=require('./public-summary.cjs').createPublicSummary(getFirestore());
exports.refereeCertificatePublicSummary=onCall({region:'asia-east1',timeoutSeconds:60,maxInstances:10,invoker:'public'},async request=>{
  try{return await publicSummary(request);}catch(error){
    if(['invalid-argument','failed-precondition'].includes(error.code))throw new HttpsError(error.code,error.message);
    throw new HttpsError('internal','public-certificate-summary-unavailable');
  }
});
