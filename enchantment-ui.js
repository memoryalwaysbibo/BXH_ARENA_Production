/* BXH 附魔之戰｜裁判與選手手機的 callable bridge。入口啟用前保持唯讀。 */
(function(root){
 'use strict';
 const cache=new Map(),busy=new Set(),frames=new WeakMap(),matchNames=new Map();
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
   <strong>附魔之戰｜${quote(m.a?.playerId)} VS ${quote(m.b?.playerId)}</strong>
   <div data-enchantment-status>讀取抽卡狀態中…</div>
   <button class="btn btn-ghost btn-sm" data-enchantment-action="refresh" data-code="${c}" data-match-id="${id}">更新附魔狀態</button>
   ${stationLocked?'<p class="hint">本台未指派給你，僅供查看。</p>':''}
  </section>`;
 }
 function player(registration,info){
  const data=info?.parsedData,code=registration?.tournamentCode;
  if(!data||data.meta?.playMode!=='enchantment'||!code||registration.status!=='confirmed')return '';
  const pid=typeof smartCallFindPlayerId==='function'?smartCallFindPlayerId(data,registration):null;
  const m=(data.matches||[]).find(x=>!x.completed&&!x.isBye&&x.a?.playerId&&x.b?.playerId&&
   (x.a.playerId===pid||x.b.playerId===pid)&&Object.values(data.courtAssignments||{}).some(c=>c?.currentMatchId===x.id));
  if(!m)return '';
  const side=m.a.playerId===pid?'A':'B';
  return `<section class="panel" style="margin:12px 0;padding:12px"><strong>附魔之戰｜你的抽卡畫面</strong>
   <p class="hint">裁判開始後，在自己的手機將卡片穿過龍爪向上抽。</p>
   <iframe title="附魔之戰選手抽卡" data-enchantment-player data-code="${quote(code)}" data-match-id="${quote(m.id)}" data-side="${side}" src="enchantment-draw-v3.html" style="width:100%;height:min(760px,85dvh);border:0;border-radius:12px;background:#080917" loading="eager"></iframe>
   </section>`;
 }
 function statusHtml(code,id,version,s){
  const common=`data-code="${quote(code)}" data-match-id="${quote(id)}"`;
  const button=(label,action,extra='',disabled=false)=>`<button class="btn btn-ghost btn-sm" data-enchantment-action="${action}" ${common} ${extra} ${disabled?'disabled':''}>${label}</button>`;
  if(!s)return `<p>選手到場後，由裁判按「開始抽卡」。</p>${button('開始抽卡','start')}`;
  const A=details(s.cards?.A),B=details(s.cards?.B),ready=s.phase==='ready-to-score';
  const cards=`<p>選手 A：${s.drawn?.A?quote(A?.name||'已抽卡'):'尚未抽卡'}　｜　選手 B：${s.drawn?.B?quote(B?.name||'已抽卡'):'尚未抽卡'}</p>`;
  const points=`<p>比分 A ${Number(s.scores?.A)||0}：${Number(s.scores?.B)||0} B　｜　第 ${Number(s.round)||0} 局</p>`;
  const phase={drawing:'等待雙方抽卡', 'ready-to-score':'等待裁判判定', 'awaiting-result':'已達 4 分，請確認結果',completed:'本場已確認'}[s.phase]||'等待裁判開始';
  const scorePanel=`<div class="ref-vs-arena standard">${['A','B'].map(side=>{
   const name=matchNames.get(key(code,id))?.[side]||'選手 '+side;
   const scoreButtons=Object.entries(outcome).map(([type,label])=>{
    const result=root.BXHEnchantmentScore.resolve({type,winnerCardId:s.cards[side],loserCardId:s.cards[side==='A'?'B':'A']});
    return `<button data-enchantment-action="score" ${common} data-side="${side}" data-type="${type}" ${ready?'':'disabled'}>${label} ${result.ok?result.originalPoints+' → '+result.points:''}</button>`;
   }).join('');
   return `<div class="side-panel"><div class="side-name">${quote(name)}</div><div class="side-score">${Number(s.scores?.[side])||0}</div><div class="score-btns">${scoreButtons}<button class="fault-btn ${(s.faults?.[side]||0)>0?'has-fault':''}" data-enchantment-action="fault" ${common} data-side="${side}" ${ready?'':'disabled'}>失誤 ${s.faults?.[side]||0}/2</button></div></div>`;
  }).join('')}</div>`;
  let controls='';
  if((s.phase==='drawing'||s.phase==='awaiting-result'||ready&&(Number(s.faults?.A)||Number(s.faults?.B)))&&version>0)
   controls+=button(ready?'撤回上一筆失誤':'撤回上一筆','undo');
  if(s.phase==='awaiting-result')controls+=button('確認比賽結果','confirm');
  return `<p><strong>${phase}</strong>｜第 ${Number(s.round)||0} 局</p>${cards}<p class="hint">裁判按原本的勝利方式；系統計算附魔後的實得分。</p>${scorePanel}<div class="btn-row ref-result-actions">${controls}</div>`;
 }
 function paint(code,id){
  const item=cache.get(key(code,id));
  document.querySelectorAll('[data-enchantment-referee]').forEach(el=>{
   if(el.dataset.code!==code||el.dataset.matchId!==id)return;
   const slot=el.querySelector('[data-enchantment-status]');if(!slot)return;
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
   frame.contentWindow?.postMessage({kind:first?'bxh-enchantment-init':'bxh-enchantment-state',code,matchId:id,side:frame.dataset.side,state:playerState(item.state,frame.dataset.side)},location.origin);
  });
 }

 // Public brackets created before this fix can omit playMode. Use the signed-in
 // player's confirmed registration to find the active match; the callable
 // verifies the UID and only returns an enchantment round to its participants.
 let discoveryBusy=false,lastRegistrations=0,registrations=[],dismissedRound='';
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
    if(!m)continue;
    const side=m.a.playerId===pid?'A':'B';
    let result;
    try{result=await call({action:'get',code,matchId:m.id});}catch(e){continue;}
    cache.set(key(code,m.id),{version:result.version,state:result.state});
    const s=result.state;
    const show=s?.phase==='drawing'&&!s.drawn?.[side];
    let overlay=document.querySelector('[data-enchantment-draw-overlay]');
    let reopen=document.querySelector('[data-enchantment-open]');
    if(!show){if(overlay)overlay.remove();if(reopen)reopen.remove();continue;}
    if(!reopen){
     reopen=document.createElement('button');reopen.type='button';reopen.dataset.enchantmentOpen='';
     reopen.textContent='進入抽卡｜第 '+Number(s.round)+' 局';
     reopen.style.cssText='position:fixed;right:16px;bottom:20px;z-index:2147483001;padding:13px 18px;border:1px solid #e9be69;border-radius:12px;background:#21182b;color:#fff;font-size:16px;box-shadow:0 6px 24px #0009';
     document.body.append(reopen);
    }
    reopen.textContent='進入抽卡｜第 '+Number(s.round)+' 局';
    if(dismissedRound===key(code,m.id)+':'+s.round)continue;
    if(overlay?.dataset.code===code&&overlay.dataset.matchId===m.id){reopen.style.display='none';syncFrames(code,m.id);continue;}
    if(overlay)overlay.remove();
    overlay=document.createElement('section');
    overlay.dataset.enchantmentDrawOverlay='';overlay.dataset.code=code;overlay.dataset.matchId=m.id;
    overlay.setAttribute('role','dialog');overlay.setAttribute('aria-label','附魔之戰抽卡');
    overlay.style.cssText='position:fixed;inset:0;z-index:2147483000;background:#080917;display:flex;flex-direction:column';
    overlay.innerHTML='<div style="color:white;padding:10px 16px;font-size:16px">附魔之戰｜第 '+Number(s.round)+' 局抽卡 <button type="button" data-enchantment-close style="float:right">稍後抽卡</button></div>';
    const frame=document.createElement('iframe');frame.title='附魔之戰選手抽卡';frame.dataset.enchantmentPlayer='';
    frame.dataset.code=code;frame.dataset.matchId=m.id;frame.dataset.side=side;
    frame.src='enchantment-draw-v3.html';frame.style.cssText='border:0;width:100%;flex:1;min-height:0';
    overlay.append(frame);document.body.append(overlay);
    reopen.style.display='none';
    frame.addEventListener('load',()=>syncFrames(code,m.id),{once:true});
    break;
   }
  }catch(e){/* Registration and public bracket may be temporarily unavailable. */}
  finally{discoveryBusy=false;}
 }
 document.addEventListener('click',e=>{
  if(e.target.closest('[data-enchantment-close]')){
   const overlay=document.querySelector('[data-enchantment-draw-overlay]');
   const s=overlay&&cache.get(key(overlay.dataset.code,overlay.dataset.matchId))?.state;
   if(s)dismissedRound=key(overlay.dataset.code,overlay.dataset.matchId)+':'+s.round;
   overlay?.remove();
   const reopen=document.querySelector('[data-enchantment-open]');if(reopen)reopen.style.display='';
  }
  if(e.target.closest('[data-enchantment-open]')){dismissedRound='';discoverPlayerDraw();}
 });
 setInterval(discoverPlayerDraw,7000);
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
  const d=el.dataset;if(d.enchantmentAction==='refresh')refresh(d.code,d.matchId);else operate({code:d.code,matchId:d.matchId,action:d.enchantmentAction,side:d.side,type:d.type});
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
