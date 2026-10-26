'use strict';
// P3-2 pure start gate. Reference only; no production Firebase integration.
const {decide}=require('./rdw-pass-gate.cjs');
function chooseStart({snapshotState,readbackStatus,passRequested=false,authorized=false,rosterValid=false,drawRevisionValid=false,actorUid,eventCode,failureReason}){
 if(!authorized||!rosterValid||!drawRevisionValid)return {start:false,mode:'blocked',reason:'tournament-safety-gate'};
 if(snapshotState==='verified'&&readbackStatus==='verified')return {start:true,mode:'rdw-verified'};
 if(!passRequested)return {start:false,mode:'await-rdw',reason:'retry-or-explicit-pass'};
 const gate=decide({captureStatus:snapshotState,readbackStatus,authorized,rosterValid,drawRevisionValid,actorUid,eventCode,reason:failureReason});
 return gate.allowed?{start:true,mode:'rdw-pass',rdwEligible:false,auditRequired:true}:{start:false,mode:'blocked',reason:gate.reason};
}
module.exports={chooseStart};
