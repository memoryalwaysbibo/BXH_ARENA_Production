'use strict';
// Cloud-backed preferences only: never display enabled before server confirmation.
const registrationReminders = {uid:'', loaded:false, busy:new Set(), items:new Map()};
async function registrationReminderLoad(){
  const uid=currentAuthUid();
  if(uid!==registrationReminders.uid){registrationReminders.uid=uid;registrationReminders.loaded=false;registrationReminders.items.clear();}
  if(!uid||registrationReminders.loaded||registrationReminders.loading)return;
  registrationReminders.loading=true;
  try{
    const result=await window.engagementService.registrationReminder({action:'list'});
    if(currentAuthUid()!==uid)return;
    if(!result.ok)throw Error('service-unavailable');
    registrationReminders.items=new Map((result.items||[]).map(x=>[x.code,x]));
    registrationReminders.loaded=true;
    renderPreservingScroll();
  }catch(e){console.warn('[registration reminder]',e);}
  finally{registrationReminders.loading=false;}
}
function registrationReminderHtml(t,loggedIn){
  if(!loggedIn||!registrationReminders.loaded||registrationReminders.uid!==currentAuthUid()||t.regStatus!=='scheduled'||lobbyMyRegistration(t.code))return '';
  const item=registrationReminders.items.get(t.code), enabled=item?.enabled===true, busy=registrationReminders.busy.has(t.code);
  return `<div class="registration-reminder"><button type="button" class="btn btn-ghost btn-sm" role="switch" aria-checked="${enabled}" data-reminder-code="${esc(t.code)}" ${busy?'disabled':''}>🔔 報名提醒：${enabled?'開啟':'關閉'}</button>${enabled?`<label>提醒時間 <select data-reminder-time="${esc(t.code)}" ${busy?'disabled':''}>${[60,30,10,0].map(m=>`<option value="${m}" ${item.minutesBefore===m?'selected':''}>${m?'開放前 '+m+' 分鐘':'開放當下'}</option>`).join('')}</select></label>`:''}</div>`;
}
async function registrationReminderSave(code,enabled,minutesBefore){
  if(registrationReminders.busy.has(code))return;
  const uid=currentAuthUid();if(!uid)return;
  registrationReminders.busy.add(code);
  try{
    if(enabled){
      if(!await courtCallEnableBackgroundNotifications())return;
      if(!courtCallPushRegistered()){showToast('推播尚未完成啟用，提醒設定未儲存',true);return;}
    }
    const result=await window.engagementService.registrationReminder({action:'set',code,enabled,minutesBefore});
    if(currentAuthUid()!==uid)return;
    if(!result.ok)throw Error('save-failed');
    registrationReminders.items.set(code,result.item);
    showToast(enabled?'已設定報名提醒':'已關閉報名提醒');
  }catch(e){showToast('提醒設定未儲存，請稍後重試',true);}
  finally{registrationReminders.busy.delete(code);renderPreservingScroll();}
}
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-reminder-code]');if(!button)return;
  const code=button.dataset.reminderCode,item=registrationReminders.items.get(code);
  registrationReminderSave(code,item?.enabled!==true,item?.minutesBefore??60);
});
document.addEventListener('change',event=>{
  const select=event.target.closest('[data-reminder-time]');if(select)registrationReminderSave(select.dataset.reminderTime,true,Number(select.value));
});
const registrationReminderBaseButtons=lobbyRegistrationButtons;
lobbyRegistrationButtons=function(t,loggedIn){
  if(window.engagementService?.registrationReminder)registrationReminderLoad();
  return registrationReminderBaseButtons(t,loggedIn)+registrationReminderHtml(t,loggedIn);
};
