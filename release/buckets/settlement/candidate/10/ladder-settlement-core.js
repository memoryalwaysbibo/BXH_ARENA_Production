'use strict';

const VERSION='BXH-LADDER-V1-LINEAR';
const TIERS=Object.freeze([
  {name:'未定級',min:0},{name:'青銅',min:1},{name:'白銀',min:100},
  {name:'黃金',min:300},{name:'白金',min:600},{name:'鑽石',min:1100},
  {name:'大師',min:1800},{name:'宗師',min:2800}
].map(Object.freeze));
const ANCHORS=Object.freeze([16,32,64,128,256,512]);

function multiplier(count){
  if(!Number.isInteger(count)||count<1||count>512)throw Error('invalid-effective-count');
  if(count<=16)return 1;
  const i=ANCHORS.findIndex(n=>count<=n);
  return 1+(i-1)*0.5+(count-ANCHORS[i-1])/(ANCHORS[i]-ANCHORS[i-1])*0.5;
}
function tier(points){
  const p=Math.max(0,Number(points)||0);
  return TIERS.reduce((name,t)=>p>=t.min?t.name:name,'未定級');
}
function tierIndex(name){const i=TIERS.findIndex(t=>t.name===name);return i<0?0:i;}
function bonus(place,count,wins){
  if(!(wins>0)||!Number.isInteger(place)||place<1)return 0;
  if(place<=4)return [90,60,40,30][place-1];
  if(place<=8)return 20;
  if(place<=16)return 10;
  if(place<=32)return count>64?8:0;
  if(place<=64)return count>96?6:0;
  if(place<=96)return count>128?4:0;
  if(place<=128)return count>160?2:0;
  return 0;
}
function isPlayed(m){
  const a=m&&m.a&&m.a.playerId,b=m&&m.b&&m.b.playerId;
  return !!(m&&m.completed&&!m.isBye&&a&&b&&a!==b&&(m.winnerId===a||m.winnerId===b)&&
    !m.forfeit&&!m.isForfeit&&!['forfeit','walkover','no_show'].includes(m.resultMethod));
}
function computeRoundRobinStandings(st){
  const map={};
  for(const p of (st.players||[]))map[p.id]={id:p.id,name:p.name,played:0,wins:0,losses:0,scoreFor:0,scoreAgainst:0,diff:0,tied:false,rank:0};
  const h2h={};
  for(const m of (st.matches||[]).filter(m=>m.bracket==='RR'&&m.completed&&m.winnerId)){
    if(!m.a||!m.b)continue;
    const a=m.a.playerId,b=m.b.playerId,loser=m.winnerId===a?b:a,isQuick=m.resultMethod==='quick_decision';
    if(map[m.winnerId]){map[m.winnerId].played++;map[m.winnerId].wins++;if(!isQuick){map[m.winnerId].scoreFor+=Number(m.winnerId===a?m.scoreA:m.scoreB)||0;map[m.winnerId].scoreAgainst+=Number(m.winnerId===a?m.scoreB:m.scoreA)||0;}}
    if(map[loser]){map[loser].played++;map[loser].losses++;if(!isQuick){map[loser].scoreFor+=Number(loser===a?m.scoreA:m.scoreB)||0;map[loser].scoreAgainst+=Number(loser===a?m.scoreB:m.scoreA)||0;}}
    h2h[m.winnerId]=h2h[m.winnerId]||{};h2h[m.winnerId][loser]='win';
    h2h[loser]=h2h[loser]||{};h2h[loser][m.winnerId]='loss';
  }
  Object.values(map).forEach(p=>p.diff=p.scoreFor-p.scoreAgainst);
  const list=Object.values(map);
  const sameStats=(a,b)=>a.wins===b.wins&&a.diff===b.diff&&a.scoreFor===b.scoreFor;
  list.sort((a,b)=>{
    if(b.wins!==a.wins)return b.wins-a.wins;
    if(h2h[a.id]&&h2h[a.id][b.id])return h2h[a.id][b.id]==='win'?-1:1;
    if(b.diff!==a.diff)return b.diff-a.diff;
    if(b.scoreFor!==a.scoreFor)return b.scoreFor-a.scoreFor;
    return 0;
  });
  let i=0;
  while(i<list.length){
    let j=i;while(j+1<list.length&&sameStats(list[j+1],list[i]))j++;
    if(j>i){
      const group=list.slice(i,j+1);group.forEach(p=>p.subWins=0);
      for(let x=0;x<group.length;x++)for(let y=0;y<group.length;y++)if(x!==y&&h2h[group[x].id]&&h2h[group[x].id][group[y].id]==='win')group[x].subWins++;
      group.sort((a,b)=>b.subWins-a.subWins);
      for(let x=0;x<group.length;x++)list[i+x]=group[x];
      let gi=i;
      while(gi<=j){
        let gj=gi;while(gj+1<=j&&list[gj+1].subWins===list[gi].subWins)gj++;
        const tied=gj>gi;for(let x=gi;x<=gj;x++){list[x].tied=tied;list[x].rank=i+1;}gi=gj+1;
      }
    }else{list[i].tied=false;list[i].rank=i+1;}
    i=j+1;
  }
  return list;
}
function deriveDoublePlacements(st){
  const champ=st.championId,runner=st.runnerUpId,lossCounts={},elimination=[];
  for(const m of (st.matches||[]).filter(m=>!m.isBye&&m.completed&&m.loserId).sort((a,b)=>(a.seq||0)-(b.seq||0))){
    lossCounts[m.loserId]=(lossCounts[m.loserId]||0)+1;
    if(lossCounts[m.loserId]>=2)elimination.push({id:m.loserId,seq:Number(m.seq||0)});
  }
  const rest=elimination.filter(x=>x.id!==runner&&x.id!==champ).sort((a,b)=>b.seq-a.seq);
  return {championId:champ,runnerUpId:runner,thirdId:st.thirdId||rest[0]?.id||null,fourthId:st.fourthId||rest[1]?.id||null};
}
function analyze(st){
  const matches=Array.isArray(st.matches)?st.matches:[],format=st.meta?.formatType||'single';
  if(!['single','double','round','roundrobin'].includes(format))throw Error('unsupported-format');
  const official=st.testMode!==true&&st.meta?.eventAuthority!=='test';
  const roster=(st.players||[]).filter(p=>!official||(p.source!=='test'&&p.isTestData!==true&&!p.testPlayerKey));
  const validIds=new Set(roster.map(p=>p.id)),wins={},losses={},actual=new Set(),ranks={};
  for(const m of matches.filter(isPlayed)){
    const a=m.a.playerId,b=m.b.playerId,loser=m.winnerId===a?b:a;
    if(!validIds.has(a)||!validIds.has(b))continue;
    actual.add(a);actual.add(b);wins[m.winnerId]=(wins[m.winnerId]||0)+1;losses[loser]=(losses[loser]||0)+1;
  }
  const players=roster.filter(p=>actual.has(p.id));
  if(new Set(players.map(p=>p.id)).size!==players.length)throw Error('duplicate-local-player');
  const count=players.length;
  if(count<2)throw Error('insufficient-effective-players');
  const weight=multiplier(count);
  let places={championId:st.championId,runnerUpId:st.runnerUpId,thirdId:st.thirdId,fourthId:st.fourthId};
  if(format==='double')places=deriveDoublePlacements(st);
  if(format==='single'){
    const rounds=matches.filter(m=>m.bracket==='SE').map(m=>Number(m.round)).filter(Number.isFinite);
    if(!rounds.length)throw Error('single-bracket-missing');
    const size=2**(Math.max(...rounds)+1);
    for(const m of matches){
      if(m.bracket!=='SE'||!m.completed||!m.winnerId)continue;
      const loser=m.loserId||(m.winnerId===m.a?.playerId?m.b?.playerId:m.a?.playerId);
      if(loser)ranks[loser]=size/2**(Number(m.round)+1)+1;
    }
  }else if(format==='double'){
    const groups=new Map();
    for(const m of matches){
      if(m.bracket!=='LB'||!m.completed||!m.winnerId)continue;
      const loser=m.loserId||(m.winnerId===m.a?.playerId?m.b?.playerId:m.a?.playerId);
      if(!loser)continue;
      const round=Number(m.round);if(!groups.has(round))groups.set(round,new Set());groups.get(round).add(loser);
    }
    let next=3;
    for(const round of [...groups.keys()].sort((a,b)=>b-a)){for(const id of groups.get(round))ranks[id]=next;next+=groups.get(round).size;}
  }else{
    for(const p of computeRoundRobinStandings(st))ranks[p.id]=p.rank;
  }
  ['championId','runnerUpId','thirdId','fourthId'].forEach((key,i)=>{if(places[key])ranks[places[key]]=i+1;});
  return {count,weight,players:players.map(p=>{
    const placement=ranks[p.id]||null,placementBonus=bonus(placement,count,wins[p.id]||0),weightedBonus=Math.round(placementBonus*weight);
    return {player:p,placement,wins:wins[p.id]||0,losses:losses[p.id]||0,pointsEarned:10+weightedBonus,
      scoring:{version:VERSION,effectiveCount:count,multiplier:weight,basePoints:10,placementBonus,weightedBonus,placementBasis:placement}};
  })};
}
function isSyntheticTestRoster(st){
  const players=Array.isArray(st?.players)?st.players:[];
  return players.length>=2&&players.every(p=>{
    if(!p||p.source!=='test'||!/^T\d{3}$/.test(String(p.testPlayerKey||'')))return false;
    const linked=p.familyPlayerId||p.registrationUid||p.accountUid||p.playerUid||p.userUid||p.authUid||p.uid||null;
    return !linked&&p.accountLinked!==true;
  });
}
function tournamentEligible(top,st){
  if(!top||!st)return {ok:false,reason:'missing'};
  if(top.eventAuthority!=='official'&&st.meta?.eventAuthority!=='official')return {ok:false,reason:'not-official'};
  if(top.ladderMode!=='ranked'&&st.meta?.ladderMode!=='ranked')return {ok:false,reason:'not-ranked'};
  if(top.testMode===true||st.testMode===true||top.eventAuthority==='test'||st.meta?.eventAuthority==='test')return {ok:false,reason:'test-event'};
  if(top.eventCancelled===true||st.meta?.eventCancelled===true)return {ok:false,reason:'cancelled'};
  if(isSyntheticTestRoster(st))return {ok:false,reason:'synthetic-test-roster'};
  const real=(st.matches||[]).filter(m=>m&&!m.isBye);
  if(!real.length||real.some(m=>m.completed!==true))return {ok:false,reason:'not-decided'};
  if(!st.championId||!st.runnerUpId)return {ok:false,reason:'placements-incomplete'};
  if(st.meta?.formatType==='single'&&st.meta?.bronzeMatch&&(!st.thirdId||!st.fourthId))return {ok:false,reason:'placements-incomplete'};
  return {ok:true};
}
function candidateUid(player){
  if(!player||player.ladderEligible===false)return '';
  if(player.familyPlayerId)return '';
  return String(player.registrationUid||player.accountUid||player.playerUid||player.userUid||player.authUid||player.uid||'').trim();
}
function validProfile(profile){
  return !!profile&&profile.active===true&&profile.deleted!==true&&profile.isTestAccount!==true&&profile.role!=='tester';
}
function buildPlan(top,st,profilesByUid,control){
  const eligibility=tournamentEligible(top,st);if(!eligibility.ok)throw Object.assign(Error(eligibility.reason),{reason:eligibility.reason});
  const scored=analyze(st),rows=[],skipped=[],seen=new Set();
  for(const item of scored.players){
    const uid=candidateUid(item.player),profile=uid?profilesByUid[uid]:null;
    if(!uid||!validProfile(profile)){skipped.push(item.player.name||item.player.id||'unknown');continue;}
    if(seen.has(uid))throw Object.assign(Error('duplicate-account'),{reason:'duplicate-account'});
    seen.add(uid);rows.push({...item,uid,playerName:String(item.player.name||profile.realName||profile.displayName||profile.nickname||uid)});
  }
  if(rows.length<2)throw Object.assign(Error('insufficient-eligible-players'),{reason:'insufficient-eligible-players'});
  if(rows.length>320)throw Object.assign(Error('eligible-player-limit'),{reason:'eligible-player-limit'});
  if(!control||control.status!=='active'||control.rolloverInProgress===true)throw Object.assign(Error('season-unavailable'),{reason:'season-unavailable'});
  const seasonId=String(control.currentSeason||'S1'),isTrialSeason=control.isTrialSeason===true||seasonId.toUpperCase()==='S0';
  const countsTowardCareer=control.countsTowardCareer===undefined?!isTrialSeason:control.countsTowardCareer===true;
  return {scoringVersion:VERSION,effectiveCount:scored.count,multiplier:scored.weight,rows,skipped,seasonId,isTrialSeason,countsTowardCareer};
}

module.exports={VERSION,TIERS,ANCHORS,multiplier,tier,tierIndex,bonus,isPlayed,computeRoundRobinStandings,deriveDoublePlacements,analyze,isSyntheticTestRoster,tournamentEligible,candidateUid,validProfile,buildPlan};
