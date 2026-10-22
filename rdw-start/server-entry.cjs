'use strict';
// P3-10: isolated Cloud Functions v2 export. Deliberately disabled until trusted
// server-side roster/tier resolution and atomic start implementation are audited.
// NOT imported by any existing deployed backend entrypoint.
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {initializeApp,getApps}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const project=process.env.GCLOUD_PROJECT||process.env.GOOGLE_CLOUD_PROJECT||process.env.GCLOUD_PROJECT_ID;
const emulator=Boolean(process.env.FIRESTORE_EMULATOR_HOST&&process.env.FIREBASE_AUTH_EMULATOR_HOST);
if(project!=='bxh-arena'&&!(emulator&&String(project).startsWith('demo-')))throw Error('rdw-project-mismatch');
const app=getApps()[0]||initializeApp({projectId:project});
const db=getFirestore(app);
function createHandler({enabled=false}={}){
 return async request=>{
  if(!request.auth?.uid)throw new HttpsError('unauthenticated','auth-required');
  if(!enabled)throw new HttpsError('failed-precondition','rdw-start-disabled');
  // Do not trust request.data authorization, tier, roster or timestamp.
  // This fail-closed placeholder cannot start events or write Firestore.
  throw new HttpsError('unimplemented','rdw-trusted-start-not-integrated');
 };
}
exports.rdwStartService=onCall({region:'asia-east1',enforceAppCheck:true,timeoutSeconds:60,maxInstances:5},createHandler());
module.exports.createHandler=createHandler;
