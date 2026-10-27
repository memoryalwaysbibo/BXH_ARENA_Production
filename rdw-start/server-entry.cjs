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
// The callable is intentionally disabled by default. A future server-only
// deployment must inject a trusted start implementation after court/bracket
// parity and private Hunter bundle provisioning are verified.
function createHandler({enabled=false,start}={}){
 return async request=>{
  if(!request?.auth?.uid)throw new HttpsError('unauthenticated','auth-required');
  if(!request?.app?.appId)throw new HttpsError('failed-precondition','app-check-required');
  if(!enabled)throw new HttpsError('failed-precondition','rdw-start-disabled');
  if(typeof start!=='function')throw new HttpsError('unavailable','rdw-start-not-wired');
  const data=request.data;
  if(!data||typeof data!=='object'||Array.isArray(data)||
     Object.keys(data).some(key=>!['eventCode','drawRevision','expectedRosterRevision'].includes(key))||
     typeof data.eventCode!=='string'||!/^BXH-[A-Z0-9]{6}$/.test(data.eventCode)||
     !Number.isSafeInteger(data.drawRevision)||data.drawRevision<0||
     !Number.isSafeInteger(data.expectedRosterRevision)||data.expectedRosterRevision<0)
    throw new HttpsError('invalid-argument','rdw-start-request-invalid');
  // Actor identity always comes from verified Firebase Auth context.
  // No caller-supplied roster, authorization, tiers, timestamp, or refs.
  let result;
  try{result=await start({actorUid:request.auth.uid,eventCode:data.eventCode,
    drawRevision:data.drawRevision,expectedRosterRevision:data.expectedRosterRevision});}
  catch{throw new HttpsError('failed-precondition','rdw-start-unavailable');}
  if(result?.ok!==true)
   throw new HttpsError('failed-precondition','rdw-start-not-ready');
  return {ok:true,eventCode:data.eventCode,mode:result.mode||'rdw-verified'};
 };
}
exports.rdwStartService=onCall({region:'asia-east1',enforceAppCheck:true,timeoutSeconds:60,maxInstances:5},createWiredHandler());
module.exports.createHandler=createHandler;

// Build-time server dependencies only. The registered production export above
// remains disabled until the private runtime and release gates are verified.
function createWiredHandler({bundleRoot,enabled=false}={}){
 const {createWiredRankedStart}=require('../scripts/lib/rdw-wired-ranked-start.cjs');
 return createHandler({enabled,start:createWiredRankedStart({db,clock:()=>Date.now(),bundleRoot,enabled})});
}
module.exports.createWiredHandler=createWiredHandler;
