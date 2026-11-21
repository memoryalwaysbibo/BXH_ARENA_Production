'use strict';

// Complete one team match and promote its winner within a single-elimination tree.
// Pure output lets the scoring transaction commit room and public mirror together.
function finishMatch(input, matchId, winnerSide, at, game) {
  if (input?.meta?.battleMode !== 'team' || !['single','double','roundrobin'].includes(input.meta.formatType)) throw Error('unsupported-team-format');
  const state = structuredClone(input);
  const matches = state.matches;
  const match = matches?.find(m => m.id === matchId);
  if (!match || match.isBye || match.completed || !Array.isArray(match.teamIds) ||
      !match.teamIds[0] || !match.teamIds[1] || ![0, 1].includes(winnerSide)) throw Error('invalid-match');
  const winnerId = match.teamIds[winnerSide], loserId = match.teamIds[1 - winnerSide];
  if (winnerId === loserId) throw Error('invalid-match');
  match.winnerId = winnerId;
  match.loserId = loserId;
  match.completed = true;
  match.status = 'completed';
  match.completedAt = at;
  match.updatedAt = at;
  match.scoreA = game?.rounds?.filter(r=>r.winnerSide===0).length || 0;
  match.scoreB = game?.rounds?.filter(r=>r.winnerSide===1).length || 0;
  if(input.meta.formatType==='double') propagateDouble(state,match);
  else if(input.meta.formatType==='roundrobin') {
    state.teamStandings = roundRobinStandings(state);
    if(matches.every(m=>m.completed)) {
      state.championId=state.teamStandings[0]?.tied?null:state.teamStandings[0]?.id||null;
      state.runnerUpId=state.teamStandings[1]?.tied?null:state.teamStandings[1]?.id||null;
    }
  }else{
  const next = matches.find(m => m.bracket === 'SE' && m.round === match.round + 1 &&
    m.indexInRound === Math.floor(match.indexInRound / 2));
  if (next) {
    if (next.completed || !Array.isArray(next.teamIds) || next.teamIds.length !== 2) throw Error('invalid-next-match');
    const side = match.indexInRound % 2;
    if (next.teamIds[side] && next.teamIds[side] !== winnerId) throw Error('stale-next-match');
    next.teamIds[side] = winnerId;
    if (next.teamIds[0] && next.teamIds[1]) next.status = 'ready';
  } else {
    const lastRound = Math.max(...matches.filter(m => m.bracket === 'SE').map(m => m.round));
    if (match.round !== lastRound) throw Error('missing-next-match');
    state.championId = winnerId;
    state.runnerUpId = loserId;
  }
  }
  state.currentMatchId = matches.find(m => !m.isBye && !m.completed && m.teamIds?.[0] && m.teamIds?.[1])?.id || null;
  state.teamResultRevision = Number(state.teamResultRevision || 0) + 1;
  return state;
}
function roundRobinStandings(state){
  const standings=new Map((state.teams||[]).map(t=>[t.id,{id:t.id,name:t.name,played:0,wins:0,losses:0,scoreFor:0,scoreAgainst:0,diff:0,rank:0,tied:false}]));
  const h2h=new Map();
  for(const m of state.matches.filter(m=>m.bracket==='RR'&&m.completed)){
    const a=standings.get(m.teamIds[0]),b=standings.get(m.teamIds[1]);
    if(!a||!b||![a.id,b.id].includes(m.winnerId))throw Error('invalid-team-standings');
    a.played++;b.played++;
    if(m.winnerId===a.id){a.wins++;b.losses++;h2h.set(a.id+':'+b.id,a.id);}
    else{b.wins++;a.losses++;h2h.set(a.id+':'+b.id,b.id);}
    a.scoreFor+=Number(m.scoreA)||0;a.scoreAgainst+=Number(m.scoreB)||0;
    b.scoreFor+=Number(m.scoreB)||0;b.scoreAgainst+=Number(m.scoreA)||0;
  }
  for(const row of standings.values())row.diff=row.scoreFor-row.scoreAgainst;
  const groups=new Map();
  for(const row of standings.values()){
    if(!groups.has(row.wins))groups.set(row.wins,[]);
    groups.get(row.wins).push(row);
  }
  const ranked=[];
  for(const wins of [...groups.keys()].sort((a,b)=>b-a)){
    const group=groups.get(wins);
    const mini=id=>group.filter(other=>other.id!==id&&[...h2h].some(([key,winner])=>key.split(':').includes(id)&&key.split(':').includes(other.id)&&winner===id)).length;
    group.sort((a,b)=>mini(b.id)-mini(a.id)||b.diff-a.diff||b.scoreFor-a.scoreFor);
    for(const row of group){
      const prev=ranked.at(-1);
      const equal=prev&&prev.wins===row.wins&&mini(prev.id)===mini(row.id)&&prev.diff===row.diff&&prev.scoreFor===row.scoreFor;
      row.rank=equal?prev.rank:ranked.length+1;
      if(equal){row.tied=true;prev.tied=true;}
      ranked.push(row);
    }
  }
  return ranked;
}

