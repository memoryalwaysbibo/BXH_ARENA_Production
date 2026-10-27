'use strict';
// Server-only adapter to the same reviewed engine used by referee-seat actions.
// Reads canonical state in the start transaction; never accepts browser matches/courts.
const {createEngine}=require('../../referee-seats/functions/engine/index.cjs');
const {verifyStartDispatch}=require('./rdw-start-dispatch-gate.cjs');
function buildRankedStartDispatch({state,eventCode,drawRevision,serverTime}={}){
 if(!state||!/^BXH-[A-Z0-9]{6}$/.test(eventCode||'')||!Number.isSafeInteger(serverTime)||serverTime<=0)throw Error('server-dispatch-context-invalid');
 if(state.startedAt!=null||state.rosterLocked===true||state.testMode===true||state.cancelled===true||state.meta?.eventAuthority!=='official'||state.meta?.ladderMode!=='ranked'||state.meta?.battleMode==='team')throw Error('server-dispatch-room-ineligible');
 if(!Number.isSafeInteger(state.meta.stations)||state.meta.stations<1||state.meta.stations>64||!Array.isArray(state.matches)||!state.matches.length||!Array.isArray(state.players)||state.players.length<2)throw Error('server-dispatch-state-invalid');
 if(!['single','double','roundrobin'].includes(state.meta.formatType||'single'))throw Error('server-dispatch-format-unsupported');
 if(state.matches.some(m=>!m||(!m.isBye&&(m.completed===true||m.winnerId||m.loserId||m.startedAt||m.status==='in_progress'||Number(m.scoreA)>0||Number(m.scoreB)>0||(m.log||[]).length||(m.faultActions||[]).length))))throw Error('server-dispatch-existing-play');
 const next=JSON.parse(JSON.stringify(state));next.startedAt=serverTime;next.rosterLocked=true;
 const engine=createEngine(next,{uid:'system:rdw-start',name:'BXH'},serverTime,'rdw-start:'+eventCode+':'+drawRevision);
 engine.rebuildPropagationForState(next);
 const proof=verifyStartDispatch({before:state,after:next,stationCount:state.meta.stations,requireLive:true,serverTime});
 if(!proof.ok)throw Error(proof.reason);
 return {source:'server',verified:true,startedAt:serverTime,matches:next.matches,courtAssignments:next.courtAssignments};
}
function createServerStartDispatch({db}={}){
 if(typeof db?.doc!=='function')throw Error('firestore-required');
 return async function buildServerDispatch({tx,eventCode,drawRevision,expectedRosterRevision,serverTime}={}){
  if(typeof tx?.get!=='function'||!/^BXH-[A-Z0-9]{6}$/.test(eventCode||'')||!Number.isSafeInteger(drawRevision)||drawRevision<=0||!Number.isSafeInteger(expectedRosterRevision)||expectedRosterRevision<0)throw Error('server-dispatch-request-invalid');
  const snap=await tx.get(db.doc('tournaments/'+eventCode));if(!snap.exists)throw Error('server-dispatch-room-missing');
  const top=snap.data();if(top.systemClosed===true||top.cancelled===true||top.testMode===true)throw Error('server-dispatch-room-ineligible');
  let state;try{state=typeof top.data==='string'?JSON.parse(top.data):top.data;}catch{throw Error('server-dispatch-json-invalid');}
  if(state?.cloudCode!==eventCode||state.registrationRosterRevision!==expectedRosterRevision||state.bracketDraw?.revision!==drawRevision)throw Error('server-dispatch-revision-changed');
  return buildRankedStartDispatch({state,eventCode,drawRevision,serverTime});
 };
}
module.exports={buildRankedStartDispatch,createServerStartDispatch};
