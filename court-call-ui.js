/* v14.2.0 — BXH CALL 2.0 Phase B2.
   Phase A: foreground global call overlay + one-match self-service PASS + referee/opponent sync.
   Phase B1: browser background notifications while ARENA remains loaded.
   Phase B2: Firebase Web Push + Service Worker for lock-screen / app-closed delivery. */
'use strict';

let courtCallCache=new Map(),courtCallTimer=null,courtCallIdentity='';
let courtCallPlayerCodes=[],courtCallDiscoveryAt=0,courtCallDiscoveryBusy=false;
const courtCallDelayDismissed=new Set();
const courtCallSystemNotifySeen=new Set();
let courtCallPushBusy=false,courtCallPushSyncAt=0,courtCallPushError='',courtCallServiceWorkerListenerBound=false;
let courtCallPushTestBusy=false,courtCallPushTestResult='',courtCallPushConfigMode='unknown';
const COURT_CALL_PUSH_REFRESH_MS=15*60*1000;
const COURT_CALL_FIREBASE_SDK='10.13.0';

function courtCallNotificationPermission(){
 try{
  if(typeof window==='undefined'||!('Notification' in window))return 'unsupported';
  return Notification.permission||'default';
 }catch{return 'unsupported';}
}

function courtCallPushStorageKey(){
 const uid=courtCallUserKey();
 return uid?'bxh.call.push.token:'+uid:'';
}
function courtCallLoadPushToken(){
 const key=courtCallPushStorageKey();if(!key)return '';
 try{return String(localStorage.getItem(key)||'');}catch{return '';}
}
function courtCallSavePushToken(token){
 const key=courtCallPushStorageKey();if(!key)return;
 try{localStorage.setItem(key,String(token||''));}catch{}
}
function courtCallPushRegistered(){return !!courtCallLoadPushToken();}
function courtCallPushSupported(){
 return typeof window!=='undefined'&&'serviceWorker' in navigator&&'PushManager' in window&&courtCallNotificationPermission()!=='unsupported';
}
function courtCallIsIos(){
 try{return /iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);}catch{return false;}
}
function courtCallIsStandalone(){
 try{return window.matchMedia?.('(display-mode: standalone)')?.matches===true||navigator.standalone===true;}catch{return false;}
}

function courtCallBindServiceWorkerMessages(){
 if(courtCallServiceWorkerListenerBound||typeof navigator==='undefined'||!navigator.serviceWorker)return;
 courtCallServiceWorkerListenerBound=true;
 navigator.serviceWorker.addEventListener('message',event=>{
  const message=event?.data||{};
  if(message.type!=='BXH_CALL_PUSH_CLICK')return;
  const code=String(message.data?.code||'').toUpperCase();
  if(/^BXH-[A-Z0-9]{4,16}$/.test(code)&&!courtCallPlayerCodes.includes(code)){
   courtCallPlayerCodes.unshift(code);
   courtCallPlayerCodes=courtCallPlayerCodes.slice(0,10);
  }
  courtCallDiscoveryAt=0;
  setTimeout(async()=>{
   try{
    if(code&&courtCallUserKey())await loadCourtCalls(code);
    else await discoverCourtCallPlayerCodes(true);
   }catch{}
   syncCourtCallGlobalOverlay();
   try{renderPreservingScroll();}catch{}
  },0);
 });
}
courtCallBindServiceWorkerMessages();

function courtCallNotificationHint(){
 const p=courtCallNotificationPermission();
 if(p==='denied')return '通知：瀏覽器已封鎖，請到網站權限重新開啟';
 if(p==='unsupported')return '通知：此瀏覽器不支援';
 if(p==='default')return '通知：尚未啟用';
 if(courtCallPushRegistered())return courtCallPushConfigMode==='default'?'鎖屏／離開 ARENA 推播：已啟用（預設 Web Push 金鑰）':'鎖屏／離開 ARENA 推播：已啟用';
 if(courtCallIsIos()&&!courtCallIsStandalone())return 'iPhone 鎖屏推播：請先將 ARENA 加入主畫面後再啟用';
 if(courtCallPushError)return '鎖屏推播：'+courtCallPushError;
 return '分頁通知：已啟用｜鎖屏推播：待註冊';
}

async function courtCallLoadFirebaseConfig(){
 const r=await fetch('./PRODUCTION_FIREBASE_WEB_CONFIG.json?v=20260924',{cache:'no-store'});
 if(!r.ok)throw Error('push-config-unavailable');
 const cfg=await r.json();
 if(!cfg||cfg.projectId!=='bxh-arena'||!cfg.appId||!cfg.messagingSenderId)throw Error('push-config-invalid');
 courtCallPushConfigMode=String(cfg.vapidKey||'').trim()?'custom':'default';
 return cfg;
}

async function courtCallEnsurePushRegistration(force=false){
 const uid=courtCallUserKey();
 if(!uid||courtCallPushBusy)return courtCallPushRegistered();
 if(courtCallNotificationPermission()!=='granted'||!courtCallPushSupported())return false;
 if(courtCallIsIos()&&!courtCallIsStandalone()){
  courtCallPushError='iPhone 需加入主畫面';
  return false;
 }
 if(!force&&courtCallPushRegistered()&&Date.now()-courtCallPushSyncAt<COURT_CALL_PUSH_REFRESH_MS)return true;
 if(!window.engagementService||typeof window.engagementService.courtCallPush!=='function'){
  courtCallPushError='推播服務尚未載入';
  return false;
 }
 courtCallPushBusy=true;courtCallPushSyncAt=Date.now();courtCallPushError='';
 try{
  const reg=await navigator.serviceWorker.register('/firebase-messaging-sw.js',{scope:'/',updateViaCache:'none'});
  await navigator.serviceWorker.ready;
  const [cfg,appMod,msgMod]=await Promise.all([
   courtCallLoadFirebaseConfig(),
   import(`https://www.gstatic.com/firebasejs/${COURT_CALL_FIREBASE_SDK}/firebase-app.js`),
   import(`https://www.gstatic.com/firebasejs/${COURT_CALL_FIREBASE_SDK}/firebase-messaging.js`)
  ]);
  if(!(await msgMod.isSupported()))throw Error('push-not-supported');
  const app=appMod.getApps().length?appMod.getApp():appMod.initializeApp(cfg);
  const messaging=msgMod.getMessaging(app);
  const options={serviceWorkerRegistration:reg};
  const vapid=String(window.BXH_CALL_VAPID_PUBLIC_KEY||cfg.vapidKey||'').trim();
  if(vapid)options.vapidKey=vapid;
  const token=await msgMod.getToken(messaging,options);
  if(!token)throw Error('push-token-empty');
  const result=await window.engagementService.courtCallPush({
   action:'register',token,
   platform:String(navigator.platform||'').slice(0,80),
   userAgent:String(navigator.userAgent||'').slice(0,240)
  });
  if(!result?.ok)throw Error('push-register-failed');
  courtCallSavePushToken(token);
  courtCallPushError='';
  return true;
 }catch(e){
  const raw=String(e?.message||e);
  courtCallPushError=raw.includes('not-supported')?'裝置不支援':
   raw.includes('permission')?'權限未開啟':
   raw.includes('token')?'Token 建立失敗':'註冊失敗';
  console.warn('[BXH CALL push]',e);
  return false;
 }finally{
  courtCallPushBusy=false;
 }
}

