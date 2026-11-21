'use strict';
function completeSingle(privateState,publicState,matchId,scores,now,actorUid){
 const s=privateState,p=publicState;
 if(s.meta?.formatType!=='single'||s.meta?.bronzeMatch===true)return {ok:false,reason:'format-not-supported'};
 const size=Number(s.bracketSize);
 if(!Number.isInteger(size)||size<2||(size&(size-1))!==0)return {ok:false,reason:'invalid-bracket'};
 const m=(s.matches||[]).find(x=>x.id===matchId),v=(p.matches||[]).find(x=>x.id===matchId);
 if(!m||!v||m.bracket!=='SE'||m.completed||v.completed)return {ok:false,reason:'match-unavailable'};
 if(!Number.isInteger(m.round)||!Number.isInteger(m.indexInRound))return {ok:false,reason:'invalid-bracket'};
 if(!m.a?.playerId||!m.b?.playerId||m.a.playerId===m.b.playerId)return {ok:false,reason:'players-not-linked'};
 if(v.a?.playerId!==m.a.playerId||v.b?.playerId!==m.b.playerId||
    Number(m.scoreA)!==scores.A||Number(m.scoreB)!==scores.B||
    Number(v.scoreA)!==scores.A||Number(v.scoreB)!==scores.B)return {ok:false,reason:'score-ledger-mismatch'};
 const winnerSide=scores.A>=5&&scores.A>scores.B?'A':scores.B>=5&&scores.B>scores.A?'B':null;
 if(!winnerSide)return {ok:false,reason:'no-winner'};
 const winnerId=m[winnerSide.toLowerCase()].playerId;
 const loserId=m[winnerSide==='A'?'b':'a'].playerId;
 const finalRound=Math.log2(size)-1;
 if(m.round<0||m.round>finalRound)return {ok:false,reason:'invalid-bracket'};
 let next=null,nextPublic=null,nextSide=null;
 if(m.round<finalRound){
  const index=Math.floor(m.indexInRound/2),round=m.round+1;
  const matches=(s.matches||[]).filter(x=>x.bracket==='SE'&&x.round===round&&x.indexInRound===index);
  if(matches.length!==1)return {ok:false,reason:'invalid-bracket'};
  next=matches[0];nextPublic=(p.matches||[]).find(x=>x.id===next.id);
  nextSide=m.indexInRound%2===0?'a':'b';
  if(!nextPublic||next.completed||nextPublic.completed||
     next[nextSide]?.playerId&&next[nextSide].playerId!==winnerId||
     nextPublic[nextSide]?.playerId&&nextPublic[nextSide].playerId!==next[nextSide]?.playerId||
     next.startedAt||next.confirmedAt||Number(next.scoreA)||Number(next.scoreB)||
     (next.log||[]).length||Number(nextPublic.scoreA)||Number(nextPublic.scoreB)||
     (nextPublic.log||[]).length)return {ok:false,reason:'next-match-started'};
 }
 const courtKey='court'+m.station,court=s.courtAssignments?.[courtKey],publicCourt=p.courtAssignments?.[courtKey];
 if(court?.currentMatchId===m.id&&(!publicCourt||publicCourt.currentMatchId!==m.id))
  return {ok:false,reason:'public-view-mismatch'};
 for(const target of [m,v]){
  target.winnerId=winnerId;target.loserId=loserId;target.completed=true;target.status='completed';
  target.resultMethod='score';target.confirmedAt=now;target.completedAt=now;target.updatedAt=now;
 }
 m.confirmedByUid=actorUid;
 m.hunterData={schemaVersion:2,scoringVersion:'bxh-enchantment-v2',analyzable:true,
  roundCount:(m.log||[]).length,scoreA:scores.A,scoreB:scores.B,validatedAt:now};
 if(next){
  for(const target of [next,nextPublic]){
   target[nextSide]={type:'player',playerId:winnerId};target.updatedAt=now;
  }
 }else{
  s.championId=p.championId=winnerId;s.runnerUpId=p.runnerUpId=loserId;
 }
 // Move the court pointer only when the just-finished match still owns it.
 if(court?.currentMatchId===m.id){
  const waiting=(s.matches||[]).filter(x=>!x.completed&&!x.isBye&&!x.skippedAt&&
   x.station===m.station&&x.a?.playerId&&x.b?.playerId).sort((a,b)=>Number(a.seq)-Number(b.seq));
  const upcoming=waiting[0]||null;
  court.currentMatchId=upcoming?.id||null;court.nextMatchId=waiting[1]?.id||null;
  court.status=upcoming?'in_progress':'idle';court.updatedAt=now;
  if(upcoming){upcoming.status='in_progress';upcoming.startedAt=upcoming.startedAt||now;}
  if(publicCourt){publicCourt.currentMatchId=court.currentMatchId;
   publicCourt.nextMatchId=court.nextMatchId;publicCourt.status=court.status;}
  const upcomingPublic=upcoming&&(p.matches||[]).find(x=>x.id===upcoming.id);
  if(upcomingPublic){upcomingPublic.status='in_progress';upcomingPublic.startedAt=upcomingPublic.startedAt||now;}
 }
 s.currentMatchId=(s.matches||[]).find(x=>!x.completed&&!x.isBye&&x.a?.playerId&&x.b?.playerId)?.id||null;
 return {ok:true,winnerId,loserId,nextMatchId:next?.id||null};
}
module.exports={completeSingle};
