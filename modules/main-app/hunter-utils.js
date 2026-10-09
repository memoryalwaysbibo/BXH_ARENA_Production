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

function hunterWinRateInterval(wins,matches){
  if(!Number.isInteger(matches)||matches<=0||!Number.isInteger(wins)||wins<0||wins>matches)return null;
  const z=1.959963984540054,p=wins/matches,z2=z*z,denominator=1+z2/matches;
  const center=(p+z2/(2*matches))/denominator;
  const margin=z*Math.sqrt(p*(1-p)/matches+z2/(4*matches*matches))/denominator;
  return {low:Math.max(0,center-margin)*100,high:Math.min(100,center+margin)*100,method:"wilson-95-independent"};
}
function hunterPreMatchRating(record){
  // An offline backtest input contract. Current production loader supplies none.
  const snapshot=record&&record.ratingSnapshot,started=record&&record.matchStartedAt;
  if(!snapshot||snapshot.source!=="server"||snapshot.verified!==true||typeof snapshot.version!=="string"||!snapshot.version.trim()||
    typeof started!=="number"||!Number.isFinite(started)||started<=0||
    typeof snapshot.capturedAt!=="number"||!Number.isFinite(snapshot.capturedAt)||snapshot.capturedAt<=0||snapshot.capturedAt>=started||
    typeof snapshot.selfBefore!=="number"||!Number.isFinite(snapshot.selfBefore)||
    typeof snapshot.opponentBefore!=="number"||!Number.isFinite(snapshot.opponentBefore))return null;
  return {self:snapshot.selfBefore,opponent:snapshot.opponentBefore,version:snapshot.version,capturedAt:snapshot.capturedAt};
}
function hunterStrengthDiagnostics(records){
  const standard=hunterFilterByMode(records,"standard"),rows=standard.filter(r=>hunterScoringBreakdown(r).available&&hunterRoundIntegrity(r).validRounds>0);
  const opponents=new Map();let unresolved=0,rated=0;
  rows.forEach(r=>{
    const id=String(r.opponentIdentity&&r.opponentIdentity.scope==="cross-event"&&r.opponentIdentity.playerId||r.opponent&&r.opponent.playerId||"").trim();
    if(!id)unresolved++;else{const group=opponents.get(id)||{matches:0,wins:0};group.matches++;group.wins+=r.isWin?1:0;opponents.set(id,group);}
    if(hunterPreMatchRating(r))rated++;
  });
  const known=rows.length-unresolved,knownWins=[...opponents.values()].reduce((sum,g)=>sum+g.wins,0);
  const largest=opponents.size?Math.max(...[...opponents.values()].map(g=>g.matches)):0;
  const wins=rows.filter(r=>r.isWin).length;
  return {version:"hunter-strength-diagnostics-v1",rows,standardMatches:standard.length,matches:rows.length,wins,excluded:standard.length-rows.length,
    interval:hunterWinRateInterval(wins,rows.length),known,unresolved,uniqueOpponents:opponents.size,repeated:known-opponents.size,
    repeatShare:known?Math.round((known-opponents.size)/known*100):null,largestShare:known?Math.round(largest/known*100):null,
    knownWinRate:known?knownWins/known*100:null,
    opponentBalancedWinRate:opponents.size?[...opponents.values()].reduce((sum,g)=>sum+g.wins/g.matches,0)/opponents.size*100:null,
    rated,missingRatings:rows.length-rated,candidateScore:null,candidateStatus:"pending-calibration"};
}
function hunterBacktestStrength(records,analyze,candidate=null){
  const diagnostic=hunterStrengthDiagnostics(records),undated=diagnostic.rows.filter(r=>hunterRecordTimestamp(r)<=0).length;
  const rows=diagnostic.rows.slice().sort((a,b)=>hunterRecordTimestamp(a)-hunterRecordTimestamp(b)||hunterEvidenceMatchKey(a).localeCompare(hunterEvidenceMatchKey(b)));
  const versions=new Set(rows.map(r=>hunterPreMatchRating(r)?.version).filter(Boolean));
  let candidateReason=!candidate?"no-calibrated-formula":undated?"undated":diagnostic.missingRatings?"missing-pre-match-ratings":versions.size!==1?"mixed-rating-versions":null;
  if(candidate&&(typeof candidate.evaluate!=="function"||typeof candidate.version!=="string"||!candidate.version))throw new Error("Invalid backtest candidate contract");
  const history=[];let lastBaseline=null,lastCandidate=null,maxBaselineJump=0,maxCandidateJump=0;
  rows.forEach((row,index)=>{
    const prefix=rows.slice(0,index+1),baseline=analyze(prefix),baselineScore=baseline.eligible?baseline.overall:null;
    let candidateScore=null;
    if(!candidateReason&&baseline.eligible){
      candidateScore=candidate.evaluate(prefix.map(r=>({record:JSON.parse(JSON.stringify(r)),rating:hunterPreMatchRating(r)})));
      if(typeof candidateScore!=="number"||!Number.isFinite(candidateScore)||candidateScore<0||candidateScore>100)throw new Error("Candidate score must be finite and within 0–100");
    }
    const baselineJump=!undated&&lastBaseline!=null&&baselineScore!=null?baselineScore-lastBaseline:null;
    const candidateJump=lastCandidate!=null&&candidateScore!=null?candidateScore-lastCandidate:null;
    if(baselineJump!=null)maxBaselineJump=Math.max(maxBaselineJump,Math.abs(baselineJump));
    if(candidateJump!=null)maxCandidateJump=Math.max(maxCandidateJump,Math.abs(candidateJump));
    history.push({matchKey:hunterEvidenceMatchKey(row),matches:index+1,baselineVersion:baseline.version,baselineScore,candidateScore,baselineJump,candidateJump});
    lastBaseline=baselineScore;lastCandidate=candidateScore;
  });
  return {version:"hunter-strength-backtest-v1",diagnostic,candidateVersion:candidate&&candidate.version||null,candidateReason,
    history,maxBaselineJump:undated?null:maxBaselineJump,maxCandidateJump:candidateReason?null:maxCandidateJump,undated};
}