async function courtCallEnableBackgroundNotifications(){
 const p=courtCallNotificationPermission();
 if(p==='unsupported'){showToast('此瀏覽器不支援系統通知',true);return false;}
 if(p==='denied'){showToast('通知已被瀏覽器封鎖，請到網站權限重新開啟',true);return false;}
 try{
  const granted=p==='granted'||await Notification.requestPermission()==='granted';
  if(!granted){showToast('尚未取得通知權限',true);return false;}
  const pushOk=await courtCallEnsurePushRegistration(true);
  if(pushOk){
   showToast('BXH CALL 鎖屏／離開 ARENA 推播已啟用');
  }else if(courtCallIsIos()&&!courtCallIsStandalone()){
   showToast('iPhone 請先將 BXH ARENA 加入主畫面，再開啟通知',true);
  }else{
   showToast('分頁通知已啟用；鎖屏推播尚未完成註冊',true);
   courtCallSystemNotify('bxh-call-enabled','BXH CALL 已啟用','ARENA 保持開啟時可收到背景通知。',true);
  }
  return true;
 }catch(e){
  console.warn('[BXH CALL notification permission]',e);
  showToast('無法啟用通知，請稍後重試',true);
  return false;
 }
}

function courtCallSystemNotify(tag,title,body,force=false){
 try{
  if(typeof document!=='undefined'&&!force&&document.visibilityState==='visible')return false;
  // When Web Push is registered, the Service Worker owns background delivery.
  // Avoid showing a second local notification from the polling fallback.
  if(!force&&courtCallPushRegistered())return false;
  if(courtCallNotificationPermission()!=='granted')return false;
  const dedupe=String(tag||title||body||'');
  if(dedupe&&courtCallSystemNotifySeen.has(dedupe))return false;
  const options={
   body:String(body||''),
   tag:dedupe||undefined,
   renotify:true,
   icon:'assets/icons/bxh-gold-icon-192.png?v=20260918',
   badge:'assets/icons/bxh-gold-icon-192.png?v=20260918'
  };
  const note=new Notification(String(title||'BXH CALL'),options);
  if(dedupe){
   courtCallSystemNotifySeen.add(dedupe);
   setTimeout(()=>courtCallSystemNotifySeen.delete(dedupe),60000);
  }
  note.onclick=()=>{
   try{window.focus();}catch{}
   try{note.close();}catch{}
  };
  return true;
 }catch{return false;}
}

function callPassProtected(s,m){
 return !!(m&&(m.callPass&&!m.completed||(s.matches||[]).some(x=>!x.completed&&x.skippedAt&&x.callPass?.waitFor.includes(m.id))));
}

function courtCallUserKey(){
 try{return String(currentAuthUid()||'');}catch{return '';}
}
function courtCallKnownCodesStorageKey(){return 'bxh.call.codes:'+courtCallUserKey();}
function courtCallLoadKnownCodes(){
 const uid=courtCallUserKey();if(!uid)return [];
 try{
  const raw=JSON.parse(localStorage.getItem(courtCallKnownCodesStorageKey())||'[]');
  return Array.isArray(raw)?raw.filter(x=>/^BXH-[A-Z0-9]{4,16}$/.test(String(x))).slice(0,8):[];
 }catch{return [];}
}
function courtCallSaveKnownCodes(codes){
 try{localStorage.setItem(courtCallKnownCodesStorageKey(),JSON.stringify([...new Set(codes)].slice(0,8)));}catch{}
}

function courtCallContext(code){
 const key=courtCallUserKey()+':'+engagementSessionEpoch;
 if(key!==courtCallIdentity){
  courtCallCache=new Map();
  courtCallIdentity=key;
  courtCallPlayerCodes=courtCallLoadKnownCodes();
  courtCallDiscoveryAt=0;
 }
 if(!courtCallCache.has(code)){
  let pending=null;
  try{pending=JSON.parse(sessionStorage.getItem('bxh.call:'+courtCallUserKey()+':'+code)||'null');}catch{}
  courtCallCache.set(code,{
   code,identity:key,storageKey:'bxh.call:'+courtCallUserKey()+':'+code,
   rows:[],prepares:[],used:false,error:'',pending,busy:false,loading:false,next:0
  });
 }
 return courtCallCache.get(code);
}

function courtCallError(e){
 const text=String(e?.message||e),messages={
  'players-not-linked':'雙方需以會員報名資料綁定帳號，不能只靠姓名叫號。',
  'insufficient-same-round':'同台同輪沒有下一場可遞延，請裁判現場處理；PASS 不會跨輪。',
  'pass-used':'本場賽事的 PASS 額度已使用。',
  'pass-unavailable':'此場已計分、已遞延或目前無法使用 PASS。',
  'not-current-match':'叫號場次已變更，請重新整理。',
  'stale-call':'裁判已再次叫號，請依最新通知重新回覆。',
  'resolve-pass-first':'請先處理既有 PASS 狀態。',
  'referee-required':'沒有此戰鬥台的操作權限。',
  'permission-denied':'沒有此賽事的叫號權限。',
  'account-inactive':'帳號目前無法使用。',
  'notify-cooldown':'請稍候 10 秒再叫號。',
  'prepare-cooldown':'下一場準備提醒剛送出，請稍候 30 秒再通知。',
  'not-next-match':'只能提前通知本台「下一場」選手。',
  'pass-pending':'已有一筆 PASS 等待處理。',
  'pass-not-pending':'PASS 已處理，請重新整理。',
  'event-not-live':'賽事尚未開始或已結束。'
 };
 for(const [k,v] of Object.entries(messages))if(text.includes(k))return v;
 return '操作尚未確認，請重試原操作或重新整理。';
}

function courtCallCommon(c){
 return `${c.error?`<p class="auth-error" role="alert">${esc(c.error)}</p>`:''}${c.pending?`<button class="btn btn-ghost" data-action="court-call-retry" data-code="${esc(c.code)}" ${c.busy?'disabled':''}>重試待確認操作</button>`:''}`;
}

function courtCallStationLabel(station){
 const n=Number(station||0);
 return n>0?`${n}號台`:'戰鬥台';
}

