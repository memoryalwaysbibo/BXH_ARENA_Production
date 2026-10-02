function isValidRoomCode(code){
  return typeof code==="string" && /^BXH-[A-Z0-9]{6}$/.test(code);
}
const TOURNAMENT_ENTRY_TYPES = ["event","register","watch","bracket","result"];
function normalizeTournamentEntryType(raw){
  const value=String(raw||"").toLowerCase();
  return TOURNAMENT_ENTRY_TYPES.includes(value)?value:"event";
}
function buildTournamentEntryUrl(code, entry="event"){
  try{
    const normalized=normalizeRoomCodeInput(code);
    if(!isValidRoomCode(normalized)) return "";
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("code", normalized);
    url.searchParams.set("entry", normalizeTournamentEntryType(entry));
    return url.toString();
  }catch(e){ return ""; }
}
function getTournamentEntryFromUrl(){
  try{
    const params=new URLSearchParams(window.location.search);
    const canonicalCode=normalizeRoomCodeInput(params.get("code")||"");
    if(canonicalCode) return {code:canonicalCode,entry:normalizeTournamentEntryType(params.get("entry"))};
    const legacyRegistration=normalizeRoomCodeInput(params.get("register")||"");
    if(legacyRegistration) return {code:legacyRegistration,entry:"register",legacy:true};
    const legacyWatch=normalizeRoomCodeInput(params.get("watch")||"");
    if(legacyWatch) return {code:legacyWatch,entry:"watch",legacy:true};
  }catch(e){}
  return null;
}
function clearTournamentEntryFromUrl(){
  try{
    if(typeof window==="undefined" || !window.history || !window.history.replaceState) return;
    const url=new URL(window.location.href);
    ["code","entry","watch","register"].forEach(k=>url.searchParams.delete(k));
    window.history.replaceState(null,"",url.toString());
  }catch(e){}
}
function replaceTournamentEntryInUrl(code,entry){
  try{
    if(!window.history||!window.history.replaceState) return;
    const url=buildTournamentEntryUrl(code,entry);
    if(url) window.history.replaceState(null,"",url);
  }catch(e){}
}
function buildWatchUrl(code){
  return buildTournamentEntryUrl(code,"watch");
}
function getWatchParamFromUrl(){
  const entry=getTournamentEntryFromUrl();
  return entry&&["watch","bracket","result"].includes(entry.entry)?entry.code:null;
}
function clearWatchParamFromUrl(){
  clearTournamentEntryFromUrl();
}

Object.assign(window.BXHTournamentEntryUtils||(window.BXHTournamentEntryUtils={}),{isValidRoomCode,normalizeTournamentEntryType,buildTournamentEntryUrl,getTournamentEntryFromUrl,clearTournamentEntryFromUrl,replaceTournamentEntryInUrl,buildWatchUrl,getWatchParamFromUrl,clearWatchParamFromUrl});