function hunterSampleMaturity(analysis,partial=false){
  if(partial)return {state:"partial",label:"部分資料缺失"};
  if(analysis.matches<3||analysis.validRounds<8)return {state:"accumulating",label:"資料累積中"};
  // Stable-analysis thresholds require historical backtesting; not an accuracy claim.
  return {state:"preliminary",label:"初步分析"};
}
function hunterTrendWindows(records){
  const rows=hunterUniqueRecords(records);
  const undated=rows.filter(r=>hunterRecordTimestamp(r)<=0).length;
  const dated=rows.filter(r=>hunterRecordTimestamp(r)>0).sort((a,b)=>hunterRecordTimestamp(b)-hunterRecordTimestamp(a)||hunterEvidenceMatchKey(a).localeCompare(hunterEvidenceMatchKey(b)));
  const recent=dated.slice(0,20),previous=dated.slice(20,40);
  const versions=new Set([...recent,...previous].map(r=>String(r.scoringVersion|| (hunterRecordMode(r)==="standard"?"bxh-4pt-v1":"unknown"))));
  const modes=new Set([...recent,...previous].map(hunterRecordMode));
  let reason=null;
  if(undated)reason="undated";
  else if(recent.length!==20||previous.length!==20)reason="insufficient-windows";
  else if(versions.size!==1||modes.size!==1||modes.has("unknown"))reason="mixed-versions";
  else if([...recent,...previous].some(r=>!hunterScoringBreakdown(r).available||!hunterRoundIntegrity(r).validRounds))reason="incomplete-ledger";
  return {recent,previous,undated,versions:[...versions],comparable:!reason,reason};
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

// Called with a verified server XP total. Formal growth remains the grade input.
function hunterGrowthWithPractice(formal,practiceXp){
 if(!Number.isSafeInteger(practiceXp*2)||practiceXp<0)throw Error('invalid-practice-xp');
 const xp=formal.xp+practiceXp;let level=1;
 while(level<99&&xp>=hunterLevelThreshold(level+1))level++;
 const floor=hunterLevelThreshold(level),next=hunterLevelThreshold(level+1);
 return {...formal,xpFromPractice:practiceXp,xp,level,floor,next,progress:next>floor?Math.max(0,Math.min(100,Math.round((xp-floor)/(next-floor)*100))):100};
}

function hunterSeniorityBonus(level){
  const lv=Math.max(1,Math.min(99,Math.floor(Number(level)||1)));
  return 15*Math.pow((lv-1)/98,0.75);
}
function hunterLicenseRules(){
  // Existing automatic grade rules; B6 adds traceability, not new thresholds.
  return [
    {tier:"e",label:"E 級獵人",score:0,ability:0,matches:3,rounds:8},
    {tier:"d",label:"D 級獵人",score:40,ability:0,matches:3,rounds:8},
    {tier:"c",label:"C 級獵人",score:50,ability:0,matches:3,rounds:8},
    {tier:"a",label:"A 級獵人",score:60,ability:55,matches:10,rounds:30},
    {tier:"s",label:"S 級獵人",score:70,ability:65,matches:20,rounds:60},
    {tier:"national",label:"國家級獵人",score:80,ability:75,matches:40,rounds:120}
  ];
}
function hunterLicenseGrade(analysis,level){
  const bonus=hunterSeniorityBonus(level),version="hunter-grade-v1";
  if(!analysis||!analysis.eligible||!Number.isFinite(analysis.overall)){
    return {version,tier:"pending",label:"評級中",bonus,score:null,eligible:false};
  }
  const score=Math.min(100,analysis.overall+bonus);
  const matches=analysis.matches||0,rounds=analysis.validRounds||0;
  // Eligibility already supplies the 3-match / 8-round entry gate.
  const rules=hunterLicenseRules();let rule=rules[0];
  rules.slice(1).forEach(r=>{
    if(score>=r.score&&(!r.ability||(analysis.overall>=r.ability&&matches>=r.matches&&rounds>=r.rounds)))rule=r;
  });
  return {version,tier:rule.tier,label:rule.label,bonus,score,eligible:true};
}
function hunterLicenseOverview(records,analyze,complete=true){
  const rows=hunterUniqueRecords(records),growth=hunterBuildGrowth(rows),analysis=analyze(hunterFilterByMode(rows,"standard"));
  const grade=hunterLicenseGrade(complete?analysis:{...analysis,eligible:false},growth.level);
  const rules=hunterLicenseRules(),index=rules.findIndex(r=>r.tier===grade.tier);
  const next=grade.eligible?rules[index+1]||null:rules[0];
  const gates=next?[
    {key:"score",label:"階級分",current:grade.score,target:next.score},
    {key:"ability",label:"實力分",current:grade.eligible?analysis.overall:null,target:next.ability},
    {key:"matches",label:"正規可分析對戰",current:analysis.matches,target:next.matches},
    {key:"rounds",label:"正規有效回合",current:analysis.validRounds,target:next.rounds}
  ].filter(g=>g.target>0).map(g=>({...g,current:complete?g.current:null,remaining:complete&&g.current!=null?Math.max(0,g.target-g.current):null,met:complete&&g.current!=null&&g.current>=g.target})):[];
  return {version:"hunter-license-overview-v1",growth,analysis,grade,next,gates,complete,
    versions:{xp:growth.version,strength:analysis.version,grade:grade.version},
    candidate:{status:"pending-calibration",strength:null,grade:null,connected:false}};
}
function hunterReplayLicense(records,analyze){
  const rows=hunterUniqueRecords(records),undated=rows.filter(r=>hunterRecordTimestamp(r)<=0).length;
  const ordered=rows.slice().sort((a,b)=>hunterRecordTimestamp(a)-hunterRecordTimestamp(b)||hunterEvidenceMatchKey(a).localeCompare(hunterEvidenceMatchKey(b)));
  const summary=overview=>({versions:overview.versions,matches:overview.analysis.matches,validRounds:overview.analysis.validRounds,
    xp:overview.growth.xp,level:overview.growth.level,strength:overview.grade.eligible?overview.analysis.overall:null,
    bonus:overview.grade.bonus,score:overview.grade.score,tier:overview.grade.tier,candidate:overview.candidate});
  return {version:"hunter-license-replay-v1",undated,history:undated?[]:ordered.map((r,i)=>({matchesLoaded:i+1,...summary(hunterLicenseOverview(ordered.slice(0,i+1),analyze))})),
    current:summary(hunterLicenseOverview(rows,analyze)),historyReason:undated?"undated":null,officialRulesChanged:false};
}

Object.assign(window.BXHHunterUtils||(window.BXHHunterUtils={}),{hunterGrowthWithPractice,hunterLicenseRules,hunterLicenseOverview,hunterReplayLicense,hunterWinRateInterval,hunterPreMatchRating,hunterStrengthDiagnostics,hunterBacktestStrength,hunterSampleMaturity,hunterTrendWindows,hunterDistributionRows,hunterRecordMode,hunterFilterByMode,hunterScoringBreakdown,hunterAnalysisPoints,hunterModeSummary,hunterRoundIntegrity,hunterDataStatus,hunterCoverage,hunterRecordTimestamp,hunterAchievementDateText,hunterAchievementIntegrityStatusLabel,hunterRadarVisualValue,hunterRadarPolygonPoints,hunterRadarGridPoints,hunterTrustLabel,hunterEvidenceMatchKey,hunterPointLabel,hunterOpponentIdentityRef,hunterSeniorityBonus,hunterLicenseGrade,hunterUniqueRecords,hunterLevelThreshold,hunterBuildGrowth,hunterRecordHasTrustedScore,hunterRecordScoreText,hunterCareerSummary});

})();
