'use strict';
// P3-31: prevent an abstract RDW start contract from being used on a real
// ARENA tournament document without an audited JSON + public mirror writer.
// READ ONLY; no Firestore writes and no cloud function registration.
const {readCanonicalEvent}=require('./rdw-production-event-guard.cjs');
const {classifyRdwEvent}=require('./rdw-event-type-policy.cjs');
function inspectProductionStartReadiness({room,eventCode,expectedRosterRevision,actorUid,serverAuthorizationVerified=false,bracketVerified=false,canonicalWriterReady=false}={}){
 const type=classifyRdwEvent({room});
 if(!type.ok)return {ready:false,code:type.reason};
 if(!type.rdwApplicable)return {ready:false,code:'rdw-not-applicable-general-event',rdwApplicable:false};
 const roomCheck=readCanonicalEvent({room,eventCode,expectedRosterRevision,actorUid});
 if(!roomCheck.ok)return {ready:false,code:roomCheck.reason};
 if(serverAuthorizationVerified!==true)return {ready:false,code:'server-authorization-not-proven'};
 if(bracketVerified!==true)return {ready:false,code:'server-bracket-not-proven'};
 if(canonicalWriterReady!==true)return {ready:false,code:'canonical-json-and-public-mirror-writer-not-ready'};
 return {ready:true,eventCode,rosterUids:roomCheck.rosterUids,rosterRevision:roomCheck.rosterRevision};
}
module.exports={inspectProductionStartReadiness};
