'use strict';
// RDW read-only parity gate for a future server-owned start dispatcher.
// Never interprets pre-start reservations as already-running matches.
function verifyStartDispatch({before,after,stationCount,requireLive=false,serverTime}={}){
 const fail=reason=>({ok:false,reason});
 if(!before||!after||!Array.isArray(before.matches)||!Array.isArray(after.matches))
  return fail('match-state-missing');
 const n=stationCount??after.meta?.stations;
 if(!Number.isSafeInteger(n)||n<1||n>64)return fail('invalid-court-count');
 if(after.matches.length!==before.matches.length)return fail('match-count-changed');
 const original=new Map(before.matches.map(m=>[m.id,m]));
 if(original.size!==before.matches.length)return fail('duplicate-original-match');
 for(const m of after.matches){
  const old=original.get(m.id);
  if(!old)return fail('unexpected-match');
  for(const k of ['scoreA','scoreB','winnerId','loserId','completed','log','faultActions']){
   if(JSON.stringify(m[k]??null)!==JSON.stringify(old[k]??null))return fail('match-result-mutated');
  }
 }
 const courts=after.courtAssignments;
 if(!courts||typeof courts!=='object'||Array.isArray(courts))return fail('court-assignments-missing');
 const ids=new Set(),matchIds=new Set(after.matches.map(m=>m.id));
 for(let i=1;i<=n;i++){
  const c=courts['court'+i];
  if(!c||typeof c!=='object')return fail('missing-court');
  for(const key of ['currentMatchId','nextMatchId']){
   const id=c[key];if(id==null)continue;
   if(!matchIds.has(id))return fail('unknown-assigned-match');
   if(ids.has(id))return fail('duplicate-assigned-match');
   if(requireLive){
    const m=after.matches.find(m=>m.id===id);
    if(m.station!==i||m.completed||m.isBye||!m.a?.playerId||!m.b?.playerId)return fail('assigned-match-not-ready');
    if(key==='currentMatchId'&&(m.status!=='in_progress'||m.startedAt!==serverTime))return fail('current-match-not-started');
    if(key==='nextMatchId'&&(m.status==='in_progress'||m.startedAt))return fail('next-match-started-early');
   }
   ids.add(id);
  }
 }
 if(ids.size===0)return fail('no-dispatched-matches');
 return {ok:true,courts:n,assignedMatches:ids.size};
}
module.exports={verifyStartDispatch};
