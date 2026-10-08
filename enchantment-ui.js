/* BXH 附魔之戰｜裁判與選手手機的 callable bridge。入口啟用前保持唯讀。 */
(function(root){
 'use strict';
 const cache=new Map(),busy=new Set(),frames=new WeakMap(),matchNames=new Map(),reversedSides=new Set(),autoDrawBusy=new Set();
 let drawSoundEnabled=true;
 const CARD_SKIN_KEY='bxh-enchantment-card-skin';
 const AUTO_DRAW_KEY='bxh-enchantment-player-auto-draw';
 const GODS_CARD_IDS=new Set(['double_extreme','double_knockout','double_burst','double_spin','boost_extreme','boost_knockout','boost_burst','weaken_extreme','weaken_knockout','weaken_burst','weaken_spin','seal']);
 const GODS_CARD_PATH='assets/enchantment-gods/';
 function cardSkin(){try{return localStorage.getItem(CARD_SKIN_KEY)==='gods'?'gods':'basic';}catch(e){return 'basic';}}
 function saveCardSkin(value){try{localStorage.setItem(CARD_SKIN_KEY,value);}catch(e){/* A private session can still switch cards. */}}
 function autoDrawEnabled(){try{return localStorage.getItem(AUTO_DRAW_KEY)==='1';}catch(e){return false;}}
 function saveAutoDraw(enabled){try{localStorage.setItem(AUTO_DRAW_KEY,enabled?'1':'0');}catch(e){/* Keep this session usable without storage. */}}
 function updateAutoDrawButton(overlay){
  const button=overlay?.querySelector?.('[data-enchantment-auto-draw]');if(!button)return;
  const enabled=autoDrawEnabled();
  button.setAttribute('aria-pressed',String(enabled));
  button.textContent='AUTO 抽卡 '+(enabled?'ON':'OFF');
  button.style.background=enabled?'#4d3412':'#171326';
  button.style.borderColor=enabled?'#e3bd68':'#766391';
  button.style.color=enabled?'#fff0b5':'#d7c7eb';
 }
 function attachCardSkin(overlay,frame){
  const selector=overlay.querySelector('[data-enchantment-card-skin]');
  const face=frame.contentDocument?.getElementById('cardFaceImage');
  const back=frame.contentDocument?.querySelector('#card .face.back');
  if(!selector||!face)return;
  let selected='basic',baseSrc='',changing=false,godsOwned={};
  const godsOption=selector.querySelector('option[value="gods"]');
  if(godsOption)godsOption.disabled=true;
  selector.value=selected;
  const currentId=()=>cache.get(key(frame.dataset.code,frame.dataset.matchId))?.state?.cards?.[frame.dataset.side];
  const godsSrc=id=>new URL(GODS_CARD_PATH+id+'.webp',location.href).href;
  const applyBack=()=>{
   if(!back)return;
   if(selected==='gods'&&Object.values(godsOwned).some(Number))back.style.backgroundImage=`url("${new URL(GODS_CARD_PATH+'back.webp?v=20260928-c-grand',location.href).href}")`;
   else back.style.removeProperty('background-image');
  };
  const apply=()=>{
   const id=currentId();if(!GODS_CARD_IDS.has(id))return;
   const target=selected==='gods'&&Number(godsOwned[id])>0?godsSrc(id):baseSrc;
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
  selector.addEventListener('change',()=>{selected=selector.value==='gods'&&Object.values(godsOwned).some(Number)?'gods':'basic';selector.value=selected;saveCardSkin(selected);overlay.dataset.cardSkinUnlocked=selected;applyBack();apply();showSharedCards(overlay,cache.get(key(frame.dataset.code,frame.dataset.matchId))?.state,frame.dataset.side);});
  const ownershipCall=root.engagementService?.cardAlbum?.({action:'get'});
  if(ownershipCall)ownershipCall.then(result=>{
   if(!overlay.isConnected)return;
   godsOwned=result?.sets?.gods||{};
   const hasGods=Object.values(godsOwned).some(value=>Number(value)>0);
   if(godsOption)godsOption.disabled=!hasGods;
   selected=hasGods&&cardSkin()==='gods'?'gods':'basic';
   selector.value=selected;overlay.dataset.cardSkinUnlocked=selected;
   applyBack();apply();showSharedCards(overlay,cache.get(key(frame.dataset.code,frame.dataset.matchId))?.state,frame.dataset.side);
  }).catch(()=>{if(godsOption)godsOption.disabled=true;});
  applyBack();
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
  return `<section class="panel" data-enchantment-referee data-code="${c}" data-match-id="${id}" data-dispatch-revision="${Number(m.dispatchRevision||0)}" style="margin:12px 16px;padding:14px">
   <strong data-enchantment-title>附魔之戰｜5 分制｜等待裁判開始</strong>
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
  const enabled=!!state&&state.phase!=='completed';
  return `<div class="fe-card-action" style="margin-top:10px">
   <button type="button" class="btn btn-sm ${enabled?'btn-primary':'btn-ghost'}" data-enchantment-open data-code="${quote(code)}" ${m?`data-match-id="${quote(m.id)}"`:''} ${enabled?'':'disabled aria-disabled="true"'} style="width:100%;min-height:44px;${enabled?'':'opacity:.55;filter:grayscale(1)'}">${enabled?(state.drawn?.[side]?'查看本局卡片':'進入抽卡｜第 '+Number(state.round)+' 局'):'抽卡入口｜尚未輪到你'}</button>
   <button type="button" class="btn btn-ghost btn-sm" data-enchantment-preview style="width:100%;min-height:44px;margin-top:6px">體驗抽牌場景</button>
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
  wrap.append(entry);
  const preview=document.createElement('button');preview.type='button';preview.className='btn btn-ghost btn-sm';
  preview.dataset.enchantmentPreview='';preview.textContent='體驗抽牌場景';
  preview.style.cssText='width:100%;min-height:44px;margin-top:6px';
  wrap.append(preview);row.before(wrap);return entry;
 }
 function statusHtml(code,id,version,s){
  const common=`data-code="${quote(code)}" data-match-id="${quote(id)}"`;
  const button=(label,action,extra='',disabled=false)=>`<button class="btn btn-ghost btn-sm" data-enchantment-action="${action}" ${common} ${extra} ${disabled?'disabled':''}>${label}</button>`;
  if(!s)return `<p>選手到場後，由裁判按「開始抽卡」。</p>${button('開始抽卡','start')}`;
  const ready=s.phase==='ready-to-score';
  const sides=reversedSides.has(key(code,id))?['B','A']:['A','B'];
  const remaining=s.revealDeadline?Math.max(0,Math.ceil((s.revealDeadline-Date.now())/1000)):null;
  const revealControl=s.phase==='drawing'?`<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:9px 0;padding:9px;border:1px solid #805f9d;border-radius:9px"><button type="button" class="btn btn-ghost btn-sm" data-enchantment-action="setAutoReveal" ${common} data-enabled="${s.autoReveal===false?'true':'false'}" aria-pressed="${s.autoReveal!==false}">8 秒自動揭牌：${s.autoReveal===false?'關':'開'}</button><span class="hint">${remaining!==null?`等待另一位揭牌 · ${remaining} 秒`:s.drawn?.A||s.drawn?.B?'等待另一位揭牌':'等待選手揭牌'}</span></div>`:'';
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
   const assist=s.phase==='drawing'&&!s.drawn?.[side]?button(`協助${quote(name)}揭牌`,'assistReveal',`data-side="${side}"`):'';
   return `<div class="side-panel ${active?'enchant-active':''}"><div class="side-name">${quote(name)}</div><div class="hint" style="text-align:center;margin:2px 0 4px;font-size:12px">附魔：${drawStatus}${badge}</div><div class="side-score">${Number(s.scores?.[side])||0}</div><div class="score-btns">${scoreButtons}<button class="fault-btn ${(s.faults?.[side]||0)>0?'has-fault':''}" data-enchantment-action="fault" ${common} data-side="${side}" ${ready?'':'disabled'}>失誤 ${s.faults?.[side]||0}/2</button></div>${assist}</div>`;
  }).join('')}</div><button type="button" class="btn btn-ghost btn-sm" data-enchantment-action="swap" ${common} aria-label="交換選手站位" title="交換選手站位" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2;min-width:40px;padding:6px">⇄</button></div>`;
  let controls='';
  if((s.phase==='drawing'||s.phase==='awaiting-result'||ready&&(Number(s.faults?.A)||Number(s.faults?.B)))&&version>0)
   controls+=button(ready?'撤回上一筆失誤':'撤回上一筆','undo');
  if(s.phase==='awaiting-result')controls+=button('確認勝負','confirm');
  return `${revealControl}${scorePanel}<div class="btn-row ref-result-actions">${controls}</div>`;
 }
 function paint(code,id){
  const item=cache.get(key(code,id));
  document.querySelectorAll('[data-enchantment-referee]').forEach(el=>{
   if(el.dataset.code!==code||el.dataset.matchId!==id)return;
   const slot=el.querySelector('[data-enchantment-status]');if(!slot)return;
   const s=item?.state;
   const localModal=[...document.querySelectorAll('[data-enchantment-confirm-modal]')][0];
   if(localModal&&localModal.dataset.code===code&&localModal.dataset.matchId===id&&s?.phase!=='awaiting-result')localModal.remove();
   const phase=s?(s.phase==='completed'?'已完成':s.phase==='awaiting-result'?'等待確認':s.drawn?.A&&s.drawn?.B?'已抽卡':'等待抽卡'):'等待裁判開始';
   const title=el.querySelector('[data-enchantment-title]');
   if(title)title.textContent='附魔之戰｜5 分制｜'+(s?'第 '+String(Number(s.round)||0).padStart(2,'0')+' 局｜':'')+phase;
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
 function playerState(s,side){
  const both=!!(s.drawn?.A&&s.drawn?.B);
  return {...s,cards:{A:(side==='A'||both)?s.cards?.A:null,B:(side==='B'||both)?s.cards?.B:null}};
 }
 function showSharedCards(overlay,s,side){
  if(!overlay)return;
  let panel=overlay.querySelector('[data-enchantment-shared-cards]');
  const both=!!(s?.drawn?.A&&s?.drawn?.B&&s.cards?.A&&s.cards?.B);
  if(!both){panel?.remove();return;}
  if(!panel){
   panel=document.createElement('div');panel.dataset.enchantmentSharedCards='';
   panel.style.cssText='position:absolute;right:10px;bottom:12px;z-index:4;width:min(244px,60vw);padding:9px;border:1px solid #e4bd87;border-radius:14px;background:#171329ee;color:#fff;box-shadow:0 8px 24px #000b;backdrop-filter:blur(10px)';
   overlay.append(panel);
  }
  const gods=overlay.dataset.cardSkinUnlocked==='gods';
  const label=who=>quote(matchNames.get(key(overlay.dataset.code,overlay.dataset.matchId))?.[who]||'選手 '+who);
  panel.innerHTML='<div style="text-align:center;color:#f9d69a;font-weight:800;font-size:12px;margin-bottom:6px">雙方附魔已公開</div><div style="display:flex;gap:6px;justify-content:center">'+
   ['A','B'].map(who=>{
    const id=s.cards[who],card=details(id),name=quote(card?.name||'附魔卡'),self=side===who;
    const art=gods&&GODS_CARD_IDS.has(id)?'<img src="'+quote(new URL(GODS_CARD_PATH+id+'.webp',location.href).href)+'" alt="'+name+'卡面" style="width:62px;height:93px;object-fit:cover;border-radius:6px">':'<div style="width:62px;height:93px;border-radius:6px;border:1px solid #bd9bca;background:linear-gradient(145deg,#614384,#29213e);display:grid;place-items:center;text-align:center;padding:4px">'+name+'</div>';
    return '<div style="flex:1;min-width:0;text-align:center;font-size:11px"><div style="color:#d7c7eb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+(self?'你 · ':'')+label(who)+'</div>'+art+'<div style="color:#f9d69a;font-weight:700">'+name+'</div></div>';
   }).join('')+'</div><div style="text-align:center;color:#cdbfe0;font-size:10px;margin-top:5px">本局卡牌保留至下一局抽卡</div>';
 }
 async function maybeAutoDraw(frame,state){
  if(!frame||!autoDrawEnabled()||state?.phase!=='drawing')return;
  const {code,matchId:id,side}=frame.dataset;
  if(!code||!id||!['A','B'].includes(side)||state.drawn?.[side])return;
  const k=key(code,id),item=cache.get(k);
  if(!item?.state||Number(item.state.round)!==Number(state.round)||busy.has(k))return;
  const token=k+':'+side+':'+Number(state.round);
  if(autoDrawBusy.has(token))return;
  autoDrawBusy.add(token);busy.add(k);
  const overlay=frame.closest?.('[data-enchantment-draw-overlay]');
  const button=overlay?.querySelector?.('[data-enchantment-auto-draw]');
  if(button){button.disabled=true;button.textContent='AUTO 抽卡中…';}
  try{
   const result=await call({action:'draw',code,matchId:id,version:item.version,round:state.round});
   cache.set(k,{version:result.version,state:result.state});
   frame.contentWindow?.postMessage({kind:'bxh-enchantment-state',code,matchId:id,side,state:playerState(result.state,side)},location.origin);
   showSharedCards(overlay,result.state,side);
  }catch(error){
   if(message(error).includes('stale-version'))setTimeout(()=>refresh(code,id),0);
   else if(typeof showToast==='function')showToast('AUTO 抽卡失敗：'+message(error),true);
  }finally{
   busy.delete(k);autoDrawBusy.delete(token);
   updateAutoDrawButton(overlay);
  }
 }
 function syncFrames(code,id){
  const item=cache.get(key(code,id));if(!item?.state)return;
  document.querySelectorAll('iframe[data-enchantment-player]').forEach(frame=>{
   if(frame.dataset.code!==code||frame.dataset.matchId!==id)return;
   const overlay=frame.closest?.('[data-enchantment-draw-overlay]');
   showSharedCards(overlay,item.state,frame.dataset.side);
   updateAutoDrawButton(overlay);
   const first=!frames.get(frame);frames.set(frame,true);
   frame.contentWindow?.postMessage({kind:first?'bxh-enchantment-init':'bxh-enchantment-state',code,matchId:id,side:frame.dataset.side,state:playerState(item.state,frame.dataset.side),names:matchNames.get(key(code,id))||null,soundEnabled:drawSoundEnabled},location.origin);
   maybeAutoDraw(frame,item.state);
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
    const canEnter=show&&['drawing','ready-to-score','awaiting-result'].includes(s.phase);
    if(reopen){
     reopen.dataset.matchId=m.id;
     reopen.disabled=!canEnter;reopen.setAttribute('aria-disabled',String(!canEnter));
     reopen.textContent=canDraw?'進入抽卡｜第 '+Number(s.round)+' 局':canEnter?'查看本局卡片':'抽卡入口｜尚未輪到你';
     reopen.style.opacity=canEnter?'1':'.55';reopen.style.filter=canEnter?'':'grayscale(1)';
    }
    if(!show){if(overlay?.dataset.code===code&&overlay.dataset.matchId===m.id)overlay.remove();if(dismissedMatch===key(code,m.id))dismissedMatch='';continue;}
    if(dismissedMatch===key(code,m.id))continue;
    if(overlay?.dataset.code===code&&overlay.dataset.matchId===m.id){
     syncFrames(code,m.id);continue;
    }
    if(!canEnter)continue;
    if(overlay)overlay.remove();
    overlay=document.createElement('section');
    overlay.dataset.enchantmentDrawOverlay='';overlay.dataset.code=code;overlay.dataset.matchId=m.id;
    overlay.setAttribute('role','dialog');overlay.setAttribute('aria-label','附魔之戰抽卡');
    overlay.style.cssText='position:fixed;inset:0;z-index:2147483000;background:#080917;display:flex;flex-direction:column';
    overlay.innerHTML='<div style="position:absolute;left:12px;top:58px;z-index:3;display:flex;gap:6px;align-items:center;flex-wrap:wrap;max-width:calc(100% - 24px)"><label style="color:#f5e2ab;font-size:12px">卡牌外觀 <select data-enchantment-card-skin aria-label="卡牌外觀" style="min-height:38px;background:#171326;border:1px solid #766391;border-radius:9px;color:white;padding:6px"><option value="basic">基礎卡牌</option><option value="gods">諸神戰場</option></select></label><button type="button" data-enchantment-auto-draw aria-label="自動抽卡" aria-pressed="false" style="min-height:38px;background:#171326;border:1px solid #766391;border-radius:9px;color:#d7c7eb;padding:6px 10px;font-weight:800">AUTO 抽卡 OFF</button></div><div style="position:absolute;right:12px;top:10px;z-index:3;display:flex;gap:6px;align-items:center"><button type="button" data-enchantment-sound aria-label="切換音效" aria-pressed="'+drawSoundEnabled+'" style="font-size:20px;min-width:38px;background:#171326;border:1px solid #766391;border-radius:9px;color:white">'+(drawSoundEnabled?'🔊':'🔇')+'</button><button type="button" data-enchantment-recover style="background:#171326;border:1px solid #b994e8;border-radius:9px;color:#f5e2ab;padding:7px 10px">恢復本局抽卡</button><button type="button" data-enchantment-close style="background:#171326;border:1px solid #766391;border-radius:9px;color:white;padding:7px 10px">離開房間</button></div><div data-enchantment-loading style="position:absolute;left:0;right:0;top:103px;z-index:2;color:#f5e2ab;text-align:center;padding:24px 16px">正在載入 BXH 卡牌與龍爪動畫…<br><small>首次載入可能需要一些時間，請留在此畫面。</small></div>';
    const frame=document.createElement('iframe');frame.title='附魔之戰選手抽卡';frame.dataset.enchantmentPlayer='';
    frame.dataset.code=code;frame.dataset.matchId=m.id;frame.dataset.side=side;
    frame.src='enchantment-draw-v3.html';frame.style.cssText='border:0;width:100%;flex:1;min-height:0;background:#080917;visibility:hidden';
    overlay.append(frame);document.body.append(overlay);updateAutoDrawButton(overlay);
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
 function openEnchantmentPreview(){
  if(document.querySelector('[data-enchantment-preview-overlay]'))return;
  const overlay=document.createElement('section');overlay.dataset.enchantmentPreviewOverlay='';
  overlay.setAttribute('role','dialog');overlay.setAttribute('aria-label','附魔抽牌體驗');
  overlay.style.cssText='position:fixed;inset:0;z-index:2147483100;background:#080917;display:flex;flex-direction:column';
  overlay.innerHTML='<div style="position:absolute;left:12px;top:10px;z-index:3;padding:9px;color:#f5e2ab;background:#171326dd;border-radius:9px;font-size:12px">抽牌體驗｜不計入賽事</div><button type="button" data-enchantment-preview-close style="position:absolute;right:12px;top:10px;z-index:3;background:#171326;border:1px solid #766391;border-radius:9px;color:white;padding:7px 10px">離開體驗</button><div data-enchantment-preview-loading style="position:absolute;left:0;right:0;top:70px;color:#f5e2ab;text-align:center">正在載入抽牌場景…</div>';
  const frame=document.createElement('iframe');frame.title='附魔之戰抽牌體驗';
  frame.src='docs/enchantment/approved-draw-v3.html';
  frame.style.cssText='border:0;width:100%;flex:1;min-height:0;background:#080917';
  frame.addEventListener('load',()=>overlay.querySelector('[data-enchantment-preview-loading]')?.remove(),{once:true});
  overlay.append(frame);document.body.append(overlay);
 }
 async function recoverPlayerDraw(button){
  const overlay=button.closest('[data-enchantment-draw-overlay]');
  const frame=overlay?.querySelector('iframe[data-enchantment-player]');
  if(!frame||button.disabled)return;
  const {code,matchId:id}=frame.dataset;
  button.disabled=true;button.textContent='正在恢復…';
  try{
   const result=await Promise.race([
    call({action:'get',code,matchId:id}),
    new Promise((_,reject)=>setTimeout(()=>reject(Error('連線逾時，請再試一次')),12000))
   ]);
   if(!overlay.isConnected||!result?.state)throw Error('本局狀態尚未建立');
   cache.set(key(code,id),{version:result.version,state:result.state});
   // Reload only the animation. The server retains the assigned card.
   frame.style.visibility='hidden';
   frame.addEventListener('load',()=>{
    if(!overlay.isConnected)return;
    const valid=!!frame.contentDocument?.querySelector('main.app');
    if(!valid){button.textContent='載入失敗，請再試一次';return;}
    frames.delete(frame);attachCardSkin(overlay,frame);
    frame.style.visibility='visible';syncFrames(code,id);
    button.textContent='恢復本局抽卡';
   },{once:true});
   frame.src='enchantment-draw-v3.html?recover='+Date.now();
  }catch(error){
   if(overlay?.isConnected){button.textContent='恢復失敗，請重試';
    if(typeof showToast==='function')showToast('抽卡恢復失敗：'+message(error),true);}
  }finally{button.disabled=false;}
 }
 document.addEventListener('click',e=>{
  if(e.target.closest('[data-enchantment-preview-close]')){document.querySelector('[data-enchantment-preview-overlay]')?.remove();return;}
  if(e.target.closest('[data-enchantment-preview]')){openEnchantmentPreview();return;}
  const recover=e.target.closest('[data-enchantment-recover]');
  if(recover){recoverPlayerDraw(recover);return;}
  const auto=e.target.closest('[data-enchantment-auto-draw]');
  if(auto){
   const enabled=!autoDrawEnabled();saveAutoDraw(enabled);
   const overlay=auto.closest?.('[data-enchantment-draw-overlay]');updateAutoDrawButton(overlay);
   if(enabled){
    const frame=overlay?.querySelector?.('iframe[data-enchantment-player]');
    const item=frame&&cache.get(key(frame.dataset.code,frame.dataset.matchId));
    if(frame&&item?.state)maybeAutoDraw(frame,item.state);
   }
   return;
  }
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
 function closeConfirmModal(){
  [...document.querySelectorAll('[data-enchantment-confirm-modal]')][0]?.remove();
 }
 function openConfirmModal(code,id){
  const item=cache.get(key(code,id)),s=item?.state;
  if(!s||s.phase!=='awaiting-result')return;
  const scoreA=Number(s.scores?.A)||0,scoreB=Number(s.scores?.B)||0;
  const winner=scoreA>=5&&scoreA>scoreB?'A':scoreB>=5&&scoreB>scoreA?'B':null;
  if(!winner){
   if(typeof showToast==='function')showToast('目前比分尚未產生可確認的獲勝者',true);
   return;
  }
  closeConfirmModal();
  const names=matchNames.get(key(code,id))||{};
  const winnerName=names[winner]||'選手 '+winner;
  const overlay=document.createElement('section');
  overlay.dataset.enchantmentConfirmModal='';
  overlay.dataset.code=code;overlay.dataset.matchId=id;overlay.dataset.version=String(item.version);
  overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','附魔之戰勝負確認');
  overlay.style.cssText='position:fixed;inset:0;z-index:2147483600;background:#05040acc;display:grid;place-items:center;padding:20px;backdrop-filter:blur(8px)';
  overlay.innerHTML=`<div style="width:min(430px,100%);border:1px solid #d9b86c;border-radius:18px;background:linear-gradient(160deg,#171326,#0b0912);box-shadow:0 24px 80px #000c,0 0 28px #b889ff33;padding:22px;color:#fff;text-align:center">
   <div style="font-size:12px;letter-spacing:.16em;color:#cbb9df">附魔之戰｜5 分制</div>
   <h3 style="margin:8px 0 4px;font-size:22px">🏆 比賽結果確認</h3>
   <div style="margin-top:16px;color:#cdbfe0;font-size:13px">獲勝者</div>
   <div data-enchantment-confirm-winner style="margin:5px 0 12px;font-size:30px;font-weight:900;color:#f4d27a;word-break:break-word">${quote(winnerName)}</div>
   <div style="font-size:14px;color:#e7dfef">${quote(names.A||'選手 A')} <strong style="font-size:22px;color:#fff">${scoreA}</strong> ： <strong style="font-size:22px;color:#fff">${scoreB}</strong> ${quote(names.B||'選手 B')}</div>
   <p style="margin:14px 0 18px;color:#aaa0b7;font-size:12px">確認後將完成本場比賽並推進賽程。</p>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
    <button type="button" class="btn btn-ghost" data-enchantment-confirm-cancel style="min-height:46px">取消</button>
    <button type="button" class="btn btn-primary" data-enchantment-confirm-submit style="min-height:46px">確認結果</button>
   </div>
  </div>`;
  document.body.append(overlay);
 }
 async function operate(d){
  const {code,matchId:id,action}=d,k=key(code,id),item=cache.get(k);
  if(busy.has(k))return;
  if(action!=='start'&&!item?.state){await refresh(code,id);return;}
  busy.add(k);
  try{
   const payload={code,matchId:id,action};
   if(action==='start')payload.dispatchRevision=Number([...document.querySelectorAll('[data-enchantment-referee]')].find(el=>el.dataset.code===code&&el.dataset.matchId===id)?.dataset.dispatchRevision||0);
   if(action!=='start')payload.version=item.version;
   if(action==='score'){payload.round=item.state.round;payload.winner=d.side;payload.type=d.type;}
   if(action==='fault'){payload.round=item.state.round;payload.offender=d.side;}
   if(action==='assistReveal'){payload.round=item.state.round;payload.target=d.side;}
   if(action==='setAutoReveal')payload.enabled=d.enabled==='true';
   if(action==='confirm'&&Number(d.expectedVersion)!==Number(item.version)){
    closeConfirmModal();
    if(typeof showToast==='function')showToast('比分狀態已更新，請重新確認勝負',true);
    await refresh(code,id);return;
   }
   const result=await call(payload);
   if(action==='confirm')closeConfirmModal();
   cache.set(k,{version:result.version,state:result.state});paint(code,id);syncFrames(code,id);
   if(result.event||result.completion){if(typeof showToast==='function')showToast(result.completion?'已確認比賽結果':'已記錄本局判定');}
  }catch(e){if(message(e).includes('stale-version')){if(action==='confirm')closeConfirmModal();await refresh(code,id);if(typeof showToast==='function')showToast('比分狀態已更新，請重新確認勝負',true);}else if(typeof showToast==='function')showToast('附魔操作失敗：'+message(e),true);}
  finally{busy.delete(k);await refresh(code,id);}
 }
 document.addEventListener('click',e=>{
  const el=e.target.closest('[data-enchantment-action]');
  if(el){
   e.preventDefault();e.stopPropagation();
   const d=el.dataset;
   if(d.enchantmentAction==='refresh')refresh(d.code,d.matchId);
   else if(d.enchantmentAction==='swap'){const k=key(d.code,d.matchId);if(reversedSides.has(k))reversedSides.delete(k);else reversedSides.add(k);paint(d.code,d.matchId);}
   else if(d.enchantmentAction==='confirm')openConfirmModal(d.code,d.matchId);
   else operate({code:d.code,matchId:d.matchId,action:d.enchantmentAction,side:d.side,type:d.type,enabled:d.enabled});
   return;
  }
  const cancel=e.target.closest('[data-enchantment-confirm-cancel]');
  if(cancel){e.preventDefault();e.stopPropagation();closeConfirmModal();return;}
  const submit=e.target.closest('[data-enchantment-confirm-submit]');
  if(submit){
   e.preventDefault();e.stopPropagation();
   const modal=submit.closest('[data-enchantment-confirm-modal]');if(!modal)return;
   operate({code:modal.dataset.code,matchId:modal.dataset.matchId,action:'confirm',expectedVersion:Number(modal.dataset.version)});
  }
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
 setInterval(()=>{for(const el of document.querySelectorAll('[data-enchantment-referee]')){
  const s=cache.get(key(el.dataset.code,el.dataset.matchId))?.state;
  if(!s?.revealDeadline)continue;
  paint(el.dataset.code,el.dataset.matchId);
  if(s.phase==='drawing'&&s.revealDeadline<=Date.now())refresh(el.dataset.code,el.dataset.matchId);
 }},1000);
 root.BXHEnchantmentUI={referee,player,refresh};
})(window);
