'use strict';
const {initializeApp,getApps}=require('firebase-admin/app');
const {getFirestore,FieldValue}=require('firebase-admin/firestore');
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {createPromotionHandler}=require('./service.cjs');
if(!getApps().length)initializeApp();
const promote=createPromotionHandler(getFirestore(),{timestamp:()=>FieldValue.serverTimestamp()});
exports.promoteSeatedRegistration=onCall({region:'asia-east1',timeoutSeconds:60,maxInstances:10,invoker:'public'},async request=>{
 try{return await promote(request);}catch(error){
  throw new HttpsError(error.message==='unauthenticated'?'unauthenticated':error.message==='permission-denied'?'permission-denied':'failed-precondition',error.message);
 }
});
