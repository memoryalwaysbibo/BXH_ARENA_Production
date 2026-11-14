'use strict';
// Pure RDW PASS decision contract; no production writes.
function decide({captureStatus,readbackStatus,authorized,rosterValid,drawRevisionValid,actorUid,eventCode,reason}){
 if(!authorized||!rosterValid||!drawRevisionValid)return {allowed:false,reason:'tournament-safety-gate'};
 if(!actorUid||!eventCode)return {allowed:false,reason:'audit-identity-required'};
 if(readbackStatus==='verified')return {allowed:false,reason:'snapshot-already-verified'};
 if(readbackStatus!=='missing')return {allowed:false,reason:'readback-unresolved'};
 if(!['failed','timeout'].includes(captureStatus))return {allowed:false,reason:'capture-not-failed'};
 if(!reason||typeof reason!=='string')return {allowed:false,reason:'failure-reason-required'};
 return {allowed:true,reason:'rdw-only-pass',rdwEligible:false};
}
module.exports={decide};