function courtCallPlayerResponseLabel(response){
 return ({unanswered:'未回覆',coming:'✅ 正在前往',pass:'⏸ PASS',ready:'✅ 已準備好'})[response]||response||'未回覆';
}

function courtCallPassUnavailableText(r,myPlayer){
 if(myPlayer?.passUsed||r?.passUnavailableReason==='pass-used')return '本賽事 PASS 已使用';
 switch(String(r?.passUnavailableReason||'')){
  case 'insufficient-same-round': return '後方沒有同台同輪可承接場次，本場無法使用 PASS';
  case 'not-current-match': return '目前不是此戰鬥台的執行場次，暫時無法使用 PASS';
  case 'pass-unavailable': return '此場目前無法遞延';
  default: return '目前無法使用 PASS';
 }
}

function courtCallPassButtonText(r,myPlayer){
 if(myPlayer?.passUsed||r?.passUnavailableReason==='pass-used')return 'PASS 已使用';
 if(r?.passUnavailableReason==='insufficient-same-round')return 'PASS｜後方無場次';
 if(r?.passUnavailableReason==='not-current-match')return 'PASS｜非目前場次';
 return 'PASS｜目前不可用';
}

function courtCallRow(c,r,ref){
 const attrs=`data-code="${esc(c.code)}" data-match="${esc(r.matchId)}" data-sequence="${r.sequence}"`;
 const disabled=c.busy||c.pending?'disabled':'';
 const myPlayer=r.players.find(p=>p.me);
 const participantAttr=myPlayer?` data-participant="${esc(myPlayer.id)}"`:'';
 const passText=r.pass?.status==='pending'?'舊版 PASS 待裁判核准':
  r.pass?.status==='approved'?'PASS 已接受，同台延後 1 場':
  r.pass?.status==='rejected'?'PASS 未核准':'';
 const playerStatus=r.players.map(p=>`<span class="court-call-person ${p.response==='unanswered'?'is-waiting':'is-replied'}"><b>${esc(p.name)}</b><span>${esc(courtCallPlayerResponseLabel(p.response))}</span></span>`).join('');
 const passAllowed=!!(myPlayer?.canPass&&r.canPass);
 const passHint=!passAllowed&&myPlayer?.response==='unanswered'&&!r.pass?.status?courtCallPassUnavailableText(r,myPlayer):'';
 const playerActions=!ref&&myPlayer?(
   myPlayer.response==='unanswered'&&!(r.pass?.status==='approved'&&r.waitingFor.length)
    ? `<button class="btn btn-primary" data-action="court-call-coming" ${attrs}${participantAttr} ${disabled}>OK｜正在前往</button><button class="btn btn-ghost" data-action="court-call-pass" ${attrs}${participantAttr} ${passAllowed?disabled:'disabled'}>${passAllowed?'PASS｜延後一場':esc(courtCallPassButtonText(r,myPlayer))}</button>`
    : (r.pass?.status==='approved'&&r.pass.requester&&!r.waitingFor.length?`<button class="btn btn-ghost" data-action="court-call-ready" ${attrs}${participantAttr} ${disabled}>我已準備好</button>`:'')
  ):'';
 const legacyActions=ref&&r.canApprove?`<button class="btn btn-primary" data-action="court-call-approve" ${attrs} ${disabled}>核准舊版 PASS</button><button class="btn btn-ghost" data-action="court-call-reject" ${attrs} ${disabled}>拒絕</button>`:'';
 return `<div class="panel court-call-row">
   <div class="court-call-row-head">
     <strong>${esc(courtCallStationLabel(r.station))}｜第 ${Number(r.round)+1} 輪</strong>
     <span class="court-call-time">叫號 ${esc(new Date(r.calledAt).toLocaleTimeString("zh-TW",{hour12:false}))}</span>
   </div>
   <div class="court-call-people">${playerStatus}</div>
   ${r.pass?`<p class="court-call-pass-state">${esc(passText)}${r.waitingFor.length?`｜前置場次尚餘 ${r.waitingFor.length} 場`:''}</p>`:''}
   ${legacyActions||playerActions?`<div class="btn-row court-call-actions-inline">${legacyActions}${playerActions}</div>`:''}
   ${passHint?`<p class="court-call-pass-hint">⚠️ ${esc(passHint)}</p>`:''}
 </div>`;
}

function courtCallLinkedUid(p){
 return String(p?.guardianUid||p?.registrationUid||p?.playerUid||'');
}
function courtCallParticipantMeta(p){
 if(!p)return {name:'待定',sub:'等待選手資料',linked:false,checked:false};
 const linked=!!courtCallLinkedUid(p);
 const code=String(p.playerId||p.displayCode||'').trim();
 const source=linked?'BXH 會員':'現場';
 const check=p.checkedIn===true?'已報到':(state.meta?.checkinRequired?'未報到':'免報到');
 return {
  name:String(p.name||'選手'),
  sub:[code||source,check].filter(Boolean).join(' · '),
  linked,checked:p.checkedIn===true
 };
}
function courtCallNextMatchFor(m){
 if(!m)return null;
 const court=state.courtAssignments?.['court'+Number(m.station||0)];
 if(!court?.nextMatchId)return null;
 const next=getMatch(court.nextMatchId);
 return next&&!next.completed&&next.a&&next.b?next:null;
}
function courtCallPrepareRow(c,matchId){
 return (c?.prepares||[]).find(x=>x.matchId===matchId)||null;
}
function renderCourtCallNextPrepare(m,c){
 const next=courtCallNextMatchFor(m);
 if(!next)return '';
 const a=(state.players||[]).find(p=>p.id===next.a?.playerId);
 const b=(state.players||[]).find(p=>p.id===next.b?.playerId);
 const am=courtCallParticipantMeta(a),bm=courtCallParticipantMeta(b);
 const prepare=courtCallPrepareRow(c,next.id);
 const linked=am.linked&&bm.linked;
 const disabled=c.busy||c.pending||!linked;
 const status=prepare
   ? '已通知 '+new Date(prepare.notifiedAt).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit',hour12:false})
   : linked?'尚未通知':'無法推播';
 const buttonText=prepare?'🔔 再次通知':'🔔 通知準備';
 return `<div class="court-call-next-compact" data-bxh-next-prepare="1">
   <div class="court-call-next-compact-head">
     <span class="court-call-next-compact-badge">下一場</span>
     <b>${esc(displayMatchLabel(next)||matchLabel(next))}</b>
     <span class="court-call-next-inline-status ${prepare?'is-sent':''}">${esc(status)}</span>
   </div>
   <div class="court-call-next-compact-body">
     <strong class="court-call-next-compact-player">${esc(am.name)}</strong>
     <span class="court-call-next-compact-vs">VS</span>
     <strong class="court-call-next-compact-player is-right">${esc(bm.name)}</strong>
     <button class="btn btn-ghost court-call-prepare-btn" data-action="court-call-prepare" data-code="${esc(c.code)}" data-match="${esc(next.id)}" ${disabled?'disabled':''}>${buttonText}</button>
   </div>
 </div>`;
}

