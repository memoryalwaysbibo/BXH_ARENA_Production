'use strict';
const C=require('./core.cjs'),S=require('./scoring-core.cjs'),{createEngine}=require('./engine/index.cjs');
const R=require('./engine/court-retirement.cjs').BXHCourtRetirement,{matchHasDecisionData}=require('./engine/match-utils.cjs');
const ACTIONS=new Set(['idle-claim','claim-skipped','manual-assign','swap','force-exit','reopen','claim-detached','retirement-transfer','resize']);
const fail=reason=>{throw Object.assign(new Error(reason),{seatCode:reason});};
function authorizationStation(d){return ['idle-claim','claim-skipped','claim-detached','retirement-transfer','manual-assign'].includes(d.action)?Number(d.targetStation):Number(d.station);}
function protectedPass(s,m){return !!(m&&(m.callPass&&!m.completed||(s.matches||[]).some(x=>!x.completed&&x.skippedAt&&x.callPass?.waitFor?.includes(m.id))));}
function transition({room,state,user,uid,d,now}){
 if(!ACTIONS.has(d.action))fail('invalid-action');
 if(room.refereeSeatsV1?.version!==1)fail('not-enabled');
 if(room.eventAuthority!=='official'||state.meta?.eventAuthority!=='official'||state.meta?.battleMode==='team'||state.meta?.playMode==='enchantment')fail('unsupported-mode');
 if(room.eventCancelled||room.systemClosed||room.deletionStatus||['completed','archived'].includes(room.archiveStatus)||['completed','archived'].includes(state.archiveStatus))fail('room-read-only');
 if(!C.eligible(room,user,uid))fail('station-not-assigned');
 const manager=C.manager(room,user,uid),action=d.action,station=Number(d.station),to=Number(d.targetStation),m=state.matches?.find(m=>m.id===d.matchId);
 const identity={uid,name:String(user.realName||user.gameId||user.displayName||'裁判').slice(0,80)},engine=createEngine(state,identity,now,d.operationId);
 function permission(n){if(!Number.isInteger(n)||n<1||n>32)fail('invalid-court');if(!S.allowed(room,user,uid,n))fail('station-not-assigned');if(d.expectedCourtRevisions?.[n]!==Number(room.refereeSeatsV1.courts?.[n]?.revision||0))fail('seat-stale');}
 function matchVersion(target,secondary=false){
  if(!target||target.isBye||target.completed)fail('match-unavailable');
  const version=secondary?d.expectedTargetScoreRevision:d.expectedScoreRevision,dispatch=secondary?d.expectedTargetDispatchRevision:d.expectedDispatchRevision;
  if(version!==Number(target.refereeSeatScoreRevision||0))fail('score-stale');if(dispatch!==Number(target.dispatchRevision||0))fail('dispatch-stale');
  const a=secondary?d.targetPlayerAId:d.playerAId,b=secondary?d.targetPlayerBId:d.playerBId;
  if(a!==(target.a?.playerId||null)||b!==(target.b?.playerId||null))fail('player-mismatch');
 }
 const managerOnly=['reopen','claim-detached','retirement-transfer','resize'].includes(action);
 if(managerOnly&&!manager)fail('permission-denied');
 if(action==='resize'){
  if((state.matches||[]).some(m=>m.callPass&&!m.completed&&m.skippedAt))fail('pass-protected');
 }else if(action==='force-exit'||action==='reopen'){
  permission(station);
  if(action==='force-exit'&&(state.matches||[]).some(x=>Number(x.station)===station&&protectedPass(state,x)))fail('pass-protected');
  if(action==='force-exit'){
   const current=state.courtAssignments?.['court'+station]?.currentMatchId||null;
   if(current!==(d.matchId||null))fail('current-match-changed');
   if(current){matchVersion(m);if(protectedPass(state,m))fail('pass-protected');}
   if(Number(state.forcedCourtExits?.[station]?.revision||0)!==d.expectedExitRevision)fail('court-exit-stale');
  }
 }else{
  if(!state.startedAt)fail('not-started');
  matchVersion(m);if(Number(m.station)!==station)fail('station-mismatch');
  if(protectedPass(state,m))fail('pass-protected');
  if(action==='swap'){
   permission(station);const target=state.matches.find(x=>x.id===d.targetMatchId);matchVersion(target,true);permission(Number(target.station));
   if(protectedPass(state,target))fail('pass-protected');
  }else{
   permission(to);
   if(action==='manual-assign')permission(station);
   if(!R.accepts(state,to))fail('target-retiring');
  }
 }
 let result;
 if(action==='idle-claim')result=engine.applyIdleCourtClaim(state,m.id,to);
 else if(action==='claim-skipped')result=engine.applySkippedDispatch(state,m,to,d.expectedDispatchRevision);
 else if(action==='manual-assign'){
  const currentId=state.courtAssignments?.['court'+to]?.currentMatchId||null;
  if(d.expectedTargetCurrentMatchId!==currentId)fail('current-match-changed');
  const current=state.matches.find(x=>x.id===currentId);
  if(current&&current.id!==m.id&&!current.completed){if(protectedPass(state,current))fail('pass-protected');matchVersion(current,true);}
  if(current&&current.id!==m.id&&!current.completed&&matchHasDecisionData(current))fail('target-has-play-data');
  result=engine.applyManualCourtAssign(state,m.id,to);
 }else if(action==='swap')result=engine.applyCourtSwapMutation(state,m.id,d.targetMatchId);
 else if(action==='force-exit')result=R.forceExit(state,station,d.matchId,d.expectedDispatchRevision,d.expectedExitRevision,now);
 else if(action==='reopen')result=R.reopen(state,station,d.expectedExitRevision,now);
 else if(action==='claim-detached')result=R.claimDetached(state,m.id,to,d.expectedDispatchRevision,now);
 else if(action==='retirement-transfer')result=R.transfer(state,m.id,to,d.expectedDispatchRevision,now);
 else if(action==='resize'){
  const editable=new Set(['name','date','location','startTime','checkin','venueName','venueAddress','googleMapsUrl','navigationEnabled','eventDescription','registrationNotes']);
  const patch=d.metaPatch||{};
  if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(k=>!editable.has(k)))fail('unsupported-resize-settings');
  result=R.request(state,d.count,d.expectedTarget,now,d.expectedPlanRevision);
  if(result.ok)Object.assign(state.meta,patch);
 }
 if(!result?.ok)fail(result?.reason||'dispatch-failed');
 // A successful swap changes two score generations as well as both dispatch versions.
 for(const id of new Set([m?.id,action==='swap'?d.targetMatchId:null].filter(Boolean))){const changed=state.matches.find(x=>x.id===id);changed.refereeSeatScoreRevision=Number(changed.refereeSeatScoreRevision||0)+1;changed.updatedBy=identity.name;}
 engine.rebuildPropagationForState(state);
 state.courtLifecycleEpoch=Number(state.courtLifecycleEpoch||0)+1;
 return {state,matchId:m?.id||null,station:authorizationStation(d)||null,scoreRevision:m?Number(state.matches.find(x=>x.id===m.id)?.refereeSeatScoreRevision||0):null};
}
module.exports={ACTIONS,authorizationStation,protectedPass,transition};
