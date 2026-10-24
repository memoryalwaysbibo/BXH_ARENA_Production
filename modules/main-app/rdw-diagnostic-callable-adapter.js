// RDW P3-38: opt-in browser adapter for a trusted Firebase callable.
// Not loaded by index.html. The host must supply a configured callable;
// this module does not initialize Firebase, claim authorization, or write.
(function(root){
 'use strict';
 const VALID=/^BXH-[A-Z0-9]{6}$/;
 function createCallableDiagnosticAdapter({invokeCallable,enabled=false}={}){
  if(!enabled)return async()=>{throw Error('rdw-diagnostic-disabled');};
  if(typeof invokeCallable!=='function')throw Error('trusted-callable-required');
  return async function fetchDiagnostic({eventCode}={}){
   if(typeof eventCode!=='string'||!VALID.test(eventCode))throw Error('invalid-event-code');
   // The ONLY argument sent to the backend is the event code; no UID,
   // tier, authorization flag, roster, or mutable tournament state.
   const envelope=await invokeCallable({eventCode});
   const result=envelope&&envelope.data;
   if(!result||result.ok!==true||result.eventCode!==eventCode)throw Error('invalid-diagnostic-envelope');
   // Return only the known, non-PII properties; the UI validates all numbers.
   return {ok:true,eventCode,
    started:result.started===true,rosterRevision:result.rosterRevision,
    rosterSize:result.rosterSize,verifiedAccounts:result.verifiedAccounts,
    unverifiedAccounts:result.unverifiedAccounts,virtualPlayers:result.virtualPlayers,
    fullSnapshotEligible:result.fullSnapshotEligible===true,policy:result.policy,
    formulaBands:result.formulaBands};
  };
 }
 const api=Object.freeze({createCallableDiagnosticAdapter});
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(root)root.BXHRDWCallableAdapter=api;
})(typeof window!=='undefined'?window:null);