function renderCourtCallReferee(m){
 if(!m||!m.a||!m.b||m.completed||!state.startedAt||!state.cloudCode||!canOperateStation(m.station))return '';
 const c=courtCallContext(state.cloudCode);
 return `<section class="panel court-call-referee-panel">
   <div class="panel-title">BXH CALL｜裁判叫號</div>
   <div class="court-call-current-actions">
     <div><b>目前場次｜${esc(displayMatchLabel(m)||matchLabel(m))}</b><p class="hint">正式叫號後，選手可回覆 OK／PASS。</p></div>
     <button class="btn btn-primary" data-action="court-call-notify" data-code="${esc(c.code)}" data-match="${esc(m.id)}" ${c.busy||c.pending?'disabled':''}>通知雙方選手上場</button>
   </div>
   ${renderCourtCallNextPrepare(m,c)}
   ${courtCallCommon(c)}
   ${c.rows.filter(r=>r.isReferee&&r.station===m.station).map(r=>courtCallRow(c,r,true)).join('')}
 </section>`;
}

function renderCourtCallHeaderControls(code,on=true){
 ensureCourtCallGlobalStyles();
 const np=courtCallNotificationPermission(),pushReady=courtCallPushRegistered();
 const notifyActive=np==='granted'&&pushReady;
 const notifyBlocked=np==='denied';

 // BXH CALL defaults on. Browser permission itself still needs one user gesture.
 // After permission has been granted once, keep Web Push registered automatically.
 if(np==='granted'&&!pushReady&&!courtCallPushBusy){
  setTimeout(async()=>{
   const ok=await courtCallEnsurePushRegistration(false);
   if(ok){try{renderPreservingScroll();}catch{}}
  },0);
 }

 const label=!on?'BXH CALL 智慧提醒已關閉；裁判正式叫號仍保留':
   notifyActive?'BXH CALL 已開啟，包含智慧 ETA 與背景通知':
   notifyBlocked?'BXH CALL 已開啟；背景通知已被瀏覽器封鎖':
   'BXH CALL 已開啟；點一下完成背景通知設定';

 return `<button class="smart-call-unified-control ${on?'is-on':'is-off'} ${notifyActive?'has-background':'no-background'} ${notifyBlocked?'is-blocked':''}" type="button"
   data-action="toggle-smart-call" data-code="${esc(code||'')}" data-on="${on?'1':'0'}"
   data-notify-active="${notifyActive?'1':'0'}" data-notify-blocked="${notifyBlocked?'1':'0'}"
   data-court-call-help-hold="1" aria-pressed="${on?'true':'false'}"
   aria-label="${esc(label)}；長按 1.5 秒查看說明" title="${esc(label)}">
     <span class="smart-call-unified-bell ${notifyActive?'':'is-notify-off'}" aria-hidden="true">🔔</span>
     <span class="smart-call-unified-track" aria-hidden="true"><span class="smart-call-unified-knob"></span></span>
   </button>`;
}

function renderCourtCallPlayer(code){
 const c=courtCallContext(code);
 const myRows=c.rows.filter(r=>r.players.some(p=>p.me));
 return `<section class="court-call-player-section">
   ${courtCallCommon(c)}
   <div class="court-call-active-list">${myRows.map(r=>courtCallRow(c,r,false)).join('')||'<p class="court-call-empty">等待裁判通知。</p>'}</div>
 </section>`;
}


function closeCourtCallHelpOverlay(){
 const el=typeof document!=='undefined'?document.getElementById('bxh-court-call-help-overlay'):null;
 if(el)el.remove();
}

function showCourtCallHelpOverlay(code){
 if(typeof document==='undefined'||!document.body)return;
 ensureCourtCallGlobalStyles();
 closeCourtCallHelpOverlay();
 const pushReady=courtCallPushRegistered();
 const status=courtCallNotificationHint();
 const overlay=document.createElement('div');
 overlay.id='bxh-court-call-help-overlay';
 overlay.innerHTML=`<div class="bxh-call-help-sheet" role="dialog" aria-modal="true" aria-label="BXH CALL 叫號說明">
   <div class="bxh-call-help-title"><span>🔔 BXH CALL｜叫號說明</span><button type="button" class="bxh-call-help-close" data-action="court-call-close-help" aria-label="關閉">×</button></div>
   <div class="bxh-call-help-status">${esc(status)}</div>
   <div class="bxh-call-help-copy">
     <p>裁判人工叫號與智慧 ETA 分開運作；人工叫號約每 2–3 秒同步。</p>
     <p>PASS 每人每賽事 1 次，且必須有同台同輪下一場可承接。</p>
     <p>智慧 ETA 以每場 3 分鐘為基準，會依進行中比分動態修正；3 分賽點會縮短估時。</p>
     <p>BXH CALL 現在只有一個控制：開啟時提供智慧 ETA／上場提醒，並在裝置允許時自動維持背景與鎖屏通知。</p>
     <p>首次背景通知仍需要瀏覽器授權；鈴鐺出現紅色斜槓代表背景通知尚未可用。裁判正式人工叫號不受智慧提醒開關影響，仍會保留。</p>
     <p>長按 BXH CALL 開關 1.5 秒可再次查看本說明。</p>
   </div>
   ${pushReady?`<button class="btn btn-ghost bxh-call-help-test" data-action="court-call-test-push" data-code="${esc(code||'')}" ${courtCallPushTestBusy?'disabled':''}>🧪 ${courtCallPushTestBusy?'測試送出中…':'測試鎖屏推播'}</button>`:''}
 </div>`;
 document.body.appendChild(overlay);
}

