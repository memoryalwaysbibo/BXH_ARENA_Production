(function(){
// Core P1F — pure account presentation/filter utilities.
// No DOM, Firebase, storage, or mutable app-state access.

function passwordStrengthLabel(pw){
  if(!pw) return "";
  let score = 0;
  if(pw.length>=6) score++;
  if(pw.length>=10) score++;
  if(/[0-9]/.test(pw) && /[a-zA-Z]/.test(pw)) score++;
  if(/[^a-zA-Z0-9]/.test(pw)) score++;
  return ["非常弱","弱","中等","強","非常強"][score] || "弱";
}

function accountActivityStatus(user, now=Date.now()){
  const ts=accountTimestampValue(user&&user.lastLoginAt);
  if(!ts) return {key:"never",label:"從未登入",badge:"badge-metal"};
  const age=Math.max(0,now-ts);
  if(age<=24*60*60*1000) return {key:"daily",label:"今日活躍",badge:"badge-neon"};
  if(age<=7*24*60*60*1000) return {key:"weekly",label:"本週活躍",badge:"badge-gold"};
  return {key:"stale",label:"逾 7 天",badge:"badge-metal"};
}

function accountActivitySummary(users, now=Date.now()){
  const enabled=(users||[]).filter(u=>u&&u.active!==false);
  const daily=enabled.filter(u=>{ const ts=accountTimestampValue(u.lastLoginAt); return ts>0&&now-ts<=24*60*60*1000; }).length;
  const weekly=enabled.filter(u=>{ const ts=accountTimestampValue(u.lastLoginAt); return ts>0&&now-ts<=7*24*60*60*1000; }).length;
  return {total:(users||[]).length,enabled:enabled.length,daily,weekly,testers:enabled.filter(u=>(u.role==="tester"||u.isTestAccount===true)).length};
}

function accountTimestampValue(value){
  if(value&&typeof value.toMillis==="function") return Number(value.toMillis())||0;
  if(value instanceof Date) return value.getTime()||0;
  const numeric=Number(value);
  if(Number.isFinite(numeric)&&numeric>0) return numeric;
  const parsed=Date.parse(value||"");
  return Number.isFinite(parsed)?parsed:0;
}

function formatAccountTimestamp(value){
  const ts=accountTimestampValue(value);
  return ts?new Date(ts).toLocaleString("zh-TW"):"—";
}

function accountPrimaryName(user){
  return String((user&&(user.realName||user.displayName||user.gameId||user.nickname||user.email))||"未命名帳號");
}

function accountGameId(user){
  if(!user) return "";
  return String(user.gameId||user.nickname||((user.displayName&&user.displayName!==user.realName)?user.displayName:"")||"");
}

function accountRoleMatches(user,filter){
  if(filter==="all") return true;
  if(filter==="management") return user.role==="super_admin"||user.role==="admin";
  if(filter==="partner_organizer") return user.partnerOrganizer?.status==="active" && (user.partnerOrganizer.expiresAt==null||Number(user.partnerOrganizer.expiresAt)>Date.now());
  if(filter==="tester") return user.role==="tester"||user.isTestAccount===true;
  if(filter==="player") return user.role==="player"&&user.isTestAccount!==true;
  return user.role===filter;
}

function accountRoleCount(users,filter){
  return (users||[]).filter(user=>accountRoleMatches(user,filter)).length;
}

function accountMatchesActivity(user,filter,now=Date.now()){
  if(filter==="all") return true;
  const ts=accountTimestampValue(user&&user.lastLoginAt);
  if(filter==="never") return !ts;
  if(!ts) return false;
  const age=Math.max(0,now-ts);
  if(filter==="daily") return age<=24*60*60*1000;
  if(filter==="weekly") return age<=7*24*60*60*1000;
  if(filter==="stale") return age>7*24*60*60*1000;
  return true;
}

Object.assign(window.BXHAccountUtils||(window.BXHAccountUtils={}),{passwordStrengthLabel,accountActivityStatus,accountActivitySummary,accountTimestampValue,formatAccountTimestamp,accountPrimaryName,accountGameId,accountRoleMatches,accountRoleCount,accountMatchesActivity});

})();
