(function(){
'use strict';
// Pure, versioned 2.1 evaluator. No cloud writes or changes to the legacy analysis API.
const U=window.BXHHunterUtils;
const eventKey=r=>window.BXHDomainUtils.hunterRecordEventKey(r);
const VERSION='hunter-license-v2.1',START=Date.parse('2026-10-01T00:00:00+08:00'),WINDOW=20;
const RULES=[
  ['e','E 級獵人',25,20,2,1,2,0,0],
  ['d','D 級獵人',35,25,4,2,3,0,0],
  ['c','C 級獵人',45,35,7,3,5,0,0],
  ['b','B 級獵人',55,45,12,5,8,0,0],
  ['a','A 級獵人',65,55,20,8,12,1,0],
  ['s','S 級獵人',75,65,30,12,20,2,1],
  ['national','國家級獵人',85,75,50,20,30,2,2]
].map(([tier,label,score,ability,matches,events,opponents,medium,large])=>Object.freeze({tier,label,score,ability,matches,events,opponents,medium,large,rounds:0}));
const rules=()=>RULES.map(r=>({...r}));
const rank=tier=>RULES.findIndex(r=>r.tier===tier);
function opponentKey(r){
  const identity=r.opponentIdentity;
  if(identity)return identity.scope==='cross-event'?String(identity.playerId||'').trim():'';
  // Local IDs and names cannot establish a cross-event identity.
  return r.opponent?.accountLinked===true?String(r.opponent.playerId||'').trim():'';
}
function valid(r){
  return U.hunterRecordMode(r)==='standard'&&r.eventAuthority==='official'&&r.testMode!==true&&
    !['team','team_battle','relay'].includes(r.formatType)&&(!r.battleMode||r.battleMode==='individual')&&
    U.hunterRecordTimestamp(r)>=START&&typeof r.isWin==='boolean'&&
    U.hunterRoundIntegrity(r).ok&&U.hunterRoundIntegrity(r).validRounds>0&&U.hunterScoringBreakdown(r).available;
}
function ordered(records){
  return U.hunterUniqueRecords(records).filter(valid).sort((a,b)=>U.hunterRecordTimestamp(a)-U.hunterRecordTimestamp(b)||U.hunterEvidenceMatchKey(a).localeCompare(U.hunterEvidenceMatchKey(b)));
}
function strength(rows){
  let wins=0,totalFor=0,totalAgainst=0,validRounds=0;
  rows.forEach(r=>{
    wins+=r.isWin?1:0;
    U.hunterRoundIntegrity(r).rounds.forEach(ev=>{
      const points=U.hunterAnalysisPoints(r,ev);
      if(ev.perspective==='for')totalFor+=points;else totalAgainst+=points;
      validRounds++;
    });
  });
  // Preserve the established rounding order: round each component, then the total.
  const winRate=rows.length?Math.round(wins/rows.length*100):0;
  const pointEfficiency=totalFor+totalAgainst?Math.round(totalFor/(totalFor+totalAgainst)*100):0;
  return {version:'hunter-strength-recent20-v1',matches:rows.length,wins,winRate,pointEfficiency,totalFor,totalAgainst,validRounds,
    eligible:rows.length>0,overall:rows.length?Math.round(winRate*.6+pointEfficiency*.4):null};
}
function experience(rows){
  const events=new Map(),opponents=new Set();let unknownSizes=0,unresolvedOpponents=0;
  rows.forEach(r=>{
    const key=eventKey(r),identity=opponentKey(r);
    if(identity)opponents.add(identity);else unresolvedOpponents++;
    const count=Number(r.licenseEventParticipants);
    const verified=r.licenseParticipantSource==='completed-match-roster-v1'&&Number.isSafeInteger(count)&&count>=2;
    if(!events.has(key))events.set(key,verified?count:null);
    else if(verified&&events.get(key)!==count)events.set(key,null);
  });
  let medium=0,large=0;
  events.forEach(n=>{if(n==null)unknownSizes++;else if(n>=128)large++;else if(n>=96)medium++;});
  return {matches:rows.length,events:events.size,opponents:opponents.size,medium,large,unknownSizes,unresolvedOpponents};
}
function gradeOf(analysis,level,life,complete){
  const bonus=U.hunterSeniorityBonus(level),score=complete&&analysis.eligible?Math.min(100,analysis.overall+bonus):null;
  let grade={version:VERSION,tier:complete?'ungraded':'pending',label:complete?'未分級':'資料待核對',eligible:complete&&analysis.eligible,score,bonus};
  if(score!=null)RULES.forEach(r=>{
    if(score>=r.score&&analysis.overall>=r.ability&&['matches','events','opponents','medium','large'].every(k=>life[k]>=r[k]))grade={...grade,tier:r.tier,label:r.label};
  });
  return grade;
}
function overview(records,_analyze,complete=true){
  const all=U.hunterUniqueRecords(records),rows=ordered(all);
  // Keep the existing event-XP source and curve; practice XP does not affect grade.
  const growth=U.hunterBuildGrowth(all),analysis=strength(rows.slice(-WINDOW)),life=experience(rows);
  const grade=gradeOf(analysis,growth.level,life,complete);
  const next=RULES[rank(grade.tier)+1]||null;
  const fields=[['score','評級分',grade.score],['ability','最近 20 場實力分',analysis.overall],['matches','生涯有效對戰',life.matches],['events','不同賽事',life.events],['opponents','不同對手（已核對）',life.opponents],['medium','中型賽事（96–127 人）',life.medium],['large','大型賽事（128 人以上）',life.large]];
  const gates=next?fields.filter(([key])=>next[key]>0).map(([key,label,value])=>({key,label,target:next[key],current:complete?value:null,remaining:complete&&value!=null?Math.max(0,next[key]-value):null,met:complete&&value!=null&&value>=next[key]})):[];
  // Historical replay is a preview/backfill, not an irreversible server grant.
  let highest={tier:complete?'ungraded':'pending',label:complete?'未分級':'資料待核對',at:null};
  if(complete){
    const timeline=all.filter(r=>U.hunterRecordTimestamp(r)>0).sort((a,b)=>U.hunterRecordTimestamp(a)-U.hunterRecordTimestamp(b)||U.hunterEvidenceMatchKey(a).localeCompare(U.hunterEvidenceMatchKey(b)));
    const played=[],xpEvents=new Set(),lifeEvents=new Map(),lifeOpponents=new Set();
    let xp=0;
    for(let i=0;i<timeline.length;){
      const at=U.hunterRecordTimestamp(timeline[i]);
      // Do not infer an achievement from an arbitrary ordering of simultaneous results.
      while(i<timeline.length&&U.hunterRecordTimestamp(timeline[i])===at){
        const r=timeline[i++],key=eventKey(r);
        xp+=10+(r.analyzable&&Array.isArray(r.roundsPerspective)?r.roundsPerspective.length*2:0);
        if(!xpEvents.has(key)){xpEvents.add(key);xp+=20;}
        if(valid(r)){
          played.push(r);const identity=opponentKey(r);if(identity)lifeOpponents.add(identity);
          const n=Number(r.licenseEventParticipants),known=r.licenseParticipantSource==='completed-match-roster-v1'&&Number.isSafeInteger(n)&&n>=2;
          if(!lifeEvents.has(key))lifeEvents.set(key,known?n:null);else if(known&&lifeEvents.get(key)!==n)lifeEvents.set(key,null);
        }
      }
      let level=1,medium=0,large=0;
      while(level<99&&xp>=U.hunterLevelThreshold(level+1))level++;
      lifeEvents.forEach(n=>{if(n>=128)large++;else if(n>=96)medium++;});
      const historical=gradeOf(strength(played.slice(-WINDOW)),level,{matches:played.length,events:lifeEvents.size,opponents:lifeOpponents.size,medium,large},true);
      if(rank(historical.tier)>rank(highest.tier))highest={tier:historical.tier,label:historical.label,at};
    }
  }
  if(complete&&rank(grade.tier)>rank(highest.tier))highest={tier:grade.tier,label:grade.label,at:null};
  if(!complete){analysis.eligible=false;analysis.overall=null;}
  return {version:VERSION,growth,analysis,grade,next,gates,complete,life,highest,window:WINDOW,
    highestStatus:complete?'replayed-not-persisted':'incomplete',excluded:all.length-rows.length,
    versions:{xp:growth.version,strength:analysis.version,grade:VERSION},candidate:{status:'future-only',strength:null,grade:null,connected:false}};
}
function renderOverview(o,esc){
  const number=n=>n==null?'—':Number.isInteger(n)?String(n):(Math.floor(n*10)/10).toFixed(1);
  const table=RULES.map(r=>'<tr>'+[r.label,r.score,r.ability,r.matches,r.events,r.opponents,r.medium,r.large].map(v=>'<td>'+esc(String(v))+'</td>').join('')+'</tr>').join('');
  return '<details class="hunter-grade-detail"><summary><b>獵人執照 2.1｜階級判定</b><strong>'+number(o.grade.score)+'</strong></summary><div class="hunter-grade-detail-content">'+
    '<p>最近 '+o.analysis.matches+' 場實力 '+number(o.analysis.overall)+' ＋ 歷練加成 '+number(o.grade.bonus)+' ＝ 評級分 '+number(o.grade.score)+'</p>'+
    '<p>目前：'+esc(o.grade.label)+'｜生涯最高（歷史回算）：'+esc(o.highest.label)+'</p>'+
    '<small>實力分採最近 20 場有效對戰：勝率 ×60%＋得分占比 ×40%；不足 20 場採現有場次。各項百分比與實力分沿用整數四捨五入；判級使用未四捨五入的歷練加成。歷練加成依賽事 LV，最高 +15，不含練習 XP。換季與休息不扣分。</small>'+
    (!o.complete?'<p>部分資料缺失，暫停階級判定與升級差距。</p>':o.next?'<div class="hunter-grade-next"><b>下一階級：'+esc(o.next.label)+'</b><ul>'+o.gates.map(g=>'<li><span>'+esc(g.label)+'</span><strong>'+number(g.current)+' / '+g.target+'</strong><small>'+(g.met?'已達標':g.remaining==null?'尚未出分':'還差 '+number(g.remaining))+'</small></li>').join('')+'</ul></div>':'<p>目前已達最高階級。</p>')+
    '<div class="hunter-v21-table"><table><thead><tr>'+['階級','評級分','最低實力','對戰','賽事','對手','中型','大型'].map(s=>'<th>'+s+'</th>').join('')+'</tr></thead><tbody>'+table+'</tbody></table></div>'+
    '<small>各項條件需同時達標；生涯歷練跨季累積。中型 96–127 人、大型 128 人以上，兩者分開計算；不同對手只計已核對的唯一身分。有效回合保留統計，不另作晉級門檻。</small>'+
    '<p class="hint">賽事規模待核對 '+o.life.unknownSizes+' 次；對手身分待核對 '+o.life.unresolvedOpponents+' 場。只採 2026/10/1 起正式個人賽可信對戰，其他紀錄仍保留。生涯最高目前為新版歷史回算，尚未寫入永久授予紀錄。</p></div></details>';
}
window.BXHHunterLicenseV21=Object.freeze({version:VERSION,rules,overview,strength,experience,ordered,gradeOf,renderOverview});
})();