let courtCallHelpHoldTimer=null;
let courtCallHelpHoldTarget=null;
let courtCallHelpHoldStart=null;
function courtCallCancelHelpHold(){
 if(courtCallHelpHoldTimer){clearTimeout(courtCallHelpHoldTimer);courtCallHelpHoldTimer=null;}
 courtCallHelpHoldTarget=null;courtCallHelpHoldStart=null;
}
function bindCourtCallHelpLongPress(){
 if(typeof document==='undefined'||document.documentElement.dataset.bxhCallHelpHoldBound==='1')return;
 document.documentElement.dataset.bxhCallHelpHoldBound='1';
 document.addEventListener('pointerdown',e=>{
  const btn=e.target&&e.target.closest?e.target.closest('[data-court-call-help-hold]'):null;
  if(!btn)return;
  courtCallCancelHelpHold();
  courtCallHelpHoldTarget=btn;
  courtCallHelpHoldStart={x:e.clientX,y:e.clientY};
  courtCallHelpHoldTimer=setTimeout(()=>{
   if(courtCallHelpHoldTarget!==btn)return;
   btn.dataset.courtCallLongpressFired='1';
   showCourtCallHelpOverlay(btn.getAttribute('data-code')||'');
   try{if(navigator.vibrate)navigator.vibrate(45);}catch{}
   courtCallHelpHoldTimer=null;
  },1500);
 },{passive:true});
 document.addEventListener('pointermove',e=>{
  if(!courtCallHelpHoldTarget||!courtCallHelpHoldStart)return;
  if(Math.hypot(e.clientX-courtCallHelpHoldStart.x,e.clientY-courtCallHelpHoldStart.y)>10)courtCallCancelHelpHold();
 },{passive:true});
 document.addEventListener('pointerup',courtCallCancelHelpHold,{passive:true});
 document.addEventListener('pointercancel',courtCallCancelHelpHold,{passive:true});
 document.addEventListener('click',e=>{
  const btn=e.target&&e.target.closest?e.target.closest('[data-court-call-help-hold]'):null;
  if(!btn||btn.dataset.courtCallLongpressFired!=='1')return;
  delete btn.dataset.courtCallLongpressFired;
  e.preventDefault();e.stopImmediatePropagation();
 },true);
}
bindCourtCallHelpLongPress();

function ensureCourtCallGlobalStyles(){
 if(typeof document==='undefined'||document.getElementById('bxh-court-call-global-style'))return;
 const style=document.createElement('style');
 style.id='bxh-court-call-global-style';
 style.textContent=`
 #bxh-court-call-global{position:fixed;inset:0;z-index:2147483200;display:flex;align-items:center;justify-content:center;padding:max(18px,env(safe-area-inset-top)) 18px max(18px,env(safe-area-inset-bottom));background:rgba(0,0,0,.78);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
 .bxh-call-modal{width:min(92vw,430px);border:1px solid rgba(217,185,92,.75);border-radius:18px;background:linear-gradient(165deg,#17181b,#090a0b);box-shadow:0 24px 70px rgba(0,0,0,.65),0 0 28px rgba(217,185,92,.15);padding:22px;text-align:center;color:#f4f5f2}
 .bxh-call-kicker{font-size:12px;letter-spacing:2px;color:#d9b95c;font-weight:900}
 .bxh-call-court{font-family:var(--font-d,system-ui);font-size:34px;line-height:1.05;font-weight:900;color:#f2d675;margin-top:8px}
 .bxh-call-vs{margin:16px 0 4px;display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:10px;align-items:center;font-size:19px;font-weight:900}
 .bxh-call-vs span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bxh-call-vs b{color:#d9b95c;font-size:13px}
 .bxh-call-message{margin:12px 0 16px;color:#d8dbe1;line-height:1.6}
 .bxh-call-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}.bxh-call-actions.one{grid-template-columns:1fr}
 .bxh-call-actions .btn{min-height:52px;font-size:15px;font-weight:900}
 .court-call-people{display:flex;flex-wrap:wrap;gap:8px;margin:9px 0}.court-call-person{padding:5px 8px;border-radius:8px;background:rgba(255,255,255,.04);font-size:12px}.court-call-person.is-replied{color:#f0cf67}
 .court-call-referee-panel{margin:12px 16px 0!important}.court-call-current-actions{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center}.court-call-current-actions .hint{margin:3px 0 0}.court-call-next-compact{margin-top:10px;padding:9px 10px;border:1px solid color-mix(in srgb,var(--court-accent,var(--gold)) 42%,rgba(255,255,255,.10));border-radius:10px;background:linear-gradient(100deg,color-mix(in srgb,var(--court-accent,var(--gold)) 10%,rgba(8,10,14,.84)),rgba(255,255,255,.02));box-shadow:inset 3px 0 0 var(--court-accent,var(--gold))}.court-call-next-compact-head{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:7px}.court-call-next-compact-badge{display:inline-flex;align-items:center;justify-content:center;padding:4px 8px;border-radius:999px;background:var(--court-accent,var(--gold));color:#090a0b;font-size:10px;font-weight:900;line-height:1}.court-call-next-compact-head b{min-width:0;color:#eef0f3;font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.court-call-next-inline-status{color:var(--metal-dim);font-size:10px;white-space:nowrap}.court-call-next-inline-status.is-sent{color:#7cebb8;font-weight:800}.court-call-next-compact-body{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr) auto;align-items:center;gap:7px;margin-top:8px}.court-call-next-compact-player{min-width:0;color:#fff;font-family:var(--font-d,system-ui);font-size:15px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.court-call-next-compact-player.is-right{text-align:right}.court-call-next-compact-vs{color:var(--court-accent,var(--gold));font-size:10.5px;font-weight:900}.court-call-next-compact .court-call-prepare-btn{width:auto;min-height:32px;margin:0;padding:6px 9px;font-size:10.5px;white-space:nowrap}
 #bxh-court-call-help-overlay{position:fixed;inset:0;z-index:2147483250;display:flex;align-items:flex-end;justify-content:center;padding:18px;background:rgba(0,0,0,.72);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
 .bxh-call-help-sheet{width:min(100%,430px);border:1px solid rgba(217,185,92,.45);border-radius:18px;background:linear-gradient(165deg,#17181b,#090a0b);box-shadow:0 24px 70px rgba(0,0,0,.65);padding:16px;color:#eef0f3}
 .bxh-call-help-title{display:flex;align-items:center;justify-content:space-between;gap:10px;color:#f0cf71;font-weight:900}
 .bxh-call-help-close{width:32px;height:32px;border-radius:50%;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);color:#eef0f3;font-size:20px;line-height:1}
 .bxh-call-help-status{margin-top:8px;padding:8px 10px;border-radius:9px;background:rgba(255,255,255,.035);color:#bfc4cc;font-size:11px}
 .bxh-call-help-copy{margin-top:10px;color:#cdd1d7;font-size:12px;line-height:1.55}.bxh-call-help-copy p{margin:6px 0}
 .bxh-call-help-test{width:100%;margin-top:10px}
 @media(max-width:420px){.bxh-call-modal{padding:18px 15px}.bxh-call-court{font-size:30px}.bxh-call-vs{font-size:17px}.bxh-call-actions{grid-template-columns:1fr}.bxh-call-help-sheet{padding:14px}.court-call-current-actions{grid-template-columns:1fr}.court-call-current-actions .btn{width:100%}.court-call-next-compact{padding:8px 9px}.court-call-next-compact-head{gap:6px}.court-call-next-compact-body{grid-template-columns:minmax(0,1fr) auto minmax(0,1fr) auto;gap:6px}.court-call-next-compact-player{font-size:14px}.court-call-next-compact .court-call-prepare-btn{padding:6px 8px;font-size:10px}}
 `;
 document.head.appendChild(style);
}

