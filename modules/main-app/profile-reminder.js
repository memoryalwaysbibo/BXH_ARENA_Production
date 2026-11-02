(function(){
"use strict";
// Optional home-screen reminder. Never writes a profile or gates registration.
function create(options={}){
  const storageKey="bxh_profile_reminder_deferred_v1";
  let token="",owner="",ready=false,deferred=false;
  function read(){try{return options.storage()?.getItem(storageKey)||"";}catch(_){return "";}}
  function clear(){try{options.storage()?.removeItem(storageKey);}catch(_){}}
  function syncAuth(user){
    const uid=String(user?.uid||"");
    const next=uid?JSON.stringify([uid,String(user.metadata?.lastSignInTime||"restored")]):"";
    const changed=next!==token;
    if(changed){
      if(token)clear();
      token=next;owner=uid;deferred=!!next&&read()===next;
    }
    ready=false;
    return changed;
  }
  function acceptProfile(uid){ready=!!owner&&uid===owner;}
  function missing(profile){
    if(!profile)return [];
    const fields=[];
    if(!String(profile.phone||"").trim())fields.push("電話");
    if(!String(options.gameId(profile)||"").trim())fields.push("ARENA 角色名稱");
    return fields;
  }
  function shouldPrompt(uid,profile){
    return ready&&!!token&&owner===uid&&profile?.active===true
      &&(!profile.uid||profile.uid===uid)&&!deferred&&missing(profile).length>0;
  }
  function defer(){
    if(!ready||!token)return;
    deferred=true;
    try{options.storage()?.setItem(storageKey,token);}catch(_){}
  }
  return {syncAuth,acceptProfile,missing,shouldPrompt,defer,session:()=>token};
}
window.BXHProfileReminder={create};
})();
