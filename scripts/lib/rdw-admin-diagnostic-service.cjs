'use strict';
// P3-33: authenticated, read-only diagnostic service adapter.
// Not a deployed Firebase callable. Each dependency is server-owned.
// No caller-supplied adminVerified, room, or tierEvidence may be trusted.
const {inspectRdwDiagnostic}=require('./rdw-admin-diagnostic.cjs');
function createAdminDiagnosticService({authorizeAdmin,readRoom,readCurrentTierEvidence,clock,enabled=false}={}){
 if(!enabled)return async()=>({ok:false,reason:'diagnostic-disabled'});
 if([authorizeAdmin,readRoom,readCurrentTierEvidence,clock].some(f=>typeof f!=='function'))throw Error('diagnostic-trusted-dependencies-required');
 return async function diagnose({actorUid,eventCode}={}){
  if(typeof actorUid!=='string'||!actorUid.trim()||!/^BXH-[A-Z0-9]{6}$/.test(eventCode||''))return {ok:false,reason:'invalid-request'};
  // Authorization MUST be checked on the server against canonical account grants.
  if(await authorizeAdmin({actorUid,eventCode})!==true)return {ok:false,reason:'not-authorized'};
  const room=await readRoom({eventCode});
  if(!room)return {ok:false,reason:'room-not-found'};
  let state=room.data;
  if(typeof state==='string'){try{state=JSON.parse(state);}catch{return {ok:false,reason:'room-json-invalid'};}}
  if(!state||!Array.isArray(state.players))return {ok:false,reason:'room-invalid'};
  // Only canonical UIDs may be evaluated; virtual entries are deliberately not given fake UIDs.
  const {canonicalUid}=require('./rdw-canonical-identity.cjs');
  const canonicalUids=[];
  for(const player of state.players){
   const id=canonicalUid(player);
   if(id.ok)canonicalUids.push(id.uid);
   else if(id.reason!=='uid-missing')return {ok:false,reason:'ambiguous-identity'};
  }
  if(new Set(canonicalUids).size!==canonicalUids.length)return {ok:false,reason:'duplicate-canonical-uid'};
  const evidenceByUid=Object.create(null);
  // Read-only backend tier resolver; never invoke Hunter grant/award handlers.
  for(const uid of canonicalUids)evidenceByUid[uid]=await readCurrentTierEvidence({uid,eventCode});
  const serverTime=clock();
  if(!Number.isSafeInteger(serverTime)||serverTime<=0)throw Error('server-clock-invalid');
  // Recheck authorization before returning private diagnostics after potentially slow reads.
  if(await authorizeAdmin({actorUid,eventCode})!==true)return {ok:false,reason:'authorization-changed'};
  return inspectRdwDiagnostic({room,eventCode,adminVerified:true,tierEvidenceByUid:evidenceByUid,serverTime});
 };
}
module.exports={createAdminDiagnosticService};