function courtCallOverlayCandidate(){
 const candidates=[];
 for(const c of courtCallCache.values()){
  for(const r of c.rows||[]){
   const mePlayers=(r.players||[]).filter(p=>p.me);
   if(!mePlayers.length)continue;
   const deferred=!!(r.pass?.status==='approved'&&Array.isArray(r.waitingFor)&&r.waitingFor.length);
   if(deferred){
    const stamp=`${c.code}:${r.matchId}:${r.sequence}:deferred:${r.pass?.approvedAt||r.pass?.requestedAt||0}`;
    if(!courtCallDelayDismissed.has(stamp))candidates.push({type:'deferred',c,r,mePlayer:mePlayers[0],stamp});
    continue;
   }
   const unanswered=mePlayers.find(p=>p.response==='unanswered');
   if(unanswered)candidates.push({type:'call',c,r,mePlayer:unanswered,stamp:`${c.code}:${r.matchId}:${r.sequence}:call`});
  }
 }
 return candidates.sort((a,b)=>Number(b.r.calledAt||0)-Number(a.r.calledAt||0))[0]||null;
}

function syncCourtCallGlobalOverlay(){
 if(typeof document==='undefined'||!document.body)return;
 ensureCourtCallGlobalStyles();
 const old=document.getElementById('bxh-court-call-global');
 const x=courtCallOverlayCandidate();
 if(!x){if(old)old.remove();return;}
 const names=(x.r.players||[]).map(p=>p.name||'選手');
 const a=names[0]||'選手 A',b=names[1]||'選手 B';
 const attrs=`data-code="${esc(x.c.code)}" data-match="${esc(x.r.matchId)}" data-sequence="${x.r.sequence}" data-participant="${esc(x.mePlayer.id||'')}"`;
 const passAllowed=x.mePlayer.canPass&&x.r.canPass&&!x.c.busy&&!x.c.pending;
 const passUnavailable=!passAllowed?courtCallPassUnavailableText(x.r,x.mePlayer):'';
 const requesterIsMe=!!x.r.pass?.requester;
 const html=x.type==='deferred'
  ? `<div class="bxh-call-modal" role="dialog" aria-modal="true" aria-label="PASS 已生效">
      <div class="bxh-call-kicker">BXH CALL｜PASS</div>
      <div class="bxh-call-court">${esc(courtCallStationLabel(x.r.station))}</div>
      <div class="bxh-call-vs"><span>${esc(a)}</span><b>VS</b><span>${esc(b)}</span></div>
      <div class="bxh-call-message"><strong>${requesterIsMe?'PASS 已接受':'對手使用 PASS'}</strong><br>本場已自動延後 1 場，完成前置場次後系統會再次叫號。</div>
      <div class="bxh-call-actions one"><button class="btn btn-primary" data-action="court-call-dismiss-delay" data-stamp="${esc(x.stamp)}">知道了</button></div>
     </div>`
  : `<div class="bxh-call-modal" role="dialog" aria-modal="true" aria-label="裁判叫號">
      <div class="bxh-call-kicker">🔔 裁判叫號</div>
      <div class="bxh-call-court">${esc(courtCallStationLabel(x.r.station))}</div>
      <div class="bxh-call-vs"><span>${esc(a)}</span><b>VS</b><span>${esc(b)}</span></div>
      <div class="bxh-call-message">請前往 <strong>${x.r.station} 號戰鬥台</strong> 準備比賽。<br>請選擇目前狀態。${passUnavailable?`<br><span style="display:inline-block;margin-top:8px;font-size:12px;color:#aeb1ba">⚠️ ${esc(passUnavailable)}</span>`:''}</div>
      <div class="bxh-call-actions">
       <button class="btn btn-primary" data-action="court-call-coming" ${attrs} ${x.c.busy||x.c.pending?'disabled':''}>OK｜正在前往</button>
       <button class="btn btn-ghost" data-action="court-call-pass" ${attrs} ${passAllowed?'':'disabled'}>${passAllowed?'PASS｜延後一場':esc(courtCallPassButtonText(x.r,x.mePlayer))}</button>
      </div>
     </div>`;
 if(old){
  if(old.getAttribute('data-stamp')===x.stamp){old.innerHTML=html;return;}
  old.remove();
 }
 const overlay=document.createElement('div');
 overlay.id='bxh-court-call-global';overlay.setAttribute('data-stamp',x.stamp);overlay.innerHTML=html;
 document.body.appendChild(overlay);
}

function courtCallVibrate(pattern=[180,90,180]){
 try{if(typeof navigator!=='undefined'&&navigator.vibrate)navigator.vibrate(pattern);}catch{}
}

function courtCallNotifyChanges(c,newRows,oldRows,newPrepares=[],oldPrepares=[]){
 const oldPrepareById=new Map((oldPrepares||[]).map(x=>[x.matchId,x]));
 for(const p of newPrepares||[]){
  if(!p.me)continue;
  const before=oldPrepareById.get(p.matchId);
  if(before&&Number(before.sequence)===Number(p.sequence))continue;
  showToast(`⏳ BXH CALL｜你是 ${courtCallStationLabel(p.station)} 下一場，請先到附近準備`);
  courtCallVibrate([90,60,90]);
  courtCallSystemNotify(
   `bxh-prepare:${c.code}:${p.matchId}:${p.sequence}`,
   `⏳ BXH CALL｜下一場準備`,
   `${p.players?.map(x=>x.name).join(' VS ')||'下一場'}｜請先到 ${p.station} 號戰鬥台附近準備。`
  );
 }
 const oldById=new Map((oldRows||[]).map(r=>[r.matchId,r]));
 for(const r of newRows||[]){
  const prev=oldById.get(r.matchId);
  const mePlayers=(r.players||[]).filter(p=>p.me);
  const isMine=mePlayers.length>0;
  const newSequence=!prev||Number(prev.sequence)!==Number(r.sequence);
  if(isMine&&newSequence&&mePlayers.some(p=>p.response==='unanswered')){
   showToast(`🔔 BXH CALL｜${courtCallStationLabel(r.station)} 裁判叫號，請立即回覆`);
   courtCallVibrate();
   const names=(r.players||[]).map(p=>p.name||'選手');
   courtCallSystemNotify(
    `bxh-call:${c.code}:${r.matchId}:${r.sequence}`,
    `🔔 BXH CALL｜${courtCallStationLabel(r.station)}`,
    `${names[0]||'選手 A'} VS ${names[1]||'選手 B'}｜請前往 ${r.station} 號戰鬥台，開啟 ARENA 回覆 OK 或 PASS。`
   );
  }
  if(prev){
   const oldPass=prev.pass?.status||'',newPass=r.pass?.status||'';
   if(newPass==='approved'&&oldPass!=='approved'){
    if(isMine){
     const passMessage=r.pass?.requester?`PASS 已接受｜${courtCallStationLabel(r.station)} 本場延後 1 場`:`對手使用 PASS｜${courtCallStationLabel(r.station)} 本場延後 1 場`;
     showToast(passMessage);
     courtCallVibrate([120,70,120]);
     courtCallSystemNotify(
      `bxh-pass:${c.code}:${r.matchId}:${r.sequence}:${r.pass?.approvedAt||r.pass?.requestedAt||0}`,
      `BXH CALL｜${courtCallStationLabel(r.station)}`,
      `${passMessage}，完成前置場次後系統會再次叫號。`
     );
    }
    if(r.isReferee)showToast(`${courtCallStationLabel(r.station)}｜${r.pass?.playerName||'選手'} 使用 PASS，已自動延後 1 場`);
   }
   for(const p of r.players||[]){
    const before=(prev.players||[]).find(x=>x.id===p.id)?.response||'unanswered';
    if(before===p.response)continue;
    if(r.isReferee&&p.response==='coming')showToast(`${courtCallStationLabel(r.station)}｜${p.name} 已回覆：正在前往`);
    if(isMine&&!p.me&&p.response==='coming')showToast(`對手 ${p.name} 已回覆：正在前往 ${courtCallStationLabel(r.station)}`);
   }
  }
 }
}

