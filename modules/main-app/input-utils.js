(function(){
// Core P1H — pure input normalization and date/tournament value helpers.
// No DOM, Firebase, storage, or mutable app-state access.

function normalizeRoomCodeInput(raw){
  let code = String(raw||"").trim().toUpperCase();
  if(code && !code.startsWith("BXH-") && /^[A-Z0-9]{6}$/.test(code)) code = "BXH-"+code;
  return code;
}

function normalizeLoginEmail(value){
  const raw=String(value||"").trim().toLowerCase();
  if(!raw) return "";
  return raw.includes("@")?raw:raw+"@gmail.com";
}

function loginIdentifierDisplayValue(value){
  const normalized=normalizeLoginEmail(value);
  return normalized.endsWith("@gmail.com")?normalized.slice(0,-10):normalized;
}

function normalizeAuthEmailForMatch(value){
  return normalizeLoginEmail(value);
}

function epochToDatetimeLocal(ts){
  if(!ts) return "";
  const d = new Date(ts);
  const pad = n=>String(n).padStart(2,"0");
  return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())+"T"+pad(d.getHours())+":"+pad(d.getMinutes());
}

function datetimeLocalToEpoch(str){
  if(!str) return null;
  const t = new Date(str).getTime();
  return isNaN(t) ? null : t;
}

function communityDateTimeValue(ms){
  if(!ms) return "";
  const d=new Date(Number(ms));
  if(isNaN(d.getTime())) return "";
  const local=new Date(d.getTime()-d.getTimezoneOffset()*60000);
  return local.toISOString().slice(0,16);
}

function formatTournamentDetailDateTime(value){
  if(!value) return "—";
  const d=new Date(value);
  if(!Number.isFinite(d.getTime())) return "—";
  try{
    const parts=new Intl.DateTimeFormat("zh-TW",{timeZone:"Asia/Taipei",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(d);
    const get=type=>(parts.find(p=>p.type===type)||{}).value||"";
    return get("month")+"/"+get("day")+" "+get("hour")+":"+get("minute");
  }catch(e){
    const pad=n=>String(n).padStart(2,"0");
    return pad(d.getMonth()+1)+"/"+pad(d.getDate())+" "+pad(d.getHours())+":"+pad(d.getMinutes());
  }
}

function tournamentBattleMode(t){
  return (t&&((t.battleMode)||(t.parsedData&&t.parsedData.meta&&t.parsedData.meta.battleMode)))==="team"?"team":"individual";
}

function tournamentTeamSize(t){
  return Math.max(3,Number(t&&((t.teamSize)||(t.parsedData&&t.parsedData.meta&&t.parsedData.meta.teamSize)))||3);
}

Object.assign(window.BXHInputUtils||(window.BXHInputUtils={}),{normalizeRoomCodeInput,normalizeLoginEmail,loginIdentifierDisplayValue,normalizeAuthEmailForMatch,epochToDatetimeLocal,datetimeLocalToEpoch,communityDateTimeValue,formatTournamentDetailDateTime,tournamentBattleMode,tournamentTeamSize});

})();
