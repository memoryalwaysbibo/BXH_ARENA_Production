/* v14.1.0 — BXH CALL 2.0 Phase A (P1-P3).
   Foreground global call overlay + one-match self-service PASS + referee/opponent sync.
   Background/lock-screen Web Push remains Phase P4. */
'use strict';

let courtCallCache=new Map(),courtCallTimer=null,courtCallIdentity='';
let courtCallPlayerCodes=[],courtCallDiscoveryAt=0,courtCallDiscoveryBusy=false;
const courtCallDelayDismissed=new Set();

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
   rows:[],used:false,error:'',pending,busy:false,loading:false,next:0
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

function courtCallPlayerResponseLabel(response){
 return ({unanswered:'未回覆',coming:'✅ 正在前往',pass:'⏸ PASS',ready:'✅ 已準備好'})[response]||response||'未回覆';
}

function courtCallRow(c,r,ref){
 const attrs=`data-code="${esc(c.code)}" data-match="${esc(r.matchId)}" data-sequence="${r.sequence}"`;
 const disabled=c.busy||c.pending?'disabled':'';
 const myPlayer=r.players.find(p=>p.me);
 const participantAttr=myPlayer?` data-participant="${esc(myPlayer.id)}"`:'';
 const passText=r.pass?.status==='pending'?'舊版 PASS 待裁判核准':
  r.pass?.status==='approved'?'PASS 已接受，同台延後 1 場':
  r.pass?.status==='rejected'?'PASS 未核准':'';
 const playerStatus=r.players.map(p=>`<span class="court-call-person ${p.response==='unanswered'?'is-waiting':'is-replied'}"><b>${esc(p.name)}</b> ${esc(courtCallPlayerResponseLabel(p.response))}</span>`).join('');
 const playerActions=!ref&&myPlayer?(
   myPlayer.response==='unanswered'&&!(r.pass?.status==='approved'&&r.waitingFor.length)
    ? `<button class="btn btn-primary" data-action="court-call-coming" ${attrs}${participantAttr} ${disabled}>OK｜正在前往</button>${myPlayer.canPass&&r.canPass?`<button class="btn btn-ghost" data-action="court-call-pass" ${attrs}${participantAttr} ${disabled}>PASS｜延後一場</button>`:''}`
    : (r.pass?.status==='approved'&&r.pass.requester&&!r.waitingFor.length?`<button class="btn btn-ghost" data-action="court-call-ready" ${attrs}${participantAttr} ${disabled}>我已準備好</button>`:'')
  ):'';
 const legacyActions=ref&&r.canApprove?`<button class="btn btn-primary" data-action="court-call-approve" ${attrs} ${disabled}>核准舊版 PASS</button><button class="btn btn-ghost" data-action="court-call-reject" ${attrs} ${disabled}>拒絕</button>`:'';
 return `<div class="panel court-call-row" style="margin-top:8px">
   <strong>Court ${r.station}｜第 ${Number(r.round)+1} 輪</strong>
   <p class="hint">叫號：${esc(new Date(r.calledAt).toLocaleTimeString("zh-TW",{hour12:false}))}</p>
   <div class="court-call-people">${playerStatus}</div>
   ${r.pass?`<p class="hint">${esc(passText)}${r.waitingFor.length?`｜前置場次尚餘 ${r.waitingFor.length} 場`:''}</p>`:''}
   ${legacyActions||playerActions?`<div class="btn-row">${legacyActions}${playerActions}</div>`:''}
 </div>`;
}

function renderCourtCallReferee(m){
 if(!m||!m.a||!m.b||m.completed||!state.startedAt||!state.cloudCode||!canOperateStation(m.station))return '';
 const c=courtCallContext(state.cloudCode);
 return `<section class="panel">
   <div class="panel-title">BXH CALL｜裁判叫號</div>
   <button class="btn btn-primary" data-action="court-call-notify" data-code="${esc(c.code)}" data-match="${esc(m.id)}" ${c.busy||c.pending?'disabled':''}>通知雙方選手</button>
   <p class="hint">選手只要已登入 BXH ARENA，前景任何頁面都可收到叫號彈窗。PASS 會自動同台同輪延後 1 場，每人每賽事限一次；未回覆不自動判棄權。</p>
   ${courtCallCommon(c)}
   ${c.rows.filter(r=>r.isReferee&&r.station===m.station).map(r=>courtCallRow(c,r,true)).join('')}
 </section>`;
}