async function discoverCourtCallPlayerCodes(force=false){
 const uid=courtCallUserKey();
 if(!uid||courtCallDiscoveryBusy)return;
 if(!force&&Date.now()-courtCallDiscoveryAt<30000)return;
 if(!window.cloudSync||typeof window.cloudSync.queryMyRegistrations!=='function')return;
 courtCallDiscoveryBusy=true;courtCallDiscoveryAt=Date.now();
 try{
  if(window.cloudSync.connect)await window.cloudSync.connect();
  const regs=await window.cloudSync.queryMyRegistrations();
  const codes=(Array.isArray(regs)?regs:[]).filter(r=>r&&r.status==='confirmed'&&/^BXH-[A-Z0-9]{4,16}$/.test(String(r.tournamentCode||'').toUpperCase())).map(r=>String(r.tournamentCode).toUpperCase());
  courtCallPlayerCodes=[...new Set([...codes,...courtCallPlayerCodes])].slice(0,8);
  courtCallSaveKnownCodes(courtCallPlayerCodes);
 }catch(e){
  // Discovery is best-effort. Existing known codes keep polling.
 }finally{
  courtCallDiscoveryBusy=false;
 }
}

function courtCallVisibleCodes(){
 if(!courtCallUserKey())return [];
 const codes=new Set(courtCallPlayerCodes);
 try{
  if(typeof myRegistrationsCache!=='undefined'&&Array.isArray(myRegistrationsCache)){
   myRegistrationsCache.filter(r=>r&&r.status==='confirmed').forEach(r=>{
    const code=String(r.tournamentCode||'').toUpperCase();if(/^BXH-[A-Z0-9]{4,16}$/.test(code))codes.add(code);
   });
  }
 }catch{}
 try{
  // Keep the active tournament's call channel alive for referees/admins even
  // when they momentarily switch from the referee tab to bracket/roster/etc.
  if(state&&state.cloudCode&&canOperateCurrentTournament())codes.add(String(state.cloudCode).toUpperCase());
 }catch{}
 return [...codes].filter(x=>/^BXH-[A-Z0-9]{4,16}$/.test(x)).slice(0,10);
}

function scheduleCourtCallPoll(){
 if(courtCallTimer)return;
 if(!courtCallUserKey()){syncCourtCallGlobalOverlay();return;}
 courtCallTimer=setTimeout(async()=>{
  courtCallTimer=null;
  await discoverCourtCallPlayerCodes(false);
  if(courtCallNotificationPermission()==='granted'&&Date.now()-courtCallPushSyncAt>COURT_CALL_PUSH_REFRESH_MS){
   courtCallEnsurePushRegistration(false).catch(()=>{});
  }
  const list=courtCallVisibleCodes();
  for(const code of list){
   const c=courtCallContext(code);
   if(!c.loading&&!c.busy&&Date.now()>=c.next)await loadCourtCalls(code);
  }
  syncCourtCallGlobalOverlay();
  if(courtCallUserKey())scheduleCourtCallPoll();
 },800);
}

async function loadCourtCalls(code){
 const c=courtCallContext(code);if(c.loading)return;c.loading=true;
 const oldRows=c.rows||[],oldPrepares=c.prepares||[],oldUsed=!!c.used,oldError=c.error||'';
 const oldSig=JSON.stringify({
  rows:oldRows.map(r=>({
   id:r.matchId,seq:r.sequence,calledAt:r.calledAt,
   pass:r.pass?{status:r.pass.status,requestedAt:r.pass.requestedAt,waitFor:r.pass.waitFor}:null,
   players:(r.players||[]).map(p=>[p.id,p.response,p.canPass,p.passUsed]),
   waitingFor:r.waitingFor
  })),
  prepares:oldPrepares.map(p=>[p.matchId,p.sequence,p.notifiedAt])
 });
 let changed=false;
 try{
  const result=await window.engagementService.courtCall({action:'list',code});
  if(c!==courtCallContext(code))return;
  if(!result.ok)throw Error('load-failed');
  const newRows=Array.isArray(result.rows)?result.rows:[];
  const newPrepares=Array.isArray(result.prepares)?result.prepares:[];
  courtCallNotifyChanges(c,newRows,oldRows,newPrepares,oldPrepares);
  c.rows=newRows;c.prepares=newPrepares;c.used=!!result.passUsed;c.error='';
  const newSig=JSON.stringify({
   rows:newRows.map(r=>({
    id:r.matchId,seq:r.sequence,calledAt:r.calledAt,
    pass:r.pass?{status:r.pass.status,requestedAt:r.pass.requestedAt,waitFor:r.pass.waitFor}:null,
    players:(r.players||[]).map(p=>[p.id,p.response,p.canPass,p.passUsed]),
    waitingFor:r.waitingFor
   })),
   prepares:newPrepares.map(p=>[p.matchId,p.sequence,p.notifiedAt])
  });
  changed=oldSig!==newSig||oldUsed!==c.used||oldError!=='';
 }catch(e){
  if(c===courtCallContext(code)){
   const msg=courtCallError(e);
   // Silent background discovery should not paint permission errors into unrelated pages.
   if((c.rows||[]).length||String(e?.message||e).includes('account-inactive'))c.error=msg;
   changed=oldError!==c.error;
  }
 }finally{
  if(c===courtCallContext(code)){
   c.loading=false;c.next=Date.now()+2500;
   syncCourtCallGlobalOverlay();
   const embedsCallUi=(()=>{try{return (appPhase==='player-center'&&playerActiveTab==='registered')||((appPhase==='app'&&activeTab==='referee')||(appPhase==='community-room'&&communityRoomActiveTab==='referee'));}catch{return false;}})();
   if(changed&&embedsCallUi){try{renderPreservingScroll();}catch{}}
  }
 }
}

