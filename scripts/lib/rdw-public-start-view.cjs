'use strict';
// Same public allowlist as cloud-runtime buildPublicMirrorFields. Never copy
// private referee IDs, court locks, internal notes or arbitrary nested slots.
function publicStartView(dispatch){
 const matches=dispatch.matches.map(m=>({
  id:m.id,seq:m.seq,bracket:m.bracket,round:m.round,indexInRound:m.indexInRound,station:m.station,
  teamIds:Array.isArray(m.teamIds)?m.teamIds.slice(0,2):null,a:m.a?{playerId:m.a.playerId}:null,b:m.b?{playerId:m.b.playerId}:null,
  isBye:!!m.isBye,scoreA:m.scoreA==null?null:Number(m.scoreA),scoreB:m.scoreB==null?null:Number(m.scoreB),log:m.log||[],
  winnerId:m.winnerId||null,loserId:m.loserId||null,completed:!!m.completed,resultMethod:m.resultMethod||null,
  completedAt:Number(m.completedAt)||null,confirmedAt:Number(m.confirmedAt)||null,status:m.status||'pending',
  skippedAt:m.skippedAt||null,callPass:m.callPass||null,skipWaitFor:Array.isArray(m.skipWaitFor)?m.skipWaitFor.slice():[],
  skipManualOnly:m.skipManualOnly===true,resumeQueuedAt:m.resumeQueuedAt||null
 }));
 const courtAssignments=Object.fromEntries(Object.entries(dispatch.courtAssignments).map(([key,c])=>[key,{currentMatchId:c.currentMatchId||null,nextMatchId:c.nextMatchId||null,status:c.status||'idle'}]));
 return {matches,courtAssignments};
}
module.exports={publicStartView};
