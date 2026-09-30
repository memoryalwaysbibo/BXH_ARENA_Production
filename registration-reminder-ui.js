/* BXH registration reminder UI bridge
   Progressive enhancement only: never changes registration eligibility. */
'use strict';
(function registrationReminderUi(){
  const ALLOWED=[60,30,10,0];
  let installed=false,retryTimer=null;

  function eventId(t){return String(t?.id||t?.eventId||t?.code||'');}
  function openMs(t){
    const v=t?.registrationOpenAt;
    if(typeof v==='number'&&Number.isFinite(v)) return v;
    try{if(typeof v?.toMillis==='function')return Number(v.toMillis());}catch{}
    if(Number.isFinite(Number(v?.seconds)))return Number(v.seconds)*1000;
    const p=Date.parse(String(v||''));return Number.isFinite(p)?p:NaN;
  }
  function key(t){const id=eventId(t);return id?'bxh.registration.reminder:'+id:'';}
  function load(t){
    try{
      const x=JSON.parse(localStorage.getItem(key(t))||'null');
      return x&&ALLOWED.includes(Number(x.reminderMinutes))?x:null;
    }catch{return null;}
  }
  function saveLocal(t,value){
    const k=key(t);if(!k)return;
    try{localStorage.setItem(k,JSON.stringify(value));}catch{}
  }
  async function persist(t,enabled,minutes=60){
    const id=eventId(t),registrationOpenAt=openMs(t);
    if(!id||!Number.isFinite(registrationOpenAt))throw Error('invalid-event');
    const reminderMinutes=ALLOWED.includes(Number(minutes))?Number(minutes):60;
    const pref={eventId:id,enabled:!!enabled,reminderMinutes,registrationOpenAt,updatedAt:Date.now()};
    if(enabled){
      if(typeof courtCallEnableBackgroundNotifications==='function'){
        const ok=await courtCallEnableBackgroundNotifications();
        if(!ok)throw Error('notification-unavailable');
      }
    }
    if(window.engagementService&&typeof window.engagementService.registrationReminder==='function'){
      const result=await window.engagementService.registrationReminder({action:'upsert',...pref});
      if(!result?.ok)throw Error('reminder-save-failed');
    }else{
      // Backend bridge is intentionally mandatory for server delivery.
      // Keep local intent so the UI can recover after the backend is deployed.
      saveLocal(t,{...pref,pendingSync:true});
      return {...pref,pendingSync:true};
    }
    saveLocal(t,{...pref,pendingSync:false});
    return {...pref,pendingSync:false};
  }
  function install(){
    if(installed)return true;
    window.BxhRegistrationReminder={ALLOWED,eventId,openMs,key,load,persist};
    installed=true;return true;
  }
  function boot(){
    if(install())return;
    retryTimer=setInterval(()=>{if(install()){clearInterval(retryTimer);retryTimer=null;}},100);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();