'use strict';
function millis(value){
  if(value?.toMillis)return value.toMillis();
  if(value&&typeof value==='object'&&Number.isFinite(value.seconds))return value.seconds*1000;
  if(typeof value==='number')return value;
  return Date.parse(value);
}
function decision(event,preference,registration,now=Date.now()){
  const openAt=millis(event?.registrationOpenAt);
  if(!preference?.enabled)return {action:'skip'};
  if(!event||event.visibility!=='public'||event.registrationEnabled!==true||event.eventCancelled||['cancelled','closed','started'].includes(event.registrationStatus))return {action:'cancel'};
  if(['confirmed','waitlist','pending_draw'].includes(registration?.status))return {action:'cancel'};
  if(!Number.isFinite(openAt))return {action:'cancel'};
  const minutes=preference.minutesBefore;
  if(![0,10,30,60].includes(minutes))return {action:'cancel'};
  const dueAt=openAt-minutes*60000, key=`${openAt}:${minutes}`;
  if(preference.sentKey===key)return {action:'skip'};
  // Late jobs must not advertise a stale countdown or an already-closed event.
  if(now>=dueAt+5*60000)return {action:'expired',key};
  if(now<dueAt)return {action:'wait',dueAt,key};
  return {action:'send',dueAt,key,openAt,minutes};
}
module.exports={millis,decision};