async function handleCourtCall(action,target){
 if(action==='court-call-close-help'){
  closeCourtCallHelpOverlay();return;
 }
 if(action==='court-call-notify-status'){
  showToast(courtCallNotificationHint());return;
 }
 if(action==='court-call-enable-notify'){
  await courtCallEnableBackgroundNotifications();
  try{renderPreservingScroll();}catch{}
  return;
 }
 if(action==='court-call-test-push'){
  if(courtCallPushTestBusy)return;
  if(!courtCallPushRegistered()){
   showToast('請先啟用鎖屏推播',true);return;
  }
  if(!window.engagementService||typeof window.engagementService.courtCallPush!=='function'){
   showToast('推播測試服務尚未載入',true);return;
  }
  courtCallPushTestBusy=true;
  courtCallPushTestResult='4 秒後發送，請立即切到 LINE 或鎖定手機';
  showToast('4 秒後發送測試推播，請立即切到其他 App 或鎖定手機');
  try{renderPreservingScroll();}catch{}
  try{
   const result=await window.engagementService.courtCallPush({action:'selftest'});
   if(!result?.ok)throw Error('push-selftest-failed');
   const attempted=Number(result.attempted||0),sent=Number(result.sent||0),failed=Number(result.failed||0);
   courtCallPushTestResult=sent>0?`測試已送出 ${sent}/${attempted} 個裝置`:(attempted?'測試送出失敗':'伺服器沒有有效推播裝置');
   showToast(sent>0?'BXH CALL 測試推播已送出，請檢查通知':'測試推播沒有成功送達',sent===0||failed>0);
  }catch(e){
   const raw=String(e?.message||e);
   courtCallPushTestResult=raw.includes('push-test-cooldown')?'請稍候 15 秒再測試':
    raw.includes('push-not-registered')?'伺服器註冊已失效，請重新啟用推播':'測試失敗，請重新啟用推播後再試';
   showToast(courtCallPushTestResult,true);
  }finally{
   courtCallPushTestBusy=false;
   try{renderPreservingScroll();}catch{}
  }
  return;
 }
 if(action==='court-call-dismiss-delay'){
  const stamp=target.getAttribute('data-stamp');if(stamp)courtCallDelayDismissed.add(stamp);
  syncCourtCallGlobalOverlay();return;
 }
 const code=String(target.getAttribute('data-code')||'').toUpperCase();
 if(!code)return;
 const c=courtCallContext(code);if(c.busy)return;
 let payload=c.pending;
 let requestedResponse='';
 if(!payload){
  let api=action.slice(11),response,reason;
  if(['coming','pass','ready'].includes(api)){response=api;requestedResponse=response;api='respond';}
  if(response==='pass')reason='其他';
  if(api==='approve'&&!confirm('這是舊版待審 PASS。核准後將同台同輪延後 1 場，是否繼續？'))return;
  if(!['notify','prepare','respond','approve','reject'].includes(api))return;
  payload={
   action:api,code,matchId:target.getAttribute('data-match'),
   sequence:Number(target.getAttribute('data-sequence')),
   operationId:crypto.randomUUID()
  };
  const participantId=target.getAttribute('data-participant');
  if(participantId)payload.participantId=participantId;
  if(response)payload.response=response;
  if(reason)payload.reason=reason;
 }
 const storageKey=c.storageKey;
 try{
  sessionStorage.setItem(storageKey,JSON.stringify(payload));c.pending=payload;c.busy=true;c.error='';
  syncCourtCallGlobalOverlay();
  try{renderPreservingScroll();}catch{}
  if(payload.action==='approve'){
   await flushStationMatchMutations();
   if(!await flushCloudStateWrites())throw Error('sync-pending');
  }
  const r=await window.engagementService.courtCall(payload);
  if(c!==courtCallContext(code))return;
  if(!r.ok)throw Error('operation-failed');
  c.pending=null;sessionStorage.removeItem(storageKey);
  if(r.state&&typeof state!=='undefined'&&state.cloudCode===code)applyRemoteState(r.state,true);
  c.busy=false;
  await loadCourtCalls(code);
  if(payload.action==='notify')showToast('叫號已送出雙方選手');
  else if(payload.action==='prepare')showToast('已提前通知下一場雙方選手準備');
  else if(requestedResponse==='pass'||payload.response==='pass')showToast('PASS 已接受，本場自動延後 1 場');
  else if(requestedResponse==='coming'||payload.response==='coming')showToast('已回覆裁判：正在前往');
  else showToast('叫號操作已確認');
 }catch(e){
  if(c===courtCallContext(code)){
   c.error=courtCallError(e);
   if(['functions/failed-precondition','functions/permission-denied'].includes(e.code)){
    c.pending=null;sessionStorage.removeItem(storageKey);
   }
   showToast(c.error,true);
  }
 }finally{
  if(c===courtCallContext(code)){
   c.busy=false;syncCourtCallGlobalOverlay();
   try{renderPreservingScroll();}catch{}
  }
 }
}

function courtCallPublicQueue(s,station){
 const all=(s.matches||[]).filter(m=>!m.isBye&&!m.completed&&m.station===station&&m.a&&m.b&&m.status!=='paused').sort((a,b)=>Number(a.seq)-Number(b.seq));
 const result=all.filter(m=>!m.skippedAt);
 const skipped=all.filter(m=>m.skippedAt&&!m.resumeQueuedAt&&!m.skipManualOnly).sort((a,b)=>a.skippedAt-b.skippedAt||String(a.id).localeCompare(String(b.id)));
 for(const m of skipped.slice().reverse()){
  const ids=m.skipWaitFor||[];
  if(m.callPass&&ids.some(id=>!s.matches.find(x=>x.id===id)?.completed&&!result.some(x=>x.id===id)))continue;
  const at=result.reduce((last,x,i)=>ids.includes(x.id)?i+1:last,0);
  result.splice(at,0,m);
 }
 return all.filter(m=>m.skippedAt&&m.resumeQueuedAt).concat(result);
}


/* Load ranked registration T-5 lobby UX without coupling it to the 2.18 MB inline app bundle. */
(function loadRankedRegistrationPreopenUx(){
 try{
  if(typeof document==='undefined'||document.querySelector('script[data-bxh-ranked-preopen]'))return;
  const s=document.createElement('script');
  s.src='ranked-registration-preopen-ui.js?v=14.2.29';
  s.async=false;
  s.dataset.bxhRankedPreopen='true';
  (document.head||document.documentElement).appendChild(s);
 }catch(e){console.warn('[ranked preopen loader]',e);}
})();
