(function(){
// Core P1G — low-coupling labels/date/time formatting helpers.
// Pure formatting only: no DOM, Firebase, storage, or mutable app state.

function roleDisplayLabel(role){
  return { super_admin:"最高管理員", admin:"管理員", staff:"工作人員", tester:"封測管理員", player:"玩家", viewer:"觀眾" }[role] || role;
}

function taipeiDateFromTimestamp(ts){
  if(!ts) return "";
  const d = new Date(ts + 8*3600*1000);
  return d.toISOString().slice(0,10);
}

function recordFilterDate(r){
  if(r.date) return r.date;
  return taipeiDateFromTimestamp(r.completedAt || r.archivedAt) || "";
}

function eventStaffDutyLabel(value){return ({event_assistant:"活動協助",checkin:"報到",referee:"裁判",head_referee:"主裁"})[value]||value;}

function formatLadderDate(ts){
  if(!ts) return "—";
  try{ return new Date(ts).toLocaleDateString("zh-TW",{year:"numeric",month:"2-digit",day:"2-digit"}); }catch(e){ return "—"; }
}

function mailboxDate(value){
  if(!value)return '—';
  try{return new Date(value).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});}catch(e){return '—';}
}

function moodTime(ms){
 try{return new Date(Number(ms)).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});}catch(e){return '';}
}

function smartCallEtaText(sec){
  if(sec==null) return "—"; if(sec<=30) return "即將上場";
  const min=Math.max(1,Math.round(sec/60)); const lo=Math.max(1,min-1), hi=min+1; return lo===hi?`約 ${min} 分鐘`:`約 ${lo}～${hi} 分鐘`;
}

function registrationStatusLabel(v){
  return ({open:"開放報名",scheduled:"即將開放",full:"已額滿",closed:"已截止",started:"已開賽",cancelled:"已取消"})[v] || (v||"未設定");
}

function quickDecisionFailureMessage(reason){
  const map={"already-completed":"本場比賽已完成判定。","missing-players":"選手資料不存在，無法確認結果。","no-selection":"尚未選擇獲勝方。","invalid-selection":"選擇的選手不屬於本場比賽。","not-found":"找不到此場比賽。"};
  return map[reason] || "賽事資料已變更或不符合判定條件，請重新確認。";
}

function matchSequenceLabel(number){
  return number==null ? "" : "第"+number+"場";
}

function refereeNamesLabel(names){
  return names.length ? names.join("、") : "未指定";
}

Object.assign(window.BXHFormatUtils||(window.BXHFormatUtils={}),{roleDisplayLabel,taipeiDateFromTimestamp,recordFilterDate,eventStaffDutyLabel,formatLadderDate,mailboxDate,moodTime,smartCallEtaText,registrationStatusLabel,quickDecisionFailureMessage,matchSequenceLabel,refereeNamesLabel});

})();
