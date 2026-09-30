/* BXH CALL 2.0 Phase B2 — Firebase Messaging Service Worker */
'use strict';

function safe(v,n=300){return String(v||'').slice(0,n);}
function pushUrl(data){
  try{
    const raw=safe(data?.url||'https://arena.bxh.com.tw/',240);
    const u=new URL(raw,self.location.origin);
    return u.origin===self.location.origin?u.href:'https://arena.bxh.com.tw/';
  }catch{return 'https://arena.bxh.com.tw/';}
}

// Firebase recommends registering custom notification-click behavior before
// importing Messaging so the SDK cannot replace the app-specific handler.
self.addEventListener('notificationclick',event=>{
  event.stopImmediatePropagation?.();
  event.notification.close();
  const data=event.notification?.data||{};
  const url=pushUrl(data);
  event.waitUntil((async()=>{
    const list=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of list){
      try{
        if(new URL(client.url).origin===self.location.origin){
          try{client.postMessage({type:'BXH_CALL_PUSH_CLICK',data});}catch{}
          return client.focus();
        }
      }catch{}
    }
    return self.clients.openWindow(url);
  })());
});

importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:'AIzaSyBdJhRYtsEKteWRTvjVmz01zP82H4AjmBM',
  authDomain:'bxh-arena.firebaseapp.com',
  projectId:'bxh-arena',
  storageBucket:'bxh-arena.firebasestorage.app',
  messagingSenderId:'87261141693',
  appId:'1:87261141693:web:acfaff5d0d53879e5335d4',
  measurementId:'G-4SX451ETV5'
});

const messaging=firebase.messaging();

messaging.onBackgroundMessage(payload=>{
  const data=payload?.data||{};
  const kind=safe(data.kind||'court-call',40);
  const registrationReminder=kind==='registration-reminder';
  const title=safe(data.title||(registrationReminder?'BXH 報名提醒':'BXH CALL'),120);
  const body=safe(data.body||(registrationReminder?'你預約提醒的賽事即將開放報名。':'裁判已發出叫號通知。'),300);
  const tag=(registrationReminder
    ? ['bxh-registration',data.eventId,data.openAt,data.reminderMinutes]
    : ['bxh-call',kind,data.code,data.matchId,data.sequence]
  ).filter(Boolean).join(':').slice(0,220);
  return self.registration.showNotification(title,{
    body,
    icon:'/assets/icons/bxh-gold-icon-192.png?v=20260918',
    badge:'/assets/icons/bxh-gold-icon-192.png?v=20260918',
    tag:tag||(registrationReminder?'bxh-registration':'bxh-call'),
    renotify:false,
    vibrate:[180,90,180],
    data:{
      url:pushUrl(data),
      kind,
      eventId:safe(data.eventId,120),
      openAt:safe(data.openAt,40),
      reminderMinutes:safe(data.reminderMinutes,8),
      code:safe(data.code,32),
      matchId:safe(data.matchId,120),
      station:safe(data.station,16),
      sequence:safe(data.sequence,24)
    },
    actions:[{action:'open-arena',title:'開啟 ARENA'}]
  });
});

self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
