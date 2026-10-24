'use strict';
// RDW P3-35: isolated diagnostic callable entrypoint, NOT exported from a
// deployed functions/index.js. Safe by default: no backend resolver connected.
// Do not enable until server-owned Hunter Reader is packaged and audited.
const {onCall,HttpsError}=require('firebase-functions/v2/https');
function createDiagnosticHandler({enabled=false,diagnose}={}){
 return async request=>{
  if(!request?.auth?.uid)throw new HttpsError('unauthenticated','auth-required');
  if(!request.app?.appId)throw new HttpsError('failed-precondition','app-check-required');
  if(!enabled)throw new HttpsError('failed-precondition','rdw-diagnostic-disabled');
  if(typeof diagnose!=='function')throw new HttpsError('unavailable','rdw-diagnostic-not-wired');
  const data=request.data;
  if(!data||typeof data!=='object'||Array.isArray(data)||
    Object.keys(data).some(key=>key!=='eventCode')||
    typeof data.eventCode!=='string'||!/^BXH-[A-Z0-9]{6}$/.test(data.eventCode))
    throw new HttpsError('invalid-argument','event-code-only');
  const result=await diagnose({actorUid:request.auth.uid,eventCode:data.eventCode});
  if(!result?.ok){
   const code=result?.reason==='not-authorized'||result?.reason==='authorization-changed'?'permission-denied':'failed-precondition';
   throw new HttpsError(code,'rdw-diagnostic-unavailable');
  }
  // Return only the privacy-safe projection from the verified server diagnostic.
  return {ok:true,eventCode:result.eventCode,started:result.started===true,
    rosterRevision:result.rosterRevision,rosterSize:result.rosterSize,
    verifiedAccounts:result.verifiedAccounts,unverifiedAccounts:result.unverifiedAccounts,
    virtualPlayers:result.virtualPlayers,fullSnapshotEligible:result.fullSnapshotEligible===true,
    policy:result.policy,formulaBands:result.formulaBands};
 };
}
exports.rdwDiagnosticService=onCall({region:'asia-east1',enforceAppCheck:true,timeoutSeconds:60,maxInstances:3},createDiagnosticHandler());
module.exports.createDiagnosticHandler=createDiagnosticHandler;
