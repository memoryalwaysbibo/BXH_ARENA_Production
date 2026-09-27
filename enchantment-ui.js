/* BXH 附魔之戰｜裁判與選手手機的 callable bridge。入口啟用前保持唯讀。 */
(function(root){
 'use strict';
 const cache=new Map(),busy=new Set(),frames=new WeakMap(),matchNames=new Map(),reversedSides=new Set();
 let drawSoundEnabled=true;
 const CARD_SKIN_KEY='bxh-enchantment-card-skin';
 const GODS_CARD_IDS=new Set(['double_extreme','double_knockout','double_burst','double_spin','boost_extreme','boost_knockout','boost_burst','weaken_extreme','weaken_knockout','weaken_burst','weaken_spin','seal']);
 const GODS_CARD_PATH='assets/enchantment-gods/';
 function cardSkin(){try{return localStorage.getItem(CARD_SKIN_KEY)==='gods'?'gods':'basic';}catch(e){return 'basic';}}
 function saveCardSkin(value){try{localStorage.setItem(CARD_SKIN_KEY,value);}catch(e){/* A private session can still switch cards. */}}
 function attachCardSkin(overlay,frame){
  const selector=overlay.querySelector('[data-enchantment-card-skin]');
  const face=frame.contentDocument?.getElementById('cardFaceImage');
  if(!selector||!face)return;
  let selected=cardSkin(),baseSrc='',changing=false;
  selector.value=selected;
  const currentId=()=>cache.get(key(frame.dataset.code,frame.dataset.matchId))?.state?.cards?.[frame.dataset.side];
  const godsSrc=id=>new URL(GODS_CARD_PATH+id+'.webp',location.href).href;
  const apply=()=>{
   const id=currentId();if(!GODS_CARD_IDS.has(id))return;
   const target=selected==='gods'?godsSrc(id):baseSrc;
   if(target&&face.src!==target){changing=true;face.src=target;changing=false;}
  };
  const observer=new MutationObserver(()=>{
   if(changing)return;
   const src=face.getAttribute('src')||'';
   if(!src||src.includes(GODS_CARD_PATH))return;
   baseSrc=face.src;
   apply();
  });
  observer.observe(face,{attributes:true,attributeFilter:['src']});
  selector.addEventListener('change',()=>{selected=selector.value==='gods'?'gods':'basic';saveCardSkin(selected);apply();});
  if(face.getAttribute('src')&&!face.src.includes(GODS_CARD_PATH)){baseSrc=face.src;apply();}
  const cleanup=new MutationObserver(()=>{if(!overlay.isConnected){observer.disconnect();cleanup.disconnect();}});
  cleanup.observe(document.body,{childList:true});
 }
 const quote=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const key=(code,id)=>code+':'+id;
 const call=payload=>root.engagementService.enchantment(payload);
 const details=id=>root.BXHEnchantmentScore?.CARDS[id];
 const outcome={spin:'轉停',knockout:'擊飛',burst:'爆裂',extreme:'極限'};
 const message=e=>String(e?.message||e||'連線失敗').slice(0,140);
 function referee(m,code,stationLocked){
  if(!code)return '<div class="banner warn">尚未連接賽事雲端，附魔裁判台暫不可操作。</div>';
  matchNames.set(key(code,m.id),{A:typeof playerName==='function'?playerName(m.a?.playerId):'選手 A',B:typeof playerName==='function'?playerName(m.b?.playerId):'選手 B'});
  const id=quote(m.id),c=quote(code),locked=stationLocked?'disabled':'';
  setTimeout(()=>refresh(code,m.id),0);
  return `<section class="panel" data-enchantment-referee data-code="${c}" data-match-id="${id}" style="margin:12px 16px;padding:14px">
   <strong data-enchantment-title>附魔之戰｜等待裁判開始</strong>
   <style>
    [data-enchantment-referee] .enchant-active{border-color:#b889ff!important;box-shadow:0 0 0 1px #b889ff55,0 0 20px #9d62ff38;animation:enchant-glow 2.5s ease-in-out infinite}
    [data-enchantment-referee] .enchant-badge{display:inline-block;margin-left:6px;padding:2px 7px;border:1px solid #c594ff;border-radius:999px;background:#6e35aa88;color:#fff1bc;font-size:11px;font-weight:700;vertical-align:middle}
    [data-enchantment-referee] .enchant-effect-button{border-color:#e6b5ff!important;box-shadow:inset 0 0 13px #ad6bf43d,0 0 0 1px #d991ff88,0 0 9px #a64cf455;color:#fff0c7!important}
    [data-enchantment-referee] .enchant-flame-label{display:inline-block;margin-left:8px;font-size:11px;font-weight:900;letter-spacing:.08em;color:#ffcf63;text-shadow:0 -2px 5px #ff4d1f,0 0 10px #ff8b22,0 0 16px #e63b13;animation:enchant-flame 1.1s ease-in-out infinite alternate;white-space:nowrap}
    @keyframes enchant-flame{from{transform:translateY(1px);filter:brightness(.9)}to{transform:translateY(-2px);filter:brightness(1.35)}}
    @keyframes enchant-glow{50%{box-shadow:0 0 0 2px #b889ff88,0 0 26px #9d62ff6b}}
    @media(prefers-reduced-motion:reduce){[data-enchantment-referee] .enchant-active,[data-enchantment-referee] .enchant-flame-label{animation:none}}
   </style>
   <div data-enchantment-status>讀取抽卡狀態中…</div>
   <button class="btn btn-ghost btn-sm" data-enchantment-action="refresh" data-code="${c}" data-match-id="${id}">更新附魔狀態</button>
   ${stationLocked?'<p class="hint">本台未指派給你，僅供查看。</p>':''}
  </section>`;
 }
 function player(registration,info){
  const data=info?.parsedData,code=registration?.tournamentCode;
  if(!data||!code||registration.status!=='confirmed')return '';
  if(data.meta?.playMode!=='enchantment'&&![...cache.keys()].some(k=>k.startsWith(code+':')))return '';
  const pid=typeof smartCallFindPlayerId==='function'?smartCallFindPlayerId(data,registration):null;
  const m=(data.matches||[]).find(x=>!x.completed&&!x.isBye&&x.a?.playerId&&x.b?.playerId&&
   (x.a.playerId===pid||x.b.playerId===pid)&&
   (x.status==='in_progress'||Object.values(data.courtAssignments||{}).some(c=>c?.currentMatchId===x.id)));
  const side=m?(m.a.playerId===pid?'A':'B'):null;
  const state=m&&cache.get(key(code,m.id))?.state;
  const enabled=!!state&&state.phase==='drawing'&&!state.drawn?.[side];
  return `<div class="fe-card-action" style="margin-top:10px">
   <button type="button" class="btn btn-sm ${enabled?'btn-primary':'btn-ghost'}" data-enchantment-open data-code="${quote(code)}" ${m?`data-match-id="${quote(m.id)}"`:''} ${enabled?'':'disabled aria-disabled="true"'} style="width:100%;min-height:44px;${enabled?'':'opacity:.55;filter:grayscale(1)'}">${enabled?'進入抽卡｜第 '+Number(state.round)+' 局':'抽卡入口｜尚未輪到你'}</button>
   </div>`;
 }
 function ensureScheduleEntry(code){
  let entry=[...document.querySelectorAll('[data-enchantment-open]')].find(el=>el.dataset.code===code);
  if(entry)return entry;
  const detail=[...document.querySelectorAll('[data-action="view-public-tournament"]')].find(el=>el.dataset.code===code);
  const row=detail?.closest('.my-schedule-card')?.querySelector('.my-schedule-actions');
  if(!row)return null;
  const wrap=document.createElement('div');wrap.className='fe-card-action';wrap.style.marginTop='10px';
  entry=document.createElement('button');entry.type='button';entry.className='btn btn-ghost btn-sm';
  entry.dataset.enchantmentOpen='';entry.dataset.code=code;entry.disabled=true;entry.setAttribute('aria-disabled','true');
  entry.textContent='抽卡入口｜尚未輪到你';entry.style.cssText='width:100%;min-height:44px;opacity:.55;filter:grayscale(1)';
  wrap.append(entry);row.before(wrap);return entry;
 }
 function statusHtml(code,id,version,s){
  const common=`data-code="${quote(code)}" data-match-id="${quote(id)}"`;
  const button=(label,action,extra='',disabled=false)=>`<button class="btn btn-ghost btn-sm" data-enchantment-action="${action}" ${common} ${extra} ${disabled?'disabled':''}>${label}</button>`;
  if(!s)return `<p>選手到場後，由裁判按「開始抽卡」。</p>${button('開始抽卡','start')}`;
  const ready=s.phase==='ready-to-score';
  const sides=reversedSides.has(key(code,id))?['B','A']:['A','B'];
  const scorePanel=`<div style="position:relative"><div class="ref-vs-arena standard">${sides.map(side=>{
   const name=matchNames.get(key(code,id))?.[side]||'選手 '+side;
   const scoreButtons=Object.entries(outcome).map(([type,label])=>{
    const result=root.BXHEnchantmentScore.resolve({type,winnerCardId:s.cards[side],loserCardId:s.cards[side==='A'?'B':'A']});
    const modified=ready&&result.ok&&result.points!==result.originalPoints;
    return `<button class="${modified?'enchant-effect-button':''}" data-enchantment-action="score" ${common} data-side="${side}" data-type="${type}" ${ready?'':'disabled'}>${modified?'✦ ':''}${label} ${result.ok?result.originalPoints+' → '+result.points:''}${modified?'<span class="enchant-flame-label">附魔中</span>':''}</button>`;
   }).join('');
   const card=details(s.cards?.[side]);
   const drawStatus=s.drawn?.[side]?quote(card?.name||'已抽卡'):'尚未抽卡';
   const active=ready&&s.drawn?.[side];
   const badge=active?`<span class="enchant-badge">${s.cards?.[side]==='seal'?'✦ 封印中':'✦ 附魔中'}</span>`:'';
   return `<div class="side-panel ${active?'enchant-active':''}"><div class="side-name">${quote(name)}</div><div class="hint" style="text-align:center;margin:2px 0 4px;font-size:12px">附魔：${drawStatus}${badge}</div><div class="side-score">${Number(s.scores?.[side])||0}</div><div class="score-btns">${scoreButtons}<button class="fault-btn ${(s.faults?.[side]||0)>0?'has-fault':''}" data-enchantment-action="fault" ${common} data-side="${side}" ${ready?'':'disabled'}>失誤 ${s.faults?.[side]||0}/2</button></div></div>`;
  }).join('')}</div><button type="button" class="btn btn-ghost btn-sm" data-enchantment-action="swap" ${common} aria-label="交換選手站位" title="交換選手站位" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2;min-width:40px;padding:6px">⇄</button></div>`;
  let controls='';
  if((s.phase==='drawing'||s.phase==='awaiting-result'||ready&&(Number(s.faults?.A)||Number(s.faults?.B)))&&version>0)
   controls+=button(ready?'撤回上一筆失誤':'撤回上一筆','undo');
  if(s.phase==='awaiting-result')controls+=button('確認比賽結果','confirm');
  return `${scorePanel}<div class="btn-row ref-result-actions">${controls}</div>`;
 }
 function paint(code,id){
  const item=cache.get(key(code,id));
  document.querySelectorAll('[data-enchantment-referee]').forEach(el=>{
   if(el.dataset.code!==code||el.dataset.matchId!==id)return;
   const slot=el.querySelector('[data-enchantment-status]');if(!slot)return;
   const s=item?.state;
   const phase=s?(s.phase==='completed'?'已完成':s.phase==='awaiting-result'?'等待確認':s.drawn?.A&&s.drawn?.B?'已抽卡':'等待抽卡'):'等待裁判開始';
   const title=el.querySelector('[data-enchantment-title]');
   if(title)title.textContent='附魔之戰｜'+(s?'第 '+String(Number(s.round)||0).padStart(2,'0')+' 局｜':'')+phase;
   slot.innerHTML=item?.error?`<p role="alert">${quote(item.error)}</p>`:statusHtml(code,id,item?.version||0,item?.state||null);
  });
 }
 async function refresh(code,id){
  if(!code||!id||!root.engagementService?.enchantment)return;
  const k=key(code,id);if(busy.has(k))return;
  busy.add(k);
  try{const result=await call({action:'get',code,matchId:id});cache.set(k,{version:result.version,state:result.state});}
  catch(e){cache.set(k,{error:message(e)});}
  finally{busy.delete(k);paint(code,id);syncFrames(code,id);}
 }
 function playerState(s,side){return {...s,cards:{A:side==='A'?s.cards?.A:null,B:side==='B'?s.cards?.B:null}};}
 function syncFrames(code,id){
  const item=cache.get(key(code,id));if(!item?.state)return;
  document.querySelectorAll('iframe[data-enchantment-player]').forEach(frame=>{
   if(frame.dataset.code!==code||frame.dataset.matchId!==id)return;
   const first=!frames.get(frame);frames.set(frame,true);
   frame.contentWindow?.postMessage({kind:first?'bxh-enchantment-init':'bxh-enchantment-state',code,matchId:id,side:frame.dataset.side,state:playerState(item.state,frame.dataset.side),names:matchNames.get(key(code,id))||null,soundEnabled:drawSoundEnabled},location.origin);
  });
 }

 // Public brackets created before this fix can omit playMode. Use the signed-in
 // player's confirmed registration to find the active match; the callable
 // verifies the UID and only returns an enchantment round to its participants.
 let discoveryBusy=false,lastRegistrations=0,registrations=[],dismissedMatch='';
 async function discoverPlayerDraw(){
  if(discoveryBusy||!root.cloudSync?.queryMyRegistrations||!root.engagementService?.enchantment)return;
  discoveryBusy=true;
  try{
   if(Date.now()-lastRegistrations>30000){registrations=await root.cloudSync.queryMyRegistrations();lastRegistrations=Date.now();}
   for(const r of registrations.filter(x=>x.status==='confirmed')){
    const code=r.tournamentCode;
    const info=await root.cloudSync.getPublicTournamentSummary(code);
    const data=info?.parsedData;
    if(!data?.startedAt||!Array.isArray(data.matches))continue;
    const pid=typeof smartCallFindPlayerId==='function'?smartCallFindPlayerId(data,r):null;
    const m=data.matches.find(x=>!x.completed&&!x.isBye&&x.a?.playerId&&x.b?.playerId&&
     (x.a.playerId===pid||x.b.playerId===pid)&&
     (x.status==='in_progress'||Object.values(data.courtAssignments||{}).some(c=>c?.currentMatchId===x.id)));
    if(!m){
     const overlay=document.querySelector('[data-enchantment-draw-overlay]');
     const active=overlay&&overlay.dataset.code===code&&data.matches.some(x=>x.id===overlay.dataset.matchId&&x.completed);
     if(active){overlay.remove();dismissedMatch='';}
     const entry=[...document.querySelectorAll('[data-enchantment-open]')].find(el=>el.dataset.code===code);
     if(entry){entry.disabled=true;entry.setAttribute('aria-disabled','true');entry.textContent='抽卡入口｜尚未輪到你';entry.style.opacity='.55';entry.style.filter='grayscale(1)';}
     continue;
    }
    const side=m.a.playerId===pid?'A':'B';
    const matchPlayerName=side=>{
     const pid=m[side.toLowerCase()]?.playerId;
     const record=data.players?.find(p=>p.id===pid);
     return String(record?.name||record?.displayName||'').trim()||'選手 '+side;
    };
    matchNames.set(key(code,m.id),{A:matchPlayerName('A'),B:matchPlayerName('B')});
    let result;
    try{result=await call({action:'get',code,matchId:m.id});}catch(e){continue;}
    cache.set(key(code,m.id),{version:result.version,state:result.state});
    const s=result.state;
    const show=!!s&&s.phase!=='completed';
    let overlay=document.querySelector('[data-enchantment-draw-overlay]');
    const reopen=ensureScheduleEntry(code);
    const canDraw=show&&s.phase==='drawing'&&!s.drawn?.[side];
    if(reopen){
     reopen.dataset.matchId=m.id;
     reopen.disabled=!canDraw;reopen.setAttribute('aria-disabled',String(!canDraw));
     reopen.textContent=canDraw?'進入抽卡｜第 '+Number(s.round)+' 局':'抽卡入口｜尚未輪到你';
     reopen.style.opacity=canDraw?'1':'.55';reopen.style.filter=canDraw?'':'grayscale(1)';
    }
    if(!show){if(overlay?.dataset.code===code&&overlay.dataset.matchId===m.id)overlay.remove();if(dismissedMatch===key(code,m.id))dismissedMatch='';continue;}
    if(dismissedMatch===key(code,m.id))continue;
    if(overlay?.dataset.code===code&&overlay.dataset.matchId===m.id){
     syncFrames(code,m.id);continue;
    }
    if(!canDraw)continue;
    if(overlay)overlay.remove();
    overlay=document.createElement('section');
    overlay.dataset.enchantmentDrawOverlay='';overlay.dataset.code=code;overlay.dataset.matchId=m.id;
    overlay.setAttribute('role','dialog');overlay.setAttribute('aria-label','附魔之戰抽卡');
    overlay.style.cssText='position:fixed;inset:0;z-index:2147483000;background:#080917;display:flex;flex-direction:column';
    overlay.innerHTML='<label style="position:absolute;left:12px;top:10px;z-index:3;color:#f5e2ab;font-size:12px">卡牌外觀 <select data-enchantment-card-skin aria-label="卡牌外觀" style="min-height:38px;background:#171326;border:1px solid #766391;border-radius:9px;color:white;padding:6px"><option value="basic">基礎卡牌</option><option value="gods">諸神戰場</option></select></label><div style="position:absolute;right:12px;top:10px;z-index:3;display:flex;gap:6px;align-items:center"><button type="button" data-enchantment-sound aria-label="切換音效" aria-pressed="'+drawSoundEnabled+'" style="font-size:20px;min-width:38px;background:#171326;border:1px solid #766391;border-radius:9px;color:white">'+(drawSoundEnabled?'🔊':'🔇')+'</button><button type="button" data-enchantment-close style="background:#171326;border:1px solid #766391;border-radius:9px;color:white;padding:7px 10px">離開房間</button></div><div data-enchantment-loading style="position:absolute;left:0;right:0;top:65px;z-index:2;color:#f5e2ab;text-align:center;padding:24px 16px">正在載入 BXH 卡牌與龍爪動畫…<br><small>首次載入可能需要一些時間，請留在此畫面。</small></div>';
    const frame=document.createElement('iframe');frame.title='附魔之戰選手抽卡';frame.dataset.enchantmentPlayer='';
    frame.dataset.code=code;frame.dataset.matchId=m.id;frame.dataset.side=side;
    frame.src='enchantment-draw-v3.html';frame.style.cssText='border:0;width:100%;flex:1;min-height:0;background:#080917;visibility:hidden';
    overlay.append(frame);document.body.append(overlay);
    frame.addEventListener('load',()=>{
     if(!overlay.isConnected)return;
     let valid=true;
     try{valid=!!frame.contentDocument?.querySelector('main.app');}catch(e){/* Keep cross-origin fallback visible. */}
     const loading=overlay.querySelector('[data-enchantment-loading]');
     if(!valid){if(loading)loading.innerHTML='抽卡畫面載入失敗。請按「離開抽卡畫面」，再點「進入附魔對戰」重試。';return;}
     if(loading)loading.remove();attachCardSkin(overlay,frame);frame.style.visibility='visible';syncFrames(code,m.id);
    },{once:true});
    break;
   }
  }catch(e){/* Registration and public bracket may be temporarily unavailable. */}
  finally{discoveryBusy=false;}
 }
 document.addEventListener('click',e=>{
  if(e.target.closest('[data-enchantment-close]')){
   const overlay=document.querySelector('[data-enchantment-draw-overlay]');
   if(overlay)dismissedMatch=key(overlay.dataset.code,overlay.dataset.matchId);
   overlay?.remove();

  }
  if(e.target.closest('[data-enchantment-sound]')){
   drawSoundEnabled=!drawSoundEnabled;
   const btn=e.target.closest('[data-enchantment-sound]');btn.textContent=drawSoundEnabled?'🔊':'🔇';btn.setAttribute('aria-pressed',String(drawSoundEnabled));
   document.querySelector('[data-enchantment-draw-overlay] iframe[data-enchantment-player]')?.contentWindow?.postMessage({kind:'bxh-enchantment-sound',enabled:drawSoundEnabled},location.origin);
  }
  if(e.target.closest('[data-enchantment-open]:not([disabled])')){dismissedMatch='';discoverPlayerDraw();}
 });
 setInterval(discoverPlayerDraw,4000);
 setTimeout(discoverPlayerDraw,1500);
 async function operate(d){
  const {code,matchId:id,action}=d,k=key(code,id),item=cache.get(k);
  if(busy.has(k))return;
  if(action!=='start'&&!item?.state){await refresh(code,id);return;}
  busy.add(k);
  try{
   const payload={code,matchId:id,action};
   if(action!=='start')payload.version=item.version;
   if(action==='score'){payload.round=item.state.round;payload.winner=d.side;payload.type=d.type;}
   if(action==='fault'){payload.round=item.state.round;payload.offender=d.side;}
   if(action==='confirm'&&!window.confirm('確認附魔比分與獲勝選手，並推進下一輪？'))return;
   const result=await call(payload);
   cache.set(k,{version:result.version,state:result.state});paint(code,id);syncFrames(code,id);
   if(result.event||result.completion){if(typeof showToast==='function')showToast(result.completion?'已確認比賽結果':'已記錄本局判定');}
  }catch(e){if(typeof showToast==='function')showToast('附魔操作失敗：'+message(e),true);}
  finally{busy.delete(k);await refresh(code,id);}
 }
 document.addEventListener('click',e=>{
  const el=e.target.closest('[data-enchantment-action]');if(!el)return;
  e.preventDefault();e.stopPropagation();
  const d=el.dataset;if(d.enchantmentAction==='refresh')refresh(d.code,d.matchId);else if(d.enchantmentAction==='swap'){const k=key(d.code,d.matchId);if(reversedSides.has(k))reversedSides.delete(k);else reversedSides.add(k);paint(d.code,d.matchId);}else operate({code:d.code,matchId:d.matchId,action:d.enchantmentAction,side:d.side,type:d.type});
 },true);
 root.addEventListener('message',async e=>{
  if(e.origin!==location.origin)return;
  const frame=[...document.querySelectorAll('iframe[data-enchantment-player]')].find(f=>f.contentWindow===e.source);
  if(!frame)return;
  const {code,matchId:id,side}=frame.dataset,k=key(code,id),d=e.data||{};
  if(d.kind==='bxh-enchantment-ready'){
   await refresh(code,id);syncFrames(code,id);
  }else if(d.kind==='bxh-enchantment-draw'&&d.code===code&&d.matchId===id){
   if(busy.has(k))return;
   const item=cache.get(k);if(!item?.state||item.state.round!==d.round)return refresh(code,id);
   busy.add(k);
   try{const result=await call({action:'draw',code,matchId:id,version:item.version,round:d.round});cache.set(k,{version:result.version,state:result.state});frame.contentWindow.postMessage({kind:'bxh-enchantment-state',code,matchId:id,side,state:playerState(result.state,side)},location.origin);}
   catch(error){frame.contentWindow.postMessage({kind:'bxh-enchantment-error',code,matchId:id},location.origin);}
   finally{busy.delete(k);}
  }
 });
 setInterval(()=>{
  const refs=[...document.querySelectorAll('[data-enchantment-referee]')];
  const players=[...document.querySelectorAll('iframe[data-enchantment-player]')];
  const pairs=new Set([...refs,...players].map(el=>key(el.dataset.code,el.dataset.matchId)));
  pairs.forEach(pair=>{const i=pair.indexOf(':');if(i>0)refresh(pair.slice(0,i),pair.slice(i+1));});
 },4000);
 root.BXHEnchantmentUI={referee,player,refresh};
})(window);
