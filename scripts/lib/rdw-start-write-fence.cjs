'use strict';
// P3-47: server-owned tournament start monotonicity guard.
// Designed for integration at the EXISTING cloud-runtime pushUpdate transaction.
// Not yet wired; never rely on client-provided rdw flags for authorization.
function inspectStartWriteFence({remote,proposed,remoteDoc}={}){
 if(!remote||typeof remote!=='object'||!proposed||typeof proposed!=='object')
  return {ok:false,reason:'state-required'};
 const remoteStarted=Number(remote.startedAt);
 const incomingStarted=Number(proposed.startedAt);
 if(Number.isFinite(remoteStarted)&&remoteStarted>0){
  if(!Number.isFinite(incomingStarted)||incomingStarted!==remoteStarted)
   return {ok:false,reason:'started-at-monotonicity'};
  if(remote.rosterLocked===true&&proposed.rosterLocked!==true)
   return {ok:false,reason:'roster-lock-monotonicity'};
  // RDW is server-sealed. Ordinary clients cannot change or remove the mode.
  const sealedMode=remoteDoc?.rdwStartMode;
  if(sealedMode==='rdw-verified'||sealedMode==='rdw-pass'){
   if(proposed.rdwStartMode!==sealedMode)
    return {ok:false,reason:'rdw-start-mode-monotonicity'};
   if(remoteDoc.rdwSnapshotDigest&&proposed.rdwSnapshotDigest!==remoteDoc.rdwSnapshotDigest)
    return {ok:false,reason:'rdw-snapshot-digest-monotonicity'};
  }
 }
 // Before start, an incoming start must be authenticated and server-attested,
 // not accepted based on a browser timestamp or cloned snapshot fields.
 if(!(Number.isFinite(remoteStarted)&&remoteStarted>0)&&Number.isFinite(incomingStarted)&&incomingStarted>0)
  return {ok:false,reason:'client-cannot-transition-start'};
 return {ok:true};
}
module.exports={inspectStartWriteFence};
