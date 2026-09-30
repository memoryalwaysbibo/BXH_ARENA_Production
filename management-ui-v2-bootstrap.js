/* BXH ARENA Management UI V2 — safe bootstrap.
 * Activates only when explicit hosts exist. Otherwise V1 remains untouched.
 */
(function(global){
  "use strict";
  let adapterInstance=null;

  function byId(id){return document.getElementById(id);}
  function playerData(){
    try{
      if(typeof global.BXH_CURRENT_PLAYER==="object"&&global.BXH_CURRENT_PLAYER)return global.BXH_CURRENT_PLAYER;
      if(typeof global.userProfile==="object"&&global.userProfile)return global.userProfile;
    }catch(_){}
    return null;
  }
  function enableV1(){
    adapterInstance?.destroy?.();
    adapterInstance=null;
    document.documentElement.dataset.bxhManagementUi="v1";
    return {ok:true};
  }
  function enableV2(){
    const adapter=global.BXH_MANAGEMENT_UI_V2_ADAPTER,host=byId("bxh-management-v2-nav");
    if(!adapter||!host)return {ok:false,reason:"v2-host-unavailable"};
    adapterInstance?.destroy?.();
    const result=adapter.mount({host,root:document});
    if(!result?.ok){host.replaceChildren();return result||{ok:false};}
    adapterInstance=result;
    document.documentElement.dataset.bxhManagementUi="v2";
    return result;
  }
  function applyPreference(){
    const pref=global.BXH_INTERFACE_PREFERENCE;
    if(!pref)return enableV1();
    return pref.apply({enableV1,enableV2});
  }
  function mountInterfaceEntry(){
    const host=byId("bxh-my-interface-entry");
    if(!host||!global.BXH_MY_INTERFACE)return false;
    if(host.dataset.bxhMounted==="1")return true;
    host.dataset.bxhMounted="1";
    host.addEventListener("click",e=>{e.preventDefault();global.BXH_MY_INTERFACE.open();});
    return true;
  }
  function mountIdentity(){
    const host=byId("bxh-player-identity");
    const data=playerData();
    if(!host||!data||!global.BXH_PLAYER_IDENTITY)return false;
    return global.BXH_PLAYER_IDENTITY.render(host,data,{layout:"stacked"});
  }
  function boot(){
    mountInterfaceEntry();
    mountIdentity();
    applyPreference();
  }

  global.addEventListener("bxh:interface-change",applyPreference);
  global.addEventListener("bxh:profile-updated",mountIdentity);
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else queueMicrotask(boot);

  global.BXH_MANAGEMENT_UI_V2_BOOTSTRAP=Object.freeze({boot,applyPreference,enableV1,enableV2,mountIdentity,mountInterfaceEntry});
})(window);
