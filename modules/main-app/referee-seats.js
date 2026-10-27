(function(root){
 'use strict';
 const slots=['main','backup1','backup2'],labels={main:'主裁判',backup1:'備用裁判 1',backup2:'備用裁判 2'};
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let ctx,key='',unsubscribe=null,busy=false,dialog=null,scheduled=false,expiryTimer=null;
 const notified=new Set();let incomingId=null;
 const state=()=>ctx?.state(),model=()=>state()?.meta?.refereeSeatsV1,uid=()=>ctx?.uid();
 const enabled=st=>st?.meta?.refereeSeatsV1?.version===1;
 function canScore(st,station,actor){return enabled(st)&&slots.some(slot=>st.meta.refereeSeatsV1.courts?.[station]?.[slot]?.uid===actor);}
 const eligible=()=>ctx?.eligible()===true;
 const manager=()=>ctx?.manager()===true;
 const locked=()=>!state()?.cloudCode||state()?.archiveStatus==='completed'||state()?.meta?.eventCancelled===true;
 function isCurrent(k){return k===key&&k===String(state()?.cloudCode||'')+':'+String(uid()||'');}
 function dismiss(){if(dialog){dialog.remove();dialog=null;}incomingId=null;}
 function modal(title,choices){
  if(dialog)return false;
  dialog=document.createElement('div');dialog.className='ref-seat-overlay';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label',title);
  const panel=document.createElement('div');panel.className='ref-seat-dialog';const p=document.createElement('p');p.textContent=title;panel.append(p);
  for(const choice of choices){const b=document.createElement('button');b.className='btn '+(choice.danger?'btn-danger-solid':'btn-ghost');b.textContent=choice.label;b.type='button';b.onclick=()=>{dismiss();choice.run?.();};panel.append(b);}
  dialog.onkeydown=event=>{const buttons=[...panel.querySelectorAll('button')];if(event.key==='Escape'){event.preventDefault();buttons.at(-1)?.click();}if(event.key==='Tab'){const index=buttons.indexOf(document.activeElement),next=(index+(event.shiftKey?-1:1)+buttons.length)%buttons.length;event.preventDefault();buttons[next]?.focus();}};
  dialog.append(panel);document.body.append(dialog);panel.querySelector('button')?.focus();return true;
 }
 const messages={
  'release-not-ready':'三席裁判服務尚未完成正式環境驗證，目前未啟用。','not-event-staff':'帳號尚未具備有效工作人員身分，請聯絡管理員。','seat-occupied':'此席位已被承接，請重新查看。','seat-stale':'席位已變更，請重新操作。','already-seated':'您已在本台擔任裁判，請向另一席位申請交接。',
  'request-pending':'已有交接申請等待確認，請稍後再試。','request-stale':'席位已變更或申請逾時，交接未執行。','request-unavailable':'交接申請已結束。','permission-denied':'目前沒有此操作權限。','legacy-assignments-exist':'本場已有舊版裁判分配，請先由場主確認並清空後再啟用。',
  'team-not-supported':'三席裁判制目前支援個人賽，團體賽尚未開放。','room-read-only':'此賽事目前不開放裁判異動。','invalid-seat':'此戰鬥台目前無法承接。','requester-ineligible':'申請人已失去本場資格，無法交接。','target-ineligible':'對方已失去本場資格，請由場主處理。'
 };
 async function send(data){
  if(busy||locked())return;
  const k=key,code=state().cloudCode;busy=true;ctx.render();
  try{
   const operationId=root.crypto?.randomUUID?.()||'seat-'+Date.now()+'-'+Math.random().toString(36).slice(2);
   const result=await root.cloudSync?.manageRefereeSeats?.({...data,code,operationId});
   if(!isCurrent(k))return;
   if(!result?.ok)throw new Error(result?.reason||'cloud-unavailable');
   ctx.toast(data.action==='request'?'已提出交接申請，等待對方確認':data.action==='respond'?(data.response==='accept'?'交接完成':'已取消交接'):data.action==='cancel'?'已取消交接申請':data.action==='enable'?'三席裁判制已啟用':data.action==='leave'?'已退出本台':data.action==='revoke'?'已撤銷該席位權限':'已加入本台');
  }catch(error){if(isCurrent(k))ctx.toast(messages[error.message]||'裁判席位未完成變更，請確認網路或服務狀態後重試。',true);}
  finally{if(isCurrent(k)){busy=false;ctx.render();}}
 }
 function checkRequests(){
  scheduled=false;if(!ctx||!enabled(state())||!uid()||locked()||busy)return;
  const now=Date.now(),requests=Object.values(model().requests||{});
  clearTimeout(expiryTimer);const expires= requests.filter(r=>r.status==='pending'&&r.expiresAt>now&&(r.fromUid===uid()||r.toUid===uid())).map(r=>r.expiresAt);
  if(expires.length)expiryTimer=setTimeout(()=>{checkRequests();ctx?.render();},Math.max(1,Math.min(...expires)-now+10));
  for(const r of requests){
   const token=key+':'+r.id+':'+r.status;
   if(r.fromUid===uid()&&r.status!=='pending'&&!notified.has(token)){
    notified.add(token);ctx.toast(({accepted:'交接完成',rejected:'對方取消交接',cancelled:'已取消交接申請',stale:'席位已變更，交接申請已失效',expired:'交接申請已逾時'})[r.status]||'交接申請已結束');
   }
  }
  if(incomingId){const r=model().requests?.[incomingId];if(!r||r.status!=='pending'||r.expiresAt<=now)dismiss();}
  const r=requests.find(r=>r.toUid===uid()&&r.status==='pending'&&r.expiresAt>now);
  if(r&&!dialog){
   const k=key,reply=response=>{if(isCurrent(k))send({action:'respond',station:r.station,slot:r.slot,requestId:r.id,response});};
   if(modal(`${r.fromName} 向您提出 ${r.station} 號台「${labels[r.slot]}」交接申請，是否同意？`,[{label:'確定',run:()=>reply('accept')},{label:'取消',run:()=>reply('reject')}]))incomingId=r.id;
  }
 }
 function bind(next){
  ctx=next;const k=String(state()?.cloudCode||'')+':'+String(uid()||'');
  if(k!==key){unsubscribe?.();unsubscribe=null;clearTimeout(expiryTimer);expiryTimer=null;dismiss();key=k;busy=false;
  }
  if(!unsubscribe&&state()?.cloudCode&&uid()&&ctx.operator()&&root.cloudSync?.subscribeRefereeSeats){
    const code=state().cloudCode;
    unsubscribe=root.cloudSync.subscribeRefereeSeats(code,(canonical)=>{
     if(!isCurrent(k)||!canonical?.model)return;
     if(Number(canonical.model.revision)<Number(model()?.revision||0))return;
     state().meta={...state().meta,...canonical.projection,refereeSeatsV1:canonical.model};
     ctx.render();
    });
  }
  if(!scheduled){scheduled=true;setTimeout(checkRequests,0);}
 }
 function render(st,station){
  if(!enabled(st))return '';
  const court=st.meta.refereeSeatsV1.courts?.[station]||{},readOnly=locked()||st.forcedCourtExits?.[station]?.closed;
  const buttons=slots.map(slot=>{
   const seat=court[slot],mine=seat?.uid===uid(),disabled=busy||readOnly||!eligible();
   return `<button type="button" class="ref-seat-button${mine?' mine':''}" data-seat-action="seat" data-station="${station}" data-slot="${slot}" ${disabled?'disabled':''}><span>${labels[slot]}</span><strong>${escape(seat?.name||'點此加入')}</strong>${mine?'<small>我的席位 · 點擊退出</small>':''}</button>`;
  }).join('');
  const pending=Object.values(st.meta.refereeSeatsV1.requests||{}).filter(r=>r.station===station&&r.fromUid===uid()&&r.status==='pending');
  return `<div class="ref-seat-section"><div class="ref-seat-grid">${buttons}</div>${pending.map(r=>`<div class="ref-seat-wait" role="status">${r.expiresAt>Date.now()?'等待對方確認中':'交接申請已逾時'}<button type="button" class="btn btn-ghost btn-sm" data-seat-action="cancel" data-station="${station}" data-slot="${r.slot}" data-request="${escape(r.id)}" ${busy?'disabled':''}>取消申請</button></div>`).join('')}</div>`;
 }
 function settings(){
  if(enabled(state()))return '<div class="panel"><div class="panel-title">三席裁判制</div><p class="hint">請在裁判台點選主裁判、備用裁判 1 或備用裁判 2 加入。未取得席位的工作人員僅能查看。</p></div>';
  if(!manager()||state()?.meta?.eventAuthority!=='official'||['team'].includes(state()?.meta?.battleMode)||state()?.meta?.playMode==='enchantment'||locked())return '';
  return '<div class="panel"><div class="panel-title">三席裁判制</div><p class="hint">每台一位主裁、兩位備裁自行加入，三位共同擁有該台操作權。啟用前請確認本場工作人員名單，並清空舊版裁判台分配。</p><button type="button" class="btn btn-primary" data-seat-action="enable">啟用三席裁判制</button></div>';
 }
 function click(action,station,slot,requestId){
  if(locked()||busy)return;
  if(action==='enable')return modal('啟用三席裁判制後，工作人員須加入該台席位才能計分。是否啟用？',[{label:'確定',run:()=>send({action:'enable'})},{label:'取消'}]);
  if(!eligible())return ctx.toast('帳號尚未具備有效工作人員身分，請聯絡管理員。',true);
  if(action==='cancel')return send({action:'cancel',station,slot,requestId,expectedCourtRevision:model()?.courts?.[station]?.revision||0});
  const court=model()?.courts?.[station]||{},seat=court[slot],base={station,slot,expectedCourtRevision:court.revision||0,expectedUid:seat?.uid||null};
  if(!seat)return send({...base,action:'claim'});
  if(seat.uid===uid())return modal(`是否退出 ${station} 號台${labels[slot]}？`,[{label:'確定',run:()=>send({...base,action:'leave'})},{label:'取消'}]);
  const choices=[{label:'提出權限交接',run:()=>send({...base,action:'request'})}];
  if(manager()||slot!=='main'&&court.main?.uid===uid())choices.push({label:'撤銷此席位',danger:true,run:()=>modal(`是否撤銷 ${seat.name} 的 ${station} 號台${labels[slot]}權限？`,[{label:'確定',danger:true,run:()=>send({...base,action:'revoke'})},{label:'取消'}])});
  choices.push({label:'取消'});modal(`${station} 號台${labels[slot]}：${seat.name}`,choices);
 }
 if(typeof document!=='undefined')document.addEventListener('click',event=>{
  const b=event.target.closest?.('[data-seat-action]');if(!b)return;event.preventDefault();event.stopImmediatePropagation();if(b.disabled)return;
  click(b.dataset.seatAction,Number(b.dataset.station),b.dataset.slot,b.dataset.request);
 },true);
 if(typeof document!=='undefined')document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkRequests();});
 root.BXHRefereeSeats={bind,render,settings,enabled,canScore,click};
})(typeof window!=='undefined'?window:globalThis);
