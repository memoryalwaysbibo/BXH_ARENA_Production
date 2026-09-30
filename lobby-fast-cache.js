(function(){
"use strict";
const KEY="bxh_lobby_public_cache_v1",SCHEMA=1,MAX_AGE_MS=6*60*60*1000,MAX_ITEMS=160;
function storage(){try{return window.localStorage}catch(e){return null}}
function sanitizeItem(t){
  if(!t||!t.code)return null;
  const out={};
  ["code","visibility","name","eventName","location","region","format","formatType","eventAuthority","ownerUid","tournamentPhase","registrationStatus","eventDate","date","startAt","registrationOpenAt","registrationCloseAt","updatedAt","confirmedCount","waitlistCount","capacity","bracketView"].forEach(k=>{if(t[k]!==undefined)out[k]=t[k]});
  return out;
}
function write(items){
  try{
    const st=storage();if(!st)return false;
    const safe=(Array.isArray(items)?items:[]).slice(0,MAX_ITEMS).map(sanitizeItem).filter(Boolean);
    st.setItem(KEY,JSON.stringify({schema:SCHEMA,savedAt:Date.now(),items:safe}));
    return true;
  }catch(e){return false}
}
function read(){
  try{
    const st=storage();if(!st)return null;
    const raw=st.getItem(KEY);if(!raw)return null;
    const d=JSON.parse(raw);if(!d||d.schema!==SCHEMA||!Array.isArray(d.items))return null;
    const age=Date.now()-Number(d.savedAt||0);if(age<0||age>MAX_AGE_MS)return null;
    return {items:d.items,savedAt:Number(d.savedAt||0),age};
  }catch(e){return null}
}
function clear(){try{const st=storage();if(st)st.removeItem(KEY)}catch(e){}}
window.BXHLobbyFastCache={read,write,clear,key:KEY,maxAgeMs:MAX_AGE_MS};
})();