function propagateDouble(state,played){
  const matches=state.matches,byId=id=>matches.find(m=>m.id===id);
  const move=(m,side,id)=>{
    if(m.completed&&!m.isBye&&m.teamIds[side]!==id)throw Error('stale-next-match');
    if(m.teamIds[side]&&m.teamIds[side]!==id)throw Error('stale-next-match');
    m.teamIds[side]=id;
  };
  if(played.bracket==='GFR'){
    state.championId=played.winnerId;state.runnerUpId=played.loserId;return;
  }
  // Winner bracket descendants, then loser bracket sources, then grand final.
  for(const m of matches.filter(m=>m.bracket==='WB'&&m.round>0).sort((a,b)=>a.round-b.round)){
    const children=matches.filter(c=>c.bracket==='WB'&&c.round===m.round-1).sort((a,b)=>a.indexInRound-b.indexInRound);
    for(const side of [0,1])if(children[2*m.indexInRound+side]?.winnerId)move(m,side,children[2*m.indexInRound+side].winnerId);
  }
  for(const m of matches.filter(m=>m.bracket==='LB').sort((a,b)=>a.round-b.round||a.indexInRound-b.indexInRound)){
    const src=m.lbSrc;if(!src)throw Error('missing-loser-source');
    const ids=src.type==='first'?[byId(src.srcAId)?.loserId,byId(src.srcBId)?.loserId]:
      src.type==='merge'?[byId(src.survivorMatchId)?.winnerId,byId(src.dropperMatchId)?.loserId]:
      [byId(src.srcAMatchId)?.winnerId,byId(src.srcBMatchId)?.winnerId];
    for(const side of [0,1])if(ids[side])move(m,side,ids[side]);
    const impossible=side=>{
      const id=src.type==='first'?(side?src.srcBId:src.srcAId):
        src.type==='merge'?(side?src.dropperMatchId:src.survivorMatchId):(side?src.srcBMatchId:src.srcAMatchId);
      const source=byId(id);
      return !source||(source.completed&&!(src.type==='first'||(src.type==='merge'&&side))&&!source.winnerId)||
        (source.completed&&(src.type==='first'||(src.type==='merge'&&side))&&!source.loserId);
    };
    if(!m.completed&&!m.teamIds[0]&&!m.teamIds[1]&&impossible(0)&&impossible(1)){
      m.isBye=true;m.completed=true;m.winnerId=null;m.status='completed';
    }else if(!m.completed&&((m.teamIds[0]&&impossible(1))||(m.teamIds[1]&&impossible(0)))){
      m.isBye=true;m.completed=true;m.winnerId=m.teamIds[0]||m.teamIds[1];m.status='completed';
    }else if(!m.completed&&m.teamIds[0]&&m.teamIds[1])m.status='ready';
  }
  const gf=byId(state.gfMatchId);
  if(!gf||!gf.gfSrc)throw Error('missing-grand-final');
  const ids=[byId(gf.gfSrc.wbFinalId)?.winnerId,byId(gf.gfSrc.lbFinalId)?.winnerId];
  if(!gf.completed)for(const side of [0,1])if(ids[side])move(gf,side,ids[side]);
  if(!gf.completed&&gf.teamIds.every(Boolean))gf.status='ready';
  if(gf.completed){
    if(gf.winnerId===ids[0]){state.championId=gf.winnerId;state.runnerUpId=gf.loserId;}
    else{
      let reset=byId(state.gfResetMatchId);
      if(!reset){reset={id:gf.id+'-reset',seq:Math.max(...matches.map(m=>m.seq||0))+1,bracket:'GFR',round:0,indexInRound:0,
        teamIds:gf.teamIds.slice(),isBye:false,completed:false,status:'ready',station:gf.station,scoreA:0,scoreB:0,
        winnerId:null,loserId:null};matches.push(reset);state.gfResetMatchId=reset.id;}
      if(reset.completed){state.championId=reset.winnerId;state.runnerUpId=reset.loserId;}
    }
  }
}
module.exports = {finishMatch,roundRobinStandings};
