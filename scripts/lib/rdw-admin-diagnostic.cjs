'use strict';
// P3-32: read-only admin diagnostic projection. Not a public endpoint.
// Input MUST be sourced from a server-owned room document and a verified
// authenticated admin check. Does NOT create tiers, snapshots, or start events.
const {canonicalUid}=require('./rdw-canonical-identity.cjs');
const {verifiedCurrentTier}=require('./rdw-current-tier-source.cjs');
const TIERS=['ungraded','e','d','c','b','a','s','national'];
function inspectRdwDiagnostic({room,eventCode,adminVerified=false,tierEvidenceByUid={},serverTime}={}){
 if(adminVerified!==true)return {ok:false,reason:'admin-authorization-required'};
 if(!/^BXH-[A-Z0-9]{6}$/.test(eventCode||'')||!Number.isSafeInteger(serverTime)||serverTime<=0)return {ok:false,reason:'diagnostic-context-invalid'};
 if(!room||typeof room!=='object'||(room.code&&room.code!==eventCode))return {ok:false,reason:'room-mismatch'};
 let state=room.data;
 if(typeof state==='string'){try{state=JSON.parse(state);}catch{return {ok:false,reason:'room-json-invalid'};}}
 if(!state||typeof state!=='object'||(state.cloudCode&&state.cloudCode!==eventCode)||!Array.isArray(state.players))return {ok:false,reason:'room-invalid'};
 const seen=new Set(),tiers=[];
 let virtual=0,unverified=0,valid=0;
 for(const player of state.players){
  const identity=canonicalUid(player);
  if(!identity.ok){
   // Identity ambiguity is never silently counted as a harmless virtual player.
   if(identity.reason!=='uid-missing')return {ok:false,reason:'ambiguous-identity'};
   virtual++;continue;
  }
  if(seen.has(identity.uid))return {ok:false,reason:'duplicate-canonical-uid'};
  seen.add(identity.uid);
  const evidence=Object.prototype.hasOwnProperty.call(tierEvidenceByUid,identity.uid)?tierEvidenceByUid[identity.uid]:null;
  const tier=verifiedCurrentTier(evidence,{uid:identity.uid,atMs:serverTime});
  if(!tier.ok||evidence.complete!==true||evidence.unresolvedIdentities!==0||evidence.sourceScope!=='public-official-canonical-self-history-v1'||!/^[a-f0-9]{64}$/.test(evidence.sourceDigest||'')){unverified++;continue;}
  valid++;tiers.push(tier.tier);
 }
 const formulaBands=[];
 for(let i=0;i<tiers.length;i++)for(let j=i+1;j<tiers.length;j++){
  const a=TIERS.indexOf(tiers[i]),b=TIERS.indexOf(tiers[j]);
  const neutral=a===0||b===0;
  formulaBands.push({rawForwardPercent:100+b-a,rawReversePercent:100+a-b,protectedForwardPercent:neutral?100:100+b-a,protectedReversePercent:neutral?100:100+a-b});
 }
 return {ok:true,eventCode,started:state.startedAt!=null,rosterLocked:state.rosterLocked===true,rosterRevision:Number.isSafeInteger(state.registrationRosterRevision)?state.registrationRosterRevision:null,rosterSize:state.players.length,verifiedAccounts:valid,unverifiedAccounts:unverified,virtualPlayers:virtual,fullSnapshotEligible:virtual===0&&unverified===0&&valid===state.players.length&&!state.startedAt&&!state.rosterLocked,policy:'ungraded-neutral-protected',formulaBands};
}
module.exports={inspectRdwDiagnostic};
