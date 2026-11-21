'use strict';
function publicProjection(state,previous){
 const mirror=JSON.parse(JSON.stringify(previous));
 mirror.meta={...mirror.meta,stations:state.meta.stations};
 mirror.matches=state.matches.map(m=>({id:m.id,seq:m.seq??null,bracket:m.bracket||null,round:m.round??0,indexInRound:m.indexInRound??0,station:m.station??null,a:m.a?{playerId:m.a.playerId}:null,b:m.b?{playerId:m.b.playerId}:null,isBye:!!m.isBye,scoreA:m.scoreA??null,scoreB:m.scoreB??null,log:m.log||[],winnerId:m.winnerId||null,loserId:m.loserId||null,completed:!!m.completed,resultMethod:m.resultMethod||null,completedAt:m.completedAt||null,confirmedAt:m.confirmedAt||null,status:m.status||'pending',skippedAt:m.skippedAt||null,callPass:m.callPass||null,skipWaitFor:m.skipWaitFor||[],skipManualOnly:m.skipManualOnly===true,resumeQueuedAt:m.resumeQueuedAt||null}));
 mirror.courtAssignments=Object.fromEntries(Object.entries(state.courtAssignments||{}).map(([key,c])=>[key,{currentMatchId:c.currentMatchId||null,nextMatchId:c.nextMatchId||null,status:c.status||'idle'}]));
 mirror.forcedCourtExits=Object.fromEntries(Object.entries(state.forcedCourtExits||{}).map(([n,c])=>[n,{closed:!!c.closed,revision:Number(c.revision||0),at:c.at||null,reopenedAt:c.reopenedAt||null,matchId:c.matchId||null}]));
 mirror.callRevision=Number(state.callRevision||0);mirror.courtLifecycleEpoch=Number(state.courtLifecycleEpoch||0);
 for(const key of ['championId','runnerUpId','thirdId','fourthId','gfMatchId','gfResetMatchId','bronzeMatchId','rrRounds','updatedAt'])mirror[key]=state[key]??null;
 return mirror;
}
module.exports={publicProjection};
