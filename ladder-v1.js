/* BXH Ladder V1: shared, deterministic scoring; no database writes. */
(function (root) {
  'use strict';
  const version = 'BXH-LADDER-V1-LINEAR';
  const tiers = Object.freeze([
    {name:'未定級',min:0}, {name:'青銅',min:1}, {name:'白銀',min:100},
    {name:'黃金',min:300}, {name:'白金',min:600}, {name:'鑽石',min:1100},
    {name:'大師',min:1800}, {name:'宗師',min:2800}
  ].map(Object.freeze));
  const anchors = Object.freeze([16,32,64,128,256,512]);
  function multiplier(count) {
    if (!Number.isInteger(count) || count < 1 || count > 512)
      throw new Error('V1 積分僅支援 1～512 位有效參賽者');
    if (count <= 16) return 1;
    const i = anchors.findIndex(n => count <= n);
    return 1 + (i-1)*0.5 + (count-anchors[i-1])/(anchors[i]-anchors[i-1])*0.5;
  }
  function tier(points) {
    const p = Math.max(0, Number(points)||0);
    return tiers.reduce((name,t) => p >= t.min ? t.name : name, '未定級');
  }
  function bonus(place, count, wins) {
    if (!(wins > 0) || !Number.isInteger(place) || place < 1) return 0;
    if (place <= 4) return [90,60,40,30][place-1];
    if (place <= 8) return 20;
    if (place <= 16) return 10;
    if (place <= 32) return count > 64 ? 8 : 0;
    if (place <= 64) return count > 96 ? 6 : 0;
    if (place <= 96) return count > 128 ? 4 : 0;
    if (place <= 128) return count > 160 ? 2 : 0;
    return 0;
  }
  function isPlayed(m) {
    const a=m.a?.playerId, b=m.b?.playerId;
    return !!(m.completed && !m.isBye && a && b && a!==b &&
      (m.winnerId===a || m.winnerId===b) && !m.forfeit && !m.isForfeit &&
      !['forfeit','walkover','no_show'].includes(m.resultMethod));
  }
  function analyze(st, places, standings) {
    const matches=st.matches||[], format=st.meta?.formatType||'single';
    if (!['single','double','round'].includes(format) && format!=='roundrobin')
      throw new Error('此賽制尚未支援 V1 積分');
    const official=st.testMode!==true && st.meta?.eventAuthority!=='test';
    const roster=(st.players||[]).filter(p=>!official || (p.source!=='test' && p.isTestData!==true && !p.testPlayerKey));
    const validIds=new Set(roster.map(p=>p.id));
    const wins={}, losses={}, actual=new Set(), ranks={};
    for (const m of matches.filter(isPlayed)) {
      const a=m.a.playerId,b=m.b.playerId,loser=m.winnerId===a?b:a;
      if(!validIds.has(a)||!validIds.has(b)) continue;
      actual.add(a); actual.add(b);
      wins[m.winnerId]=(wins[m.winnerId]||0)+1;
      losses[loser]=(losses[loser]||0)+1;
    }
    // Unplayed byes/no-shows are not participation. Test identities never inflate official weight.
    const players=roster.filter(p=>actual.has(p.id));
    if (new Set(players.map(p=>p.id)).size!==players.length) throw new Error('參賽名單含重複選手');
    const count=players.length;
    if (count<2) throw new Error('至少需要兩位有效參賽者才能結算積分');
    const weight=multiplier(count);
    if (format==='single') {
      const rounds=matches.filter(m=>m.bracket==='SE').map(m=>Number(m.round));
      const size=2**(Math.max(...rounds)+1);
      for (const m of matches) {
        if(m.bracket!=='SE' || !m.completed || !m.winnerId) continue;
        const loser=m.loserId || (m.winnerId===m.a?.playerId?m.b?.playerId:m.a?.playerId);
        if(loser) ranks[loser]=size/2**(Number(m.round)+1)+1;
      }
    } else if (format==='double') {
      // Elimination occurs in LB, never at a first loss in WB.
      const groups=new Map();
      for(const m of matches){
        if(m.bracket!=='LB'||!m.completed||!m.winnerId) continue;
        const loser=m.loserId||(m.winnerId===m.a?.playerId?m.b?.playerId:m.a?.playerId);
        if(!loser) continue;
        const r=Number(m.round); if(!groups.has(r)) groups.set(r,new Set());
        groups.get(r).add(loser);
      }
      let next=3;
      for(const r of [...groups.keys()].sort((a,b)=>b-a)){
        for(const id of groups.get(r)) ranks[id]=next;
        next+=groups.get(r).size;
      }
    } else {
      for(const p of standings||[]) ranks[p.id]=p.rank;
    }
    ['championId','runnerUpId','thirdId','fourthId'].forEach((key,i)=>{
      if(places[key]) ranks[places[key]]=i+1;
    });
    return {count,weight,players:players.map(p=>{
      const placement=ranks[p.id]||null, placementBonus=bonus(placement,count,wins[p.id]||0);
      return {player:p,placement,wins:wins[p.id]||0,losses:losses[p.id]||0,
        pointsEarned:10+Math.round(placementBonus*weight),
        scoring:{version,effectiveCount:count,multiplier:weight,basePoints:10,
          placementBonus,weightedBonus:Math.round(placementBonus*weight),placementBasis:placement}};
    })};
  }
  const api=Object.freeze({version,tiers,anchors,multiplier,tier,bonus,isPlayed,analyze});
  if(typeof module!=='undefined' && module.exports) module.exports=api;
  else root.BXHLadderV1=api;
})(typeof globalThis!=='undefined'?globalThis:this);
