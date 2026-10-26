'use strict';
const C=require('./core.cjs'),Fault=require('./engine/fault.cjs'),{createEngine}=require('./engine/index.cjs');
const POINTS=Object.freeze({spin:1,knockout:2,burst:2,extreme:3});
const fail=reason=>{throw Object.assign(new Error(reason),{seatCode:reason});};
function allowed(room,user,uid,station){
 if(!C.eligible(room,user,uid))return false;
 if(C.manager(room,user,uid))return true;
 return C.SLOTS.some(slot=>room.refereeSeatsV1?.courts?.[station]?.[slot]?.uid===uid);
}
function passProtected(state,m){return !!m.callPass||(state.matches||[]).some(x=>x.callPass?.waitFor?.includes(m.id)&&!x.completed);}
function transition({room,state,user,uid,d,now}){
 if(room.refereeSeatsV1?.version!==1)fail('not-enabled');
 if(room.eventAuthority!=='official'||state.meta?.eventAuthority!=='official'||state.meta?.battleMode==='team'||state.meta?.playMode==='enchantment')fail('unsupported-mode');
 if(room.eventCancelled||room.systemClosed||room.deletionStatus||['completed','archived'].includes(room.archiveStatus)||['completed','archived'].includes(state.archiveStatus))fail('room-read-only');
 if(!state.startedAt)fail('not-started');
 const m=state.matches?.find(m=>m.id===d.matchId);if(!m)fail('not-found');
 const station=Number(m.station),court=room.refereeSeatsV1.courts?.[station];
 if(!Number.isInteger(station)||station<1||station>Number(state.meta.stations)||Number(d.station)!==station||state.forcedCourtExits?.[station]?.closed)fail('station-mismatch');
 if(!allowed(room,user,uid,station))fail('station-not-assigned');
 if(d.expectedCourtRevision!==Number(court?.revision||0))fail('seat-stale');
 if(d.expectedScoreRevision!==Number(m.refereeSeatScoreRevision||0))fail('score-stale');
 if(d.expectedDispatchRevision!==Number(m.dispatchRevision||0))fail('dispatch-stale');
 if(d.playerAId!==m.a?.playerId||d.playerBId!==m.b?.playerId||!m.a?.playerId||!m.b?.playerId||m.isBye)fail('player-mismatch');
 // A deferred PASS cannot be completed through quick judgement or restarted early.
 if(m.callPass?.waitFor?.some(id=>!state.matches.find(x=>x.id===id)?.completed))fail('pass-protected');
 m.scoringMode=m.scoringMode||state.meta.roundScoringModes?.[m.bracket+':'+m.round]||state.meta.scoringMode||'standard';
 const identity={uid,name:String(user.realName||user.gameId||user.displayName||'裁判').slice(0,80)},engine=createEngine(state,identity,now,d.operationId),action=d.action;
 if(action==='correct'){
  if(!['edit','reset'].includes(d.mode))fail('invalid-mode');
  const r=engine.applyCompletedMatchCorrection(state,m.id,d.mode,identity.name);if(!r.ok)fail(r.reason);
 }else{
  if(m.completed||m.status==='completed')fail('already-completed');
  if(engine.singleElimBronzeBeforeFinalBlocked(m,state.matches,state.meta))fail('bronze-before-final');
  if(action==='score'||action==='fault'){
   if(engine.checkWinnerSide(m))fail('no-more-score');
   if(m.scoringMode==='quick')fail('quick-mode');
   if(!['A','B'].includes(d.side))fail('invalid-side');
   if(action==='fault'){const r=Fault.applyFault(m,d.side,now);if(!r.ok)fail(r.reason);}
   else{
    if(typeof d.finish!=='string'||!Object.hasOwn(POINTS,d.finish))fail('invalid-finish');const points=POINTS[d.finish];
    const key=d.side==='A'?'scoreA':'scoreB',current=Number(m[key]||0);if(!Number.isInteger(current)||current<0||current+points>6)fail('invalid-score');
    const event=engine.createHunterRoundEvent(m,d.side,d.finish,points,now);Fault.attachSnapshotToEvent(m,event);m[key]=current+points;(m.log||(m.log=[])).push(event);Fault.clear(m);
   }
  }else if(action==='undo'){
   if(Fault.hasPending(m))Fault.popPending(m);
   else{const last=m.log?.pop();if(!last)fail('nothing-to-undo');const key=last.side==='A'?'scoreA':'scoreB';m[key]=Math.max(0,Number(m[key]||0)-Number(last.points||0));Fault.restoreFromEvent(m,last);}
  }else if(action==='rematch'){
   Object.assign(m,{scoreA:0,scoreB:0,log:[],faultActions:[],hunterData:null,winnerId:null,loserId:null,completed:false,status:'in_progress'});
  }else if(action==='confirm'||action==='quick'){
   if(action==='quick'&&m.scoringMode!=='quick')fail('standard-mode');
   if(action==='confirm'&&m.scoringMode==='quick')fail('quick-mode');
   const ev=action==='quick'?engine.evaluateQuickDecision(m,d.winnerId):engine.evaluateMatchCompletion(m);if(!ev.ok)fail(ev.reason);
   if(action==='quick')engine.applyQuickDecisionFields(m,ev,identity.name);else engine.applyMatchCompletionFields(m,ev,identity.name);
  }else if(action==='pause'){
   if(m.status!=='in_progress')fail('invalid-status');m.status='paused';
  }else if(action==='resume'){
   if(m.status!=='paused')fail('invalid-status');m.status='in_progress';
  }else if(action==='start'||action==='ready'){
   for(const other of state.matches)if(other.id!==m.id&&!other.completed&&other.station===station&&other.status===(action==='start'?'in_progress':'ready')){other.status=action==='start'?'ready':'pending';other.updatedAt=now;}
   m.status=action==='start'?'in_progress':'ready';if(action==='start')m.startedAt=m.startedAt||now;
  }else if(action==='skip'){
   if(m.skippedAt||passProtected(state,m))fail('dispatch-stale');engine.markMatchSkipped(m.id);
  }else fail('invalid-action');
 }
 m.updatedAt=now;m.updatedBy=identity.name;m.refereeSeatScoreRevision=Number(m.refereeSeatScoreRevision||0)+1;
 // Trusted progression updates downstream players, bronze/final gates and queues.
 engine.rebuildPropagationForState(state);
 return {state,matchId:m.id,station,scoreRevision:m.refereeSeatScoreRevision,completed:!!m.completed};
}
function publicProjection(state,previous){
 const mirror=JSON.parse(JSON.stringify(previous));
 mirror.matches=state.matches.map(m=>({id:m.id,seq:m.seq??null,bracket:m.bracket||null,round:m.round??0,indexInRound:m.indexInRound??0,station:m.station??null,a:m.a?{playerId:m.a.playerId}:null,b:m.b?{playerId:m.b.playerId}:null,isBye:!!m.isBye,scoreA:m.scoreA??null,scoreB:m.scoreB??null,log:m.log||[],winnerId:m.winnerId||null,loserId:m.loserId||null,completed:!!m.completed,resultMethod:m.resultMethod||null,completedAt:m.completedAt||null,confirmedAt:m.confirmedAt||null,status:m.status||'pending',skippedAt:m.skippedAt||null,callPass:m.callPass||null,skipWaitFor:m.skipWaitFor||[],skipManualOnly:m.skipManualOnly===true,resumeQueuedAt:m.resumeQueuedAt||null}));
 mirror.courtAssignments=Object.fromEntries(Object.entries(state.courtAssignments||{}).map(([key,c])=>[key,{currentMatchId:c.currentMatchId||null,nextMatchId:c.nextMatchId||null,status:c.status||'idle'}]));
 mirror.forcedCourtExits=Object.fromEntries(Object.entries(state.forcedCourtExits||{}).map(([n,c])=>[n,{closed:!!c.closed,revision:Number(c.revision||0),at:c.at||null,reopenedAt:c.reopenedAt||null,matchId:c.matchId||null}]));
 mirror.callRevision=Number(state.callRevision||0);mirror.courtLifecycleEpoch=Number(state.courtLifecycleEpoch||0);
 for(const key of ['championId','runnerUpId','thirdId','fourthId','gfMatchId','gfResetMatchId','bronzeMatchId','rrRounds','updatedAt'])mirror[key]=state[key]??null;
 return mirror;
}
module.exports={transition,allowed,publicProjection};