function renderCourtCallPlayer(code){
 const c=courtCallContext(code);
 return `<section>
   <p class="hint">裁判人工叫號與智慧 ETA 已分離｜人工叫號約每 2–3 秒同步｜PASS：${c.used?'本賽事已使用':'可使用 1 次，直接延後一場'}</p>
   ${courtCallCommon(c)}
   ${c.rows.filter(r=>r.players.some(p=>p.me)).map(r=>courtCallRow(c,r,false)).join('')||'<p class="hint">等待裁判通知。</p>'}
 </section>`;
}

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
 @media(max-width:420px){.bxh-call-modal{padding:18px 15px}.bxh-call-court{font-size:30px}.bxh-call-vs{font-size:17px}.bxh-call-actions{grid-template-columns:1fr}}
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
 const requesterIsMe=!!x.r.pass?.requester;
 const html=x.type==='deferred'
  ? `<div class="bxh-call-modal" role="dialog" aria-modal="true" aria-label="PASS 已生效">
      <div class="bxh-call-kicker">BXH CALL｜PASS</div>
      <div class="bxh-call-court">Court ${x.r.station}</div>
      <div class="bxh-call-vs"><span>${esc(a)}</span><b>VS</b><span>${esc(b)}</span></div>
      <div class="bxh-call-message"><strong>${requesterIsMe?'PASS 已接受':'對手使用 PASS'}</strong><br>本場已自動延後 1 場，完成前置場次後系統會再次叫號。</div>
      <div class="bxh-call-actions one"><button class="btn btn-primary" data-action="court-call-dismiss-delay" data-stamp="${esc(x.stamp)}">知道了</button></div>
     </div>`
  : `<div class="bxh-call-modal" role="dialog" aria-modal="true" aria-label="裁判叫號">
      <div class="bxh-call-kicker">🔔 裁判叫號</div>
      <div class="bxh-call-court">Court ${x.r.station}</div>
      <div class="bxh-call-vs"><span>${esc(a)}</span><b>VS</b><span>${esc(b)}</span></div>
      <div class="bxh-call-message">請前往 <strong>${x.r.station} 號戰鬥台</strong> 準備比賽。<br>請選擇目前狀態。</div>
      <div class="bxh-call-actions">
       <button class="btn btn-primary" data-action="court-call-coming" ${attrs} ${x.c.busy||x.c.pending?'disabled':''}>OK｜正在前往</button>
       <button class="btn btn-ghost" data-action="court-call-pass" ${attrs} ${passAllowed?'':'disabled'}>${passAllowed?'PASS｜延後一場':x.c.used?'PASS 已使用':'PASS 不可用'}</button>
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

function courtCallNotifyChanges(c,newRows,oldRows){
 const oldById=new Map((oldRows||[]).map(r=>[r.matchId,r]));
 for(const r of newRows||[]){
  const prev=oldById.get(r.matchId);
  const mePlayers=(r.players||[]).filter(p=>p.me);
  const isMine=mePlayers.length>0;
  const newSequence=!prev||Number(prev.sequence)!==Number(r.sequence);
  if(isMine&&newSequence&&mePlayers.some(p=>p.response==='unanswered')){
   showToast(`🔔 BXH CALL｜Court ${r.station} 裁判叫號，請立即回覆`);
   courtCallVibrate();
  }
  if(prev){
   const oldPass=prev.pass?.status||'',newPass=r.pass?.status||'';
   if(newPass==='approved'&&oldPass!=='approved'){
    if(isMine){
     showToast(r.pass?.requester?`PASS 已接受｜Court ${r.station} 本場延後 1 場`:`對手使用 PASS｜Court ${r.station} 本場延後 1 場`);
     courtCallVibrate([120,70,120]);
    }
    if(r.isReferee)showToast(`Court ${r.station}｜${r.pass?.playerName||'選手'} 使用 PASS，已自動延後 1 場`);
   }
   for(const p of r.players||[]){
    const before=(prev.players||[]).find(x=>x.id===p.id)?.response||'unanswered';
    if(before===p.response)continue;
    if(r.isReferee&&p.response==='coming')showToast(`Court ${r.station}｜${p.name} 已回覆：正在前往`);
    if(isMine&&!p.me&&p.response==='coming')showToast(`對手 ${p.name} 已回覆：正在前往 Court ${r.station}`);
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
  if(((appPhase==='app'&&activeTab==='referee')||(appPhase==='community-room'&&communityRoomActiveTab==='referee'))&&state.cloudCode&&canOperateCurrentTournament())codes.add(String(state.cloudCode).toUpperCase());
 }catch{}
 return [...codes].filter(x=>/^BXH-[A-Z0-9]{4,16}$/.test(x)).slice(0,10);
}

function scheduleCourtCallPoll(){
 if(courtCallTimer)return;
 if(!courtCallUserKey()){syncCourtCallGlobalOverlay();return;}
 courtCallTimer=setTimeout(async()=>{
  courtCallTimer=null;
  await discoverCourtCallPlayerCodes(false);
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
 const oldRows=c.rows||[];
 try{
  const result=await window.engagementService.courtCall({action:'list',code});
  if(c!==courtCallContext(code))return;
  if(!result.ok)throw Error('load-failed');
  const newRows=Array.isArray(result.rows)?result.rows:[];
  courtCallNotifyChanges(c,newRows,oldRows);
  c.rows=newRows;c.used=!!result.passUsed;c.error='';
 }catch(e){
  if(c===courtCallContext(code)){
   const msg=courtCallError(e);
   // Silent background discovery should not paint permission errors into unrelated pages.
   if((c.rows||[]).length||String(e?.message||e).includes('account-inactive'))c.error=msg;
  }
 }finally{
  if(c===courtCallContext(code)){
   c.loading=false;c.next=Date.now()+2500;
   syncCourtCallGlobalOverlay();
   try{renderPreservingScroll();}catch{}
  }
 }
}

async function handleCourtCall(action,target){
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
  if(!['notify','respond','approve','reject'].includes(api))return;
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
