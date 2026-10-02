(function(){
// ==== Unified registration status enum (spec section 4.1) ====
// The ENTIRE system uses only these six values as the canonical registration
// status. Nothing else is ever written or compared against going forward.
const REGISTRATION_STATUS_VALUES = ["draft","scheduled","open","full","closed","cancelled"];
// REGISTRATION_STATUS_LABELS is declared once, earlier in the file (used by
// both the admin registration-settings panel and the player-facing find
// events tab), so both sides always show identical wording.
// Backward-compat map for older/synonym values that may already exist in
// previously-written data — old tournaments must never disappear just
// because an earlier version of this app (or a manual data edit) used a
// different string. "started" was Phase 1's placeholder meaning "bracket
// has been drawn", which functionally means registration is no longer open.
const REGISTRATION_STATUS_COMPAT = { upcoming:"scheduled", openingSoon:"scheduled", started:"closed" };
function normalizeRegistrationStatusValue(raw){
  if(REGISTRATION_STATUS_VALUES.includes(raw)) return raw;
  if(raw && REGISTRATION_STATUS_COMPAT[raw]) return REGISTRATION_STATUS_COMPAT[raw];
  return null;
}

// ==== Unified time parsing (spec section 4.2) ====
// Must never assume every timestamp arrives as a Firestore Timestamp object —
// this app stores registration times as plain epoch-millisecond numbers, but
// this function tolerates every shape defensively so a type mismatch can
// never silently break a whole query result. Returns epoch ms or null —
// never throws.
function normalizeDateTime(value){
  if(value==null || value==="") return null;
  if(typeof value==="number") return isFinite(value) ? value : null;
  if(value instanceof Date) return value.getTime();
  if(typeof value==="object"){
    try{
      if(typeof value.toMillis==="function") return value.toMillis();
      if(typeof value.seconds==="number") return value.seconds*1000 + Math.round((value.nanoseconds||0)/1e6);
    }catch(e){ console.warn("[normalizeDateTime] failed to parse Timestamp-like value", value, e); return null; }
    return null;
  }
  if(typeof value==="string"){
    const parsed = Date.parse(value);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

// ==== Unified registration-status classifier (spec section 4.3) ====
// THE single function that decides a tournament's effective registration
// status, in the exact priority order specified: cancelled > closed > full >
// scheduled > open > fallback-to-stored-value. Never compares a raw stored
// string directly against a hardcoded expectation elsewhere in the codebase —
// every caller that needs "is this open/scheduled/etc" goes through here.
function registrationCountdownText(openAt,now=Date.now()){
 const remaining=Math.max(0,Math.ceil((Number(openAt)-now)/1000));if(!Number.isFinite(remaining))return '開放時間待確認';
 if(!remaining)return '時間已到，確認報名狀態中…';
 const days=Math.floor(remaining/86400),hours=Math.floor(remaining%86400/3600),minutes=Math.floor(remaining%3600/60),seconds=remaining%60;
 return (days?days+'天 ':'')+[hours,minutes,seconds].map(x=>String(x).padStart(2,'0')).join(':');
}
function registrationCountdownUrgency(openAt,now=Date.now()){
 const remaining=Number(openAt)-now;
 return remaining>0&&remaining<=60000?'urgent':remaining>0&&remaining<=300000?'soon':'';
}

Object.assign(window.BXHRegistrationUtils||(window.BXHRegistrationUtils={}),{REGISTRATION_STATUS_VALUES,REGISTRATION_STATUS_COMPAT,normalizeRegistrationStatusValue,normalizeDateTime,registrationCountdownText,registrationCountdownUrgency});

})();
