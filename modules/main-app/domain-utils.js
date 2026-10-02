(function(){
// Core P1K — pure domain/value utilities.
// No DOM, Firebase, storage, cache, or mutable app-state access.

function ensureTestName(name){
  const clean=String(name||"BXH 封測賽事").trim().replace(/\s*（測試）\s*$/u,"");
  return clean+"（測試）";
}

function scheduledTournamentStartMs(meta){
  const m=meta||{};
  if(!m.date || !m.startTime) return null;
  const raw=String(m.date)+"T"+String(m.startTime)+":00+08:00";
  const ms=Date.parse(raw);
  return isNaN(ms)?null:ms;
}

function canonicalPublicTournamentPhase(t){
  if(!t) return "waiting";
  const parsed=t.parsedData||{};
  const top=String(t.tournamentPhase||t.phase||"waiting");
  if(t.eventCancelled || (parsed.meta&&parsed.meta.eventCancelled)) return "cancelled";
  if(parsed.archiveStatus==="completed" || t.archiveStatus==="completed") return "done";
  const matches=Array.isArray(parsed.matches)?parsed.matches:[];
  const real=matches.filter(m=>!m.isBye);
  const started=!!parsed.startedAt || !!t.startedAt;
  if(real.length && real.every(m=>m.completed)) return "settling";
  if(started && real.length) return "live";
  if(top==="done" || top==="settling" || top==="live" || top==="cancelled") return top;
  return "waiting";
}

function publicTournamentRegistrationLocked(t){
  const phase=canonicalPublicTournamentPhase(t);
  return phase==="live" || phase==="settling" || phase==="done" || phase==="cancelled";
}

function hunterRecordEventKey(record){
  return String((record&&record.eventCode)||(record&&record.tournamentId)||(((record&&record.eventName)||"event")+"|"+((record&&record.eventDate)||"")));
}

function hunterAchievementMatchKey(record){
  const eventKey=hunterRecordEventKey(record);
  const matchId=String(record&&record.matchId||"").trim();
  if(matchId) return eventKey+"|"+matchId;
  const legacy=[
    String(record&&record.round!=null?record.round:""),
    String(record&&record.indexInRound!=null?record.indexInRound:""),
    String(record&&record.station!=null?record.station:""),
    String(window.BXHHunterUtils.hunterRecordTimestamp(record)||0)
  ].join(":");
  return eventKey+"|legacy:"+legacy;
}

function hunterAchievementHasExactMatchTime(record){
  return Number(record&&record.completedAt||0)>0||Number(record&&record.confirmedAt||0)>0;
}

function hunterAchievementAwardLabel(item){
  if(item&&item.awardStatus==="awarded")return "永久徽章";
  if(item&&item.unlockState==="unlocked_derived")return item.awardStatus==="blocked_incomplete_history"?"待完整驗證":"已達成";
  return "進行中";
}

function hunterAchievementAwardMeta(item){
  if(item&&item.awardStatus==="awarded")return "永久徽章已由伺服器發放";
  if(item&&item.awardStatus==="blocked_incomplete_history")return "歷史資料不完整，已安全暫停永久發放";
  if(item&&item.unlockState==="unlocked_derived")return "已達門檻，等待伺服器同步";
  return "尚未達成永久徽章門檻";
}

function operationsDate(n){return n?new Date(n).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'}):'—';}

function snapToHalfHourValue(raw, type){
  if(!raw) return raw;
  try{
    if(type==="time"){
      const m=String(raw).match(/^(\d{2}):(\d{2})/);
      if(!m) return raw;
      let h=parseInt(m[1],10), min=parseInt(m[2],10);
      if(min<15) min=0;
      else if(min<45) min=30;
      else { min=0; h=(h+1)%24; }
      return String(h).padStart(2,"0")+":"+String(min).padStart(2,"0");
    }
    if(type==="datetime-local"){
      const m=String(raw).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
      if(!m) return raw;
      let d=new Date(m[1]+"T"+m[2]+":"+m[3]+":00");
      const min=d.getMinutes();
      if(min<15) d.setMinutes(0,0,0);
      else if(min<45) d.setMinutes(30,0,0);
      else { d.setHours(d.getHours()+1); d.setMinutes(0,0,0); }
      const y=d.getFullYear(), mo=String(d.getMonth()+1).padStart(2,"0"), day=String(d.getDate()).padStart(2,"0"), h=String(d.getHours()).padStart(2,"0"), mi=String(d.getMinutes()).padStart(2,"0");
      return `${y}-${mo}-${day}T${h}:${mi}`;
    }
  }catch(_e){}
  return raw;
}

function buildPublicTournamentSnapshot(st){return Object.assign({},st,{registrations:[]});}
function roomStatusDescriptor(phase){
  const p=phase||"waiting";
  if(p==="cancelled")return {key:"cancelled",label:"已取消",dot:"red"};
  if(p==="done")return {key:"done",label:"已結束",dot:"gray"};
  if(p==="settling")return {key:"settling",label:"結算中",dot:"orange"};
  if(p==="live")return {key:"live",label:"比賽中",dot:"yellow"};
  if(p==="prestart")return {key:"prestart",label:"等待開始",dot:"gray"};
  return {key:"registration",label:"報名中",dot:"green"};
}
function fastLobbyHash(value){
  const str=String(value==null?"":value);let h=2166136261;
  for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619);}
  return (h>>>0).toString(36);
}

function publicationValidationErrors(m){const e=[];if(!m.name||!m.name.trim()||m.name==="未命名賽事")e.push("賽事名稱未填寫");if(!m.date)e.push("活動日期未填寫");if(!m.location||!m.location.trim())e.push("活動地點未填寫");if(m.registrationEnabled){if(!m.registrationOpenAt)e.push("報名開放時間未設定");if(!m.registrationCloseAt)e.push("報名截止時間未設定");if(m.registrationOpenAt&&m.registrationCloseAt&&m.registrationCloseAt<=m.registrationOpenAt)e.push("報名截止時間必須晚於開放時間");if(!m.registrationCapacity||m.registrationCapacity<1)e.push("正取人數上限未設定");}return e;}
Object.assign(window.BXHDomainUtils||(window.BXHDomainUtils={}),{ensureTestName,scheduledTournamentStartMs,canonicalPublicTournamentPhase,publicTournamentRegistrationLocked,hunterRecordEventKey,hunterAchievementMatchKey,hunterAchievementHasExactMatchTime,hunterAchievementAwardLabel,hunterAchievementAwardMeta,operationsDate,snapToHalfHourValue,buildPublicTournamentSnapshot,roomStatusDescriptor,fastLobbyHash,publicationValidationErrors});

})();
