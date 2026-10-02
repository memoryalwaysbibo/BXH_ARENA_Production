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
  // 50% actual distribution = full visual radius. Labels always show the true percentage.
  return Math.max(0,Math.min(100,Number(share||0)*2));
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

Object.assign(window.BXHHunterUtils||(window.BXHHunterUtils={}),{hunterRecordTimestamp,hunterAchievementDateText,hunterAchievementIntegrityStatusLabel,hunterRadarVisualValue,hunterRadarPolygonPoints,hunterRadarGridPoints,hunterTrustLabel,hunterEvidenceMatchKey,hunterPointLabel,hunterOpponentIdentityRef,hunterSeniorityBonus,hunterLicenseGrade});
