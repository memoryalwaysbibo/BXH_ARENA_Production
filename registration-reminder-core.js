'use strict';

const ALLOWED_REMINDER_MINUTES=new Set([60,30,10,0]);
const GRACE_MS=5*60*1000;

function millis(value){
  if(value==null) return NaN;
  if(typeof value==='number') return Number.isFinite(value)?value:NaN;
  if(value instanceof Date) return value.getTime();
  if(typeof value?.toMillis==='function') return Number(value.toMillis());
  if(Number.isFinite(Number(value?.seconds))) return Number(value.seconds)*1000;
  const parsed=Date.parse(String(value));
  return Number.isFinite(parsed)?parsed:NaN;
}

function reminderMinutes(value){
  const n=Number(value);
  return ALLOWED_REMINDER_MINUTES.has(n)?n:null;
}

function dedupeKey({uid,eventId,registrationOpenAt,reminderMinutes:minutes}){
  const openMs=millis(registrationOpenAt);
  const mins=reminderMinutes(minutes);
  if(!uid||!eventId||!Number.isFinite(openMs)||mins==null) return '';
  return ['registration-reminder',uid,eventId,openMs,mins].join(':');
}

function eligibility(pref,event,now=Date.now()){
  if(!pref?.enabled) return {eligible:false,reason:'disabled'};
  if(!pref?.uid||!pref?.eventId) return {eligible:false,reason:'invalid-preference'};
  if(String(pref.eventId)!==String(event?.id||event?.eventId||'')) return {eligible:false,reason:'event-mismatch'};

  const mins=reminderMinutes(pref.reminderMinutes);
  if(mins==null) return {eligible:false,reason:'invalid-reminder-minutes'};

  const prefOpen=millis(pref.registrationOpenAt);
  const eventOpen=millis(event?.registrationOpenAt);
  if(!Number.isFinite(prefOpen)||!Number.isFinite(eventOpen)) return {eligible:false,reason:'invalid-open-time'};
  if(prefOpen!==eventOpen) return {eligible:false,reason:'stale-open-time'};

  if(millis(pref.sentForOpenAt)===eventOpen) return {eligible:false,reason:'already-sent'};

  const dueAt=eventOpen-mins*60*1000;
  const nowMs=millis(now);
  if(!Number.isFinite(nowMs)||nowMs<dueAt) return {eligible:false,reason:'not-due'};
  if(nowMs>eventOpen+GRACE_MS) return {eligible:false,reason:'expired'};

  return {
    eligible:true,
    reason:'due',
    dueAt,
    openAt:eventOpen,
    reminderMinutes:mins,
    dedupeKey:dedupeKey({uid:pref.uid,eventId:pref.eventId,registrationOpenAt:eventOpen,reminderMinutes:mins})
  };
}

function payload(pref,event){
  const check=eligibility(pref,event,event.registrationOpenAt);
  const openMs=millis(event?.registrationOpenAt);
  const mins=reminderMinutes(pref?.reminderMinutes);
  if(!pref?.uid||!pref?.eventId||!Number.isFinite(openMs)||mins==null) throw Error('invalid-reminder');
  const name=String(event?.name||event?.title||'你關注的賽事').slice(0,80);
  const body=mins===0
    ? name+' 已開放報名。'
    : name+' 將在 '+mins+' 分鐘後開放報名。';
  return {
    kind:'registration-reminder',
    title:'BXH 報名提醒',
    body,
    eventId:String(pref.eventId),
    openAt:new Date(openMs).toISOString(),
    reminderMinutes:String(mins),
    url:String(event?.registrationUrl||event?.url||'/')
  };
}

module.exports={ALLOWED_REMINDER_MINUTES,GRACE_MS,millis,reminderMinutes,dedupeKey,eligibility,payload};
