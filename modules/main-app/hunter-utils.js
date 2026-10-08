(function(){
// Core P1I — pure Hunter data/visual calculation utilities.
// No DOM, Firebase, storage, cache, or mutable app-state access.

function hunterRecordTimestamp(record){
  const completed=Number(record&&record.completedAt||0),confirmed=Number(record&&record.confirmedAt||0);
  if(completed||confirmed) return completed||confirmed;
  const parsed=Date.parse(String(record&&record.eventDate||""));
  return Number.isFinite(parsed)?parsed:0;
}

function hunterAchievementDateText(ts){
  const value=Number(ts)||0;
  if(!value) return "日期未記錄";
  const d=new Date(value);
  if(Number.isNaN(d.getTime())) return "日期未記錄";
  const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0");
  return y+"/"+m+"/"+day;
}

function hunterAchievementIntegrityStatusLabel(value){
  return {loaded_history_complete:"已載入歷史無身分排除",partial_identity_exclusions:"部分歷史資料已排除",partial_read_failures:"部分賽事讀取失敗，請重試",exact:"精確完成時間",stable_fallback_used:"部分舊資料使用穩定 fallback 排序",all_matches_analyzable:"全部 Match 具可信 Round",trusted_rounds_only:"僅可信 Round 納入 Round 成就",no_matches:"目前沒有 Match",resolved:"Evidence 全部可解析",needs_review:"存在無法解析 Evidence"}[value]||String(value||"—");
}

function hunterRadarVisualValue(share){
  // The full radius is 100%; missing denominators are handled before plotting.
  return Math.max(0,Math.min(100,Number(share||0)));
}

function hunterDistributionRows(bucket,metric="points"){
  const types=["extreme","knockout","burst","spin"];
  const totalEvents=types.reduce((sum,type)=>sum+Number(bucket[type].events||0),0);
  const totalPoints=types.reduce((sum,type)=>sum+Number(bucket[type].points||0),0);
  const denominator=metric==="events"?totalEvents:totalPoints;
  return types.map(type=>{
    const row=bucket[type],numerator=Number(row[metric==="events"?"events":"points"]||0);
    return {type,events:Number(row.events||0),points:Number(row.points||0),totalEvents,totalPoints,numerator,denominator,
      share:denominator>0?Math.round(numerator/denominator*100):null};
  });
}

function hunterRadarPolygonPoints(values,radius=105,cx=160,cy=160){
  return values.map((value,index)=>{
    const angle=(-90+index*45)*Math.PI/180;
    const r=radius*Math.max(0,Math.min(100,Number(value||0)))/100;
    return (cx+Math.cos(angle)*r).toFixed(1)+","+(cy+Math.sin(angle)*r).toFixed(1);
  }).join(" ");
}

function hunterRadarGridPoints(scale,radius=105,cx=160,cy=160){
  return Array.from({length:8},(_,index)=>{
    const angle=(-90+index*45)*Math.PI/180;
    const r=radius*scale;
    return (cx+Math.cos(angle)*r).toFixed(1)+","+(cy+Math.sin(angle)*r).toFixed(1);
  }).join(" ");
}

function hunterTrustLabel(value){
  return { "complete-round":"完整回合","legacy-identity":"舊資料身分相容","quick-decision":"Quick Decision","round-incomplete":"Round 資料不完整" }[value]||"資料狀態未知";
}

function hunterEvidenceMatchKey(ev){
  return String(ev.eventCode||"event")+"|"+String(ev.matchId||"match");
}

function hunterPointLabel(type,perspective){
  const names={extreme:"極限",knockout:"擊飛",burst:"爆裂",spin:"轉停"};
  const n=names[type]||type||"得分";
  return perspective==="against"?"被"+n:n;
}

function hunterOpponentIdentityRef(record){
  const code=String(record&&record.eventCode||"").toUpperCase();
  const localId=String(record&&record.opponent&&record.opponent.localPlayerId||"");
  return code&&localId?(code+"|"+localId):"";
}

function hunterRecordHasTrustedScore(record){
  if(!record||record.resultMethod==="quick_decision"||record.analyzable!==true) return false;
  if(record.scoreFor==null||record.scoreAgainst==null) return false;
  const scoreFor=Number(record.scoreFor),scoreAgainst=Number(record.scoreAgainst);
  return Number.isFinite(scoreFor)&&Number.isFinite(scoreAgainst)&&scoreFor>=0&&scoreAgainst>=0&&hunterRoundIntegrity(record).ok;
}
function hunterRecordMode(record){
  if(record&&record.sourceType==="hunter-clash")return "pk";
  const version=String(record&&record.scoringVersion||"");
  if(version==="bxh-enchantment-v2")return "enchantment";
  if(version&&version!=="bxh-4pt-v1")return "unknown";
  if(record&&record.playMode==="enchantment")return version?"unknown":"enchantment";
  if(!version&&(record&&record.roundsPerspective||[]).some(ev=>ev.v===2))return "unknown";
  return "standard";
}
function hunterFilterByMode(records,mode="all"){
  const rows=hunterUniqueRecords(records);
  return mode==="all"?rows:rows.filter(r=>hunterRecordMode(r)===mode);
}
function hunterScoringBreakdown(record){
  const check=hunterRoundIntegrity(record);
  if(!check.ok)return {available:false,reason:check.reason};
  const mode=hunterRecordMode(record);
  if(mode==="unknown")return {available:false,reason:"unknown-scoring-version"};
  const result={available:true,baseFor:0,baseAgainst:0,gainFor:0,gainAgainst:0,reductionFor:0,reductionAgainst:0,faultFor:0,faultAgainst:0,actualFor:0,actualAgainst:0};
  const basePoints={spin:1,knockout:2,burst:2,extreme:3,fault:1};
  for(const ev of record.roundsPerspective){
    const side=ev.perspective==="for"?"For":"Against";
    let base=ev.points,delta=0;
    if(mode==="enchantment"){
      if(ev.v!==2||!Number.isInteger(ev.basePoints)||ev.basePoints!==basePoints[ev.type]||
         !Number.isInteger(ev.delta)||ev.basePoints+ev.delta!==ev.points||
         (ev.type==="fault"&&(ev.points!==1||ev.delta!==0)))return {available:false,reason:"enchantment-breakdown-missing"};
      base=ev.basePoints;delta=ev.delta;
    }
    if(ev.type==="fault")result["fault"+side]+=ev.points;
    else{
      result["base"+side]+=base;
      result["gain"+side]+=Math.max(0,delta);
      result["reduction"+side]+=Math.max(0,-delta);
    }
    result["actual"+side]+=ev.points;
  }
  return result;
}
function hunterAnalysisPoints(record,event){
  return hunterRecordMode(record)==="enchantment"?event.basePoints:event.points;
}
function hunterModeSummary(records){
  const rows=hunterUniqueRecords(records),counts={standard:0,pk:0,enchantment:0,unknown:0};
  const totals={baseFor:0,baseAgainst:0,gainFor:0,gainAgainst:0,reductionFor:0,reductionAgainst:0,faultFor:0,faultAgainst:0,actualFor:0,actualAgainst:0};
  let enchantmentVerified=0,enchantmentExcluded=0;
  rows.forEach(r=>{
    const mode=hunterRecordMode(r);counts[mode]++;
    if(mode!=="enchantment")return;
    const split=hunterScoringBreakdown(r);
    if(!split.available){enchantmentExcluded++;return;}
    enchantmentVerified++;
    Object.keys(totals).forEach(key=>totals[key]+=split[key]);
  });
  return {counts,totals,enchantmentVerified,enchantmentExcluded};
}
// Fault awards reconcile the score, but are not physical finish rounds.
function hunterRoundIntegrity(record){
  const fail=reason=>({ok:false,reason,rounds:[],validRounds:0});
  if(!record||record.resultMethod==="quick_decision") return fail("quick-decision");
  if(record.analyzable!==true) return fail("round-incomplete");
  const events=record.roundsPerspective;
  if(!Array.isArray(events)||!events.length) return fail("round-incomplete");
  const seen=new Set();let scoreFor=0,scoreAgainst=0;
  for(const ev of events){
    if(!ev||!["extreme","knockout","burst","spin","fault"].includes(ev.type)||
       !["for","against"].includes(ev.perspective)||typeof ev.points!=="number"||
       !Number.isInteger(ev.points)||ev.points<0) return fail("invalid-round-event");
    if(ev.eventId){if(seen.has(ev.eventId))return fail("duplicate-round-event");seen.add(ev.eventId);}
    if(ev.perspective==="for")scoreFor+=ev.points;else scoreAgainst+=ev.points;
  }
  if(record.scoreFor==null||record.scoreAgainst==null||
     scoreFor!==Number(record.scoreFor)||scoreAgainst!==Number(record.scoreAgainst))return fail("score-ledger-mismatch");
  const rounds=events.filter(ev=>ev.type!=="fault");
  return {ok:true,reason:null,rounds,validRounds:rounds.length};
}

function hunterDataStatus(cache,loading,error){
  if(loading||(!cache&&!error))return "loading";
  if(error)return "error";
  if(Array.isArray(cache&&cache.skipped)&&cache.skipped.length)return "partial";
  return cache&&Array.isArray(cache.records)&&cache.records.length?"ready":"empty";
}

function hunterCoverage(records,skipped){
  const rows=hunterUniqueRecords(records),reasons={};let matches=0,validRounds=0;
  rows.forEach(r=>{const check=hunterRoundIntegrity(r),split=hunterScoringBreakdown(r);if(check.ok&&check.validRounds&&split.available){matches++;validRounds+=check.validRounds;}
    else {const reason=check.reason||(!split.available?split.reason:"no-finish-rounds");reasons[reason]=(reasons[reason]||0)+1;}});
  const skippedReasons={};
  (Array.isArray(skipped)?skipped:[]).forEach(r=>{const reason=r&&r.reason||"unknown";skippedReasons[reason]=(skippedReasons[reason]||0)+1;});
  return {totalMatches:rows.length,analyzableMatches:matches,validRounds,reasons,skippedReasons};
}
function hunterRecordScoreText(record){
  return hunterRecordHasTrustedScore(record)?String(Number(record.scoreFor))+" / "+String(Number(record.scoreAgainst)):"比分未驗證";
}

function hunterCareerSummary(records){
  const rows=hunterUniqueRecords(records);
  let wins=0,losses=0,totalFor=0,totalAgainst=0,validRounds=0,scoredMatches=0;
  rows.forEach(r=>{
    if(r.isWin) wins++; else losses++;
    if(hunterRecordHasTrustedScore(r)){scoredMatches++;totalFor+=Number(r.scoreFor);totalAgainst+=Number(r.scoreAgainst);}
    validRounds+=hunterRoundIntegrity(r).validRounds;
  });
  return {matches:rows.length,wins,losses,winRate:rows.length?Math.round(wins/rows.length*100):0,totalFor,totalAgainst,net:totalFor-totalAgainst,validRounds,scoredMatches};
}

const HUNTER_GROWTH_VERSION="hunter-xp-v1";
const HUNTER_XP_PER_MATCH=10;
const HUNTER_XP_PER_VALID_ROUND=2;
const HUNTER_XP_PER_EVENT=20;

function hunterUniqueRecords(records){
  const latest=new Map();
  (Array.isArray(records)?records:[]).forEach((r,index)=>{
    if(!r) return;
    const eventKey=window.BXHDomainUtils.hunterRecordEventKey(r);
    const matchKey=String((r&&r.matchId)||(((r&&r.opponent&&r.opponent.name)||"opponent")+"|"+String((r&&r.round)||"")+"|"+String(hunterRecordTimestamp(r)||index)));
    const key=eventKey+"|"+matchKey;
    const previous=latest.get(key);
    const revisionTime=row=>Math.max(Number(row.updatedAt)||0,Number(row.confirmedAt)||0,Number(row.completedAt)||0);
    if(!previous||revisionTime(r)>=revisionTime(previous))latest.set(key,r);
  });
  // A newer incomplete result must not resurrect its older completed win.
  return [...latest.values()].filter(r=>r.completed!==false&&r.isBye!==true);
}
function hunterLevelThreshold(level){
  const lv=Math.max(1,Math.floor(Number(level)||1));
  return lv<=1?0:25*(lv-1)*lv;
}
function hunterBuildGrowth(records){
  const rows=hunterUniqueRecords(records);
  const eventCount=new Set(rows.map(window.BXHDomainUtils.hunterRecordEventKey)).size;
  const validRounds=rows.reduce((sum,r)=>sum+hunterRoundIntegrity(r).validRounds,0);
  const xpFromMatches=rows.length*HUNTER_XP_PER_MATCH;
  // Preserve existing XP credits; ability rounds exclude fault awards.
  const experienceEvents=rows.reduce((sum,r)=>sum+(r&&r.analyzable&&Array.isArray(r.roundsPerspective)?r.roundsPerspective.length:0),0);
  const xpFromRounds=experienceEvents*HUNTER_XP_PER_VALID_ROUND;
  const xpFromEvents=eventCount*HUNTER_XP_PER_EVENT;
  const xp=xpFromMatches+xpFromRounds+xpFromEvents;
  let level=1;
  while(level<99 && xp>=hunterLevelThreshold(level+1)) level++;
  const floor=hunterLevelThreshold(level);
  const next=hunterLevelThreshold(level+1);
  const progress=next>floor?Math.max(0,Math.min(100,Math.round((xp-floor)/(next-floor)*100))):100;
  return {version:HUNTER_GROWTH_VERSION,rows,eventCount,validRounds,experienceEvents,xp,xpFromMatches,xpFromRounds,xpFromEvents,level,floor,next,progress};
}

function hunterSeniorityBonus(level){
  const lv=Math.max(1,Math.min(99,Math.floor(Number(level)||1)));
  return 15*Math.pow((lv-1)/98,0.75);
}
function hunterLicenseGrade(analysis,level){
  const bonus=hunterSeniorityBonus(level);
  if(!analysis||!analysis.eligible||!Number.isFinite(analysis.overall)){
    return {tier:"pending",label:"評級中",bonus,score:null,eligible:false};
  }
  const score=Math.min(100,analysis.overall+bonus);
  const matches=analysis.matches||0,rounds=analysis.validRounds||0;
  let label=score>=50?"C 級獵人":score>=40?"D 級獵人":"E 級獵人";
  if(score>=60&&analysis.overall>=55&&matches>=10&&rounds>=30)label="A 級獵人";
  if(score>=70&&analysis.overall>=65&&matches>=20&&rounds>=60)label="S 級獵人";
  if(score>=80&&analysis.overall>=75&&matches>=40&&rounds>=120)label="國家級獵人";
  return {tier:label==="國家級獵人"?"national":label[0].toLowerCase(),label,bonus,score,eligible:true};
}

Object.assign(window.BXHHunterUtils||(window.BXHHunterUtils={}),{hunterDistributionRows,hunterRecordMode,hunterFilterByMode,hunterScoringBreakdown,hunterAnalysisPoints,hunterModeSummary,hunterRoundIntegrity,hunterDataStatus,hunterCoverage,hunterRecordTimestamp,hunterAchievementDateText,hunterAchievementIntegrityStatusLabel,hunterRadarVisualValue,hunterRadarPolygonPoints,hunterRadarGridPoints,hunterTrustLabel,hunterEvidenceMatchKey,hunterPointLabel,hunterOpponentIdentityRef,hunterSeniorityBonus,hunterLicenseGrade,hunterUniqueRecords,hunterLevelThreshold,hunterBuildGrowth,hunterRecordHasTrustedScore,hunterRecordScoreText,hunterCareerSummary});

})();
