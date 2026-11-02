(function(root){
'use strict';
const copy=x=>JSON.parse(JSON.stringify(x));
function apply(state,plan,audit){
 if(plan?.type!=='bxh-score-backfill-plan-v1'||plan.code!==state.cloudCode||plan.roomId!==state.id)throw Error('backfill-room-mismatch');
 if(state.archiveStatus==='completed'||state.ladderPointsAwarded||!['idle',undefined,null].includes(state.settlementPhase))throw Error('backfill-settlement-locked');
 if(!audit?.actorUid||!Number.isSafeInteger(audit.at)||!Array.isArray(plan.operations)||!plan.operations.length||plan.operations.length>256)throw Error('backfill-invalid');
 const result=copy(state),seen=new Set();let changed=0;
 for(const op of plan.operations){
  const m=result.matches.find(m=>m.id===op.matchId),e=op.expected;
  if(seen.has(op.matchId)||!m||!e)throw Error('backfill-invalid-match');seen.add(op.matchId);
  if(m.isBye||!m.completed||m.a?.playerId!==e.playerAId||m.b?.playerId!==e.playerBId||m.winnerId!==e.winnerId||m.loserId!==e.loserId||![e.playerAId,e.playerBId].includes(e.winnerId))throw Error('backfill-outcome-changed');
  const aWin=m.winnerId===m.a.playerId,sa=aWin?4:2,sb=aWin?2:4;
  if(op.scoreA!==sa||op.scoreB!==sb||e.scoreA!==0||e.scoreB!==0||op.excludeFromRoundAbilityStatistics!==true)throw Error('backfill-invalid-score');
  if(m.scoreBackfill?.version===1&&m.scoreA===sa&&m.scoreB===sb&&m.scoreBackfill.source==='admin-backfill-user-instructed-4-2')continue;
  if(m.scoreA!==0||m.scoreB!==0||(m.log||[]).length||(m.faultActions||[]).length)throw Error('backfill-score-changed');
  const winner=aWin?'A':'B',loser=aWin?'B':'A';
  m.scoreA=sa;m.scoreB=sb;
  m.log=[loser,loser,winner,winner,winner,winner].map((side,i)=>({v:1,eventId:m.id+':admin-backfill:'+i,seq:i+1,side,type:'spin',points:1,t:audit.at,synthetic:true}));
  m.scoreBackfill={version:1,source:'admin-backfill-user-instructed-4-2',actorUid:audit.actorUid,at:audit.at,originalScoreA:0,originalScoreB:0,originalResultMethod:m.resultMethod||null,excludeFromRoundAbilityStatistics:true};
  m.resultMethod='administrative_backfill';m.hunterData={analyzable:false,reason:'administrative_backfill',roundCount:0,scoreA:null,scoreB:null};changed++;
 }
 return {state:result,changed};
}
const api={apply};if(typeof module==='object'&&module.exports)module.exports=api;else root.BXHScoreBackfill=api;
})(typeof window==='object'?window:globalThis);
