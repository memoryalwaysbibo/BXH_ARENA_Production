(function(){
// Core Phase 2A — Mailbox feature module.
// Feature-level extraction: state, rendering and service actions stay together.
let mailboxState=null;
function mailboxContext(){
  const key=currentAuthUid()+':'+engagementSessionEpoch;
  if(!mailboxState||mailboxState.key!==key)mailboxState={key,open:false,loading:false,busy:false,messages:null,unreadCount:0,selectedId:'',error:'',lastSent:null};
  return mailboxState;
}

function mailboxError(error){
  const raw=String(error?.message||error||'');
  const map={'mail-not-found':'找不到這封信，可能已被移除。','recipient-not-found':'找不到指定玩家帳號。','recipient-inactive':'指定玩家帳號目前不可使用。','super-admin-required':'只有最高管理員可以發送系統信。','invalid-subject':'信件標題請輸入 1～80 字。','invalid-body':'信件內容請輸入 1～2000 字。','operation-conflict':'這次寄送識別碼與先前內容不一致，請重新操作。','auth-required':'請重新登入後再查看站內信。','service-unavailable':'站內信服務尚未部署。'};
  for(const [key,value] of Object.entries(map))if(raw.includes(key))return value;
  return '站內信暫時無法連線，請稍後重試。';
}
async function loadMailbox(force=false){
  const c=mailboxContext();
  if(!firebaseUser?.uid||c.busy||(!force&&Array.isArray(c.messages)))return;
  // A read-state change may finish while an older list is still in flight.
  // Coalesce its refresh and never paint that obsolete list over the new state.
  if(c.loading){if(force)c.reloadRequested=true;return c.loadPromise;}
  c.loading=true;c.error='';render();
  c.loadPromise=(async()=>{
    try{
      do{
        c.reloadRequested=false;
        try{
          if(!window.engagementService?.mailbox)throw Error('service-unavailable');
          const result=await window.engagementService.mailbox({action:'list'});
          if(c!==mailboxContext())return;
          if(c.reloadRequested)continue;
          if(!result?.ok)throw Error('load-failed');
          c.messages=Array.isArray(result.messages)?result.messages:[];
          c.unreadCount=Math.max(0,Number(result.unreadCount)||0);
          if(c.selectedId&&!c.messages.some(m=>m.id===c.selectedId))c.selectedId='';
        }catch(error){if(c===mailboxContext()&&!c.reloadRequested)c.error=mailboxError(error);}
      }while(c===mailboxContext()&&c.reloadRequested);
    }finally{
      // Clear loading before this promise settles, so a simultaneous mutation
      // cannot queue its refresh against an already-completed request.
      if(c===mailboxContext()){c.loading=false;render();}
    }
  })();
  return c.loadPromise;
}

function mailboxVisibleAttachments(message){
  const items=Array.isArray(message?.attachments)?message.attachments:[];
  return items.filter(item=>!window.BXHCardRewardUI?.isVirtualAttachment?.(message,item));
}
function mailboxButtonHtml(){
  const c=mailboxContext();
  return `<button class="mailbox-trigger ${c.open?'active':''}" data-action="mailbox-open" aria-label="站內信${c.unreadCount?'，'+c.unreadCount+'封未讀':''}"><span aria-hidden="true">✉️</span><span class="mailbox-label">站內信</span>${c.unreadCount?`<span class="mailbox-unread">${c.unreadCount>99?'99+':c.unreadCount}</span>`:''}</button>`;
}
function mailboxDomId(messageId){
  return 'mailbox-message-'+Array.from(String(messageId)).map(char=>char.codePointAt(0).toString(16)).join('-');
}
function renderMailboxDetail(selected,c){
  return `<div class="panel-title">${esc(selected.subject||'系統通知')}</div><p class="hint">${esc(selected.senderName||'BXH ARENA')}｜${esc(mailboxDate(selected.createdAt))}</p><div class="mailbox-body">${esc(window.BXHCardRewardUI?.bodyText?.(selected)??selected.body??'')}</div>${window.BXHTitleRewardUI?.card(selected,c.busy)||''}${window.BXHCardRewardUI?.card(selected,c.busy)||''}${mailboxVisibleAttachments(selected).length?`<div class="mailbox-attachments" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><p class="hint" style="width:100%;margin:0">附件</p>${mailboxVisibleAttachments(selected).map(item=>`<button class="btn btn-ghost btn-sm" data-action="mailbox-download-attachment" data-message-id="${esc(selected.id)}" data-attachment-id="${esc(item.id)}" ${c.busy?'disabled':''}>⬇ ${esc(item.name||'下載附件')} (${Math.ceil((Number(item.size)||0)/1024)} KB)</button>`).join('')}</div>`:''}${selected.orderCode&&selected.id==='partner_'+selected.orderCode?`<div class="btn-row" style="margin-top:12px"><button class="btn btn-primary" data-action="mailbox-open-contract" data-order-code="${esc(selected.orderCode)}">閱讀合約與簽名</button></div>`:''}${selected.eventCode&&selected.invitationStatus==='invited'?`<div class="btn-row" style="margin-top:12px"><button class="btn btn-primary" data-action="mailbox-event-staff-respond" data-event-code="${esc(selected.eventCode)}" data-response="accept">接受工作人員（活動）邀請</button><button class="btn btn-ghost" data-action="mailbox-event-staff-respond" data-event-code="${esc(selected.eventCode)}" data-response="reject">拒絕</button></div>`:selected.eventCode&&selected.invitationStatus?`<div class="banner" style="margin-top:12px"><span>邀請狀態：${esc(({accepted:'已接受',rejected:'已拒絕',revoked:'已撤銷'})[selected.invitationStatus]||selected.invitationStatus)}</span></div>`:''}<div class="btn-row" style="margin-top:16px"><button class="btn btn-ghost" data-action="mailbox-toggle-read" data-message-id="${esc(selected.id)}" data-read="${selected.readAt?'1':'0'}" ${c.busy?'disabled':''}>標記為${selected.readAt?'未讀':'已讀'}</button></div>`;
}
// Keep .panel on the expanded article only: invitation controls mount there.
function renderMailboxEntry(message,c){
  const expanded=message.id===c.selectedId,id=mailboxDomId(message.id);
  return `<div class="mailbox-entry"><button type="button" id="${id}" class="mailbox-item ${message.readAt?'':'unread'} ${expanded?'active':''}" data-action="mailbox-select" data-message-id="${esc(message.id)}" aria-expanded="${expanded}" aria-controls="${id}-detail"><span class="mailbox-item-heading"><span class="mailbox-item-title">${message.readAt?'':'● '}${esc(message.subject||'系統通知')}</span><span class="mailbox-item-toggle" aria-hidden="true">${expanded?'收合 ▴':'展開 ▾'}</span></span><span class="mailbox-item-meta"><span>${esc(message.senderName||'BXH ARENA')}</span><span>${esc(mailboxDate(message.createdAt))}</span></span></button><article id="${id}-detail" class="${expanded?'panel ':''}mailbox-detail" aria-labelledby="${id}" ${expanded?'':'hidden'}>${expanded?renderMailboxDetail(message,c):''}</article></div>`;
}
// Core replaces the entire screen on each render. Keep the selected row and
// keyboard focus in place, including when a previous expanded row collapses.
function captureViewport(){
  const c=mailboxContext();
  if(!c.open||typeof document==='undefined')return null;
  const id=c.viewportAnchorId||c.selectedId;delete c.viewportAnchorId;
  const anchor=id?document.getElementById(mailboxDomId(id)):null;
  const active=document.activeElement;
  const focus=active?.closest?.('[data-mailbox-page]')&&active.matches('[data-action]')
    ?['data-action','data-message-id','data-attachment-id','data-response'].map(name=>[name,active.getAttribute(name)]):null;
  return {context:c,id,top:anchor?.getBoundingClientRect().top,focus};
}
function restoreViewport(snapshot){
  if(!snapshot||snapshot.context!==mailboxContext()||!snapshot.context.open||typeof document==='undefined')return false;
  if(snapshot.focus){
    const focus=snapshot.focus;snapshot.focus=null;
    // Do not steal focus if the user has already moved to another control.
    if(!document.activeElement||document.activeElement===document.body){
      const control=Array.from(document.querySelectorAll('[data-mailbox-page] [data-action]'))
        .find(node=>focus.every(([name,value])=>node.getAttribute(name)===value));
      control?.focus({preventScroll:true});
    }
  }
  const anchor=snapshot.id?document.getElementById(mailboxDomId(snapshot.id)):null;
  if(!anchor||!Number.isFinite(snapshot.top))return false;
  const delta=anchor.getBoundingClientRect().top-snapshot.top;
  if(Math.abs(delta)>.5)window.scrollTo({left:window.scrollX||0,top:(window.scrollY||0)+delta,behavior:'instant'});
  return true;
}
function renderMailboxPage(){
  const c=mailboxContext(),messages=c.messages||[];
  return `<section class="panel" data-mailbox-page><div class="panel-title"><span>✉️ 站內信</span><div class="btn-row">${isSuperAdmin()?`<button class="btn btn-primary btn-sm" data-action="mailbox-self-card-test" ${c.busy?"disabled":""}>🎴 發送測試卡給我</button>`:""}<button class="btn btn-ghost btn-sm" data-action="mailbox-refresh" ${c.loading||c.busy?'disabled':''}>重新整理</button><button class="btn btn-ghost btn-sm" data-action="mailbox-close">返回賽事大廳</button></div></div>
    <p class="hint">未讀 ${c.unreadCount} 封｜系統通知、活動及中獎訊息會集中在這裡。</p>
    ${c.error?`<div class="auth-error" role="alert">${esc(c.error)}</div>`:''}
    ${c.loading&&!c.messages?'<div class="empty-state">正在載入站內信……</div>':`<div class="mailbox-layout"><div class="mailbox-list" aria-busy="${c.loading}">${messages.length?messages.map(message=>renderMailboxEntry(message,c)).join(''):'<div class="empty-state">目前沒有站內信。</div>'}</div></div>`}
    ${isSuperAdmin()?`<details class="panel" style="margin-top:14px"><summary style="cursor:pointer;font-weight:700">最高管理員｜發送測試信</summary><div class="grid grid-2 mailbox-compose-grid" style="margin-top:14px"><div class="field"><label>玩家 UID</label><input id="mailbox-recipient" maxlength="128" placeholder="貼上 Firebase UID"></div><div class="field"><label>信件標題</label><input id="mailbox-subject" maxlength="80" placeholder="例如：站內信測試"></div><div class="field" style="grid-column:1/-1"><label>信件內容</label><textarea id="mailbox-body" maxlength="2000" placeholder="輸入通知內容"></textarea></div></div><button class="btn btn-primary" data-action="mailbox-send-test" ${c.busy?'disabled':''}>發送測試信</button><p class="hint">本階段以 UID 測試寄送；活動中獎通知會在抽獎模組串接。</p>${c.lastSent?`<div class="panel" style="margin-top:14px"><strong>為剛寄出的信件新增附件</strong><p class="hint">收件者 ${esc(c.lastSent.targetUid)}｜信件 ${esc(c.lastSent.messageId)}｜PDF、PNG、JPG、TXT，單檔最多 2 MB</p><input id="mailbox-attachment-file" type="file" accept=".pdf,.png,.jpg,.jpeg,.txt,application/pdf,image/png,image/jpeg,text/plain"><button class="btn btn-ghost btn-sm" data-action="mailbox-upload-attachment" ${c.busy?'disabled':''}>上傳附件</button></div>`:''}</details>`:''}
  </section>`;
}
async function openMailboxPartnerContract(orderCode){
  const actor=currentAuthUid(),context=mailboxContext();
  let order;
  try{order=await window.engagementService.getPartnerContract({orderCode});}
  catch(error){context.error=mailboxError(error);render();return;}
  if(actor!==currentAuthUid()||context!==mailboxContext())return;
  const overlay=document.createElement('div');
  overlay.style.cssText='position:fixed;inset:0;z-index:2147483640;background:rgba(0,0,0,.82);display:flex;justify-content:center;align-items:center;padding:12px';
  overlay.innerHTML=`<section role="dialog" aria-modal="true" aria-label="合作合約" style="background:#1c2029;color:#fff;width:min(680px,100%);max-height:94vh;overflow:auto;padding:18px;border-radius:12px">
    <div style="display:flex;justify-content:space-between;gap:12px"><strong>合作主辦合約｜${esc(order.orderCode)}</strong><button type="button" class="btn btn-ghost btn-sm" data-close>關閉</button></div>
    <p>合作方：${esc(order.organizationName)}｜方案：${esc(order.planName||order.planCode)}｜金額 NT$ ${esc(order.amountTwd)}</p>
    <p>方案內容（版本 ${esc(order.planVersion||1)}）</p><div style="white-space:pre-wrap;padding:12px;border:1px solid #666;border-radius:8px">${esc(order.planDetails||'未提供')}</div>
    <p>期間：${esc(order.startsAt)} 至 ${esc(order.expiresAt)}</p>
    <p class="hint">條款版本 ${esc(order.termsVersion)}｜狀態 ${esc(order.status)}</p>
    <p>完整合約條款</p><div style="white-space:pre-wrap;max-height:35vh;overflow:auto;padding:12px;border:1px solid #666;border-radius:8px">${esc(order.terms)}</div>
    ${order.status==='sent'?`<p>閱讀完整條款後，在下方以手指簽名。</p><div data-signature></div>
      <label style="display:block;margin:12px 0"><input type="checkbox" data-accept> 我已閱讀並同意上述版本的完整合約條款</label>
      <p data-error role="alert" style="color:#ff9c9c"></p><button type="button" class="btn btn-primary" data-submit>確認簽署並送出</button>`:'<p class="hint">這份合約目前不能簽署。可向管理員確認目前流程狀態。</p>'}
  </section>`;
  document.body.appendChild(overlay);
  let pad=null;
  try{if(order.status==='sent')pad=window.BXHPartnerSignaturePad.mount(overlay.querySelector('[data-signature]'));}
  catch(error){overlay.remove();context.error='手機簽名板無法載入，請重新整理';render();return;}
  const close=()=>{pad?.destroy();overlay.remove();};
  overlay.querySelector('[data-close]').addEventListener('click',close);
  overlay.querySelector('[data-submit]')?.addEventListener('click',async event=>{
    const errorNode=overlay.querySelector('[data-error]');
    if(!overlay.querySelector('[data-accept]').checked){errorNode.textContent='請先閱讀並勾選同意條款';return;}
    if(!pad?.hasInk()){errorNode.textContent='請先在簽名板簽名';return;}
    const button=event.currentTarget;button.disabled=true;errorNode.textContent='';
    try{
      await window.engagementService.signPartnerContract({orderCode:order.orderCode,termsHash:order.termsHash,
        termsVersion:order.termsVersion,accepted:true,signatureDataUrl:pad.exportPng()});
      if(actor!==currentAuthUid())return;
      close();showToast('合約已簽署，等待最高管理員確認');context.messages=null;loadMailbox(true);
    }catch(error){errorNode.textContent='簽署失敗：'+String(error.message||error);button.disabled=false;}
  });
}
async function handleMailbox(action,target){
  const c=mailboxContext();if(!firebaseUser?.uid||c.busy)return;
  if(action==='mailbox-open'){c.open=true;accountMenuOpen=false;render();loadMailbox(true);return;}
  if(action==='mailbox-close'){c.open=false;c.selectedId='';render();return;}
  if(action==='mailbox-refresh'){loadMailbox(true);return;}
  if(action==='mailbox-select'){
    const selectedId=target.getAttribute('data-message-id')||'';
    const message=(c.messages||[]).find(m=>m.id===selectedId);if(!message)return;
    c.viewportAnchorId=selectedId;
    if(c.selectedId===selectedId){c.selectedId='';render();return;}
    c.selectedId=selectedId;render();
    if(message&&message.type==='card_reward'&&!message.reward&&window.engagementService?.getCardRewardMessage){
      const selectedId=c.selectedId;
      window.engagementService.getCardRewardMessage({messageId:selectedId}).then(result=>{
        if(c!==mailboxContext()||c.selectedId!==selectedId||!result?.ok||!result.message?.reward)return;
        const current=(c.messages||[]).find(m=>m.id===selectedId);if(current)current.reward=result.message.reward;
        render();
      }).catch(()=>{});
    }
    if(message&&!message.readAt)handleMailbox('mailbox-toggle-read',target);return;
  }
  if(action==='mailbox-self-card-test'){
    c.busy=true;c.error='';render();
    try{
      const result=await window.engagementService.cardAlbum({action:'issueSelfTestPack'});
      if(!result?.ok)throw Error('test-card-failed');
      c.messages=null;c.selectedId='';c.busy=false;
      await loadMailbox(true);showToast(result.replayed?'今天的測試卡包已存在':'諸神戰場測試卡包已送達站內信');
    }catch(error){c.error=mailboxError(error);}
    finally{c.busy=false;render();}
    return;
  }
  if(action==='mailbox-card-reward'){
    // Core may retain this pre-bridge handler; claims must use session guards.
    const current=window.BXHMailbox?.handleMailbox;
    if(typeof current==='function'&&current!==handleMailbox)return current(action,target);
    const messageId=target.getAttribute('data-message-id')||'';
    const message=(c.messages||[]).find(item=>item.id===messageId)||null;
    c.busy=true;c.error='';render();
    try{
      if(!window.BXHCardRewardUI)throw Error('service-unavailable');
      await window.BXHCardRewardUI.claim(messageId,message);
      if(window.BXHCardAlbumFeature?.loadCardAlbum)void window.BXHCardAlbumFeature.loadCardAlbum(true);
      c.messages=null;c.busy=false;await loadMailbox(true);
      showToast('卡牌已領取並收入我的卡冊');
    }catch(error){c.error=mailboxError(error);}
    finally{c.busy=false;render();}
    return;
  }
  if(action==='mailbox-title-reward'){
    const messageId=target.getAttribute('data-message-id')||'',replay=target.getAttribute('data-replay')==='1';
    c.busy=true;c.error='';render();
    try{
      if(!window.BXHTitleRewardUI||!window.engagementService?.claimTitleReward)throw Error('service-unavailable');
      await window.BXHTitleRewardUI.open(messageId,replay);
      c.messages=null;c.busy=false;await loadMailbox(true);
    }catch(error){c.error=mailboxError(error);}
    finally{c.busy=false;render();}
    return;
  }
  if(action==='mailbox-open-contract'){openMailboxPartnerContract(target.getAttribute('data-order-code'));return;}
  if(action==='mailbox-event-staff-respond'){
    const eventCode=target.getAttribute('data-event-code'),response=target.getAttribute('data-response');
    c.busy=true;c.error='';render();
    try{
      await window.engagementService.eventStaff({action:'respond',eventCode,response});
      const fresh=await window.cloudAuth.getUserProfile(firebaseUser.uid);if(fresh)userProfile=fresh;
      c.messages=null;c.selectedId='';c.busy=false;showToast(response==='accept'?'已接受工作人員（活動）邀請':'已拒絕邀請');
      await loadMailbox(true);
    }catch(error){c.error=mailboxError(error);}
    finally{c.busy=false;render();}
    return;
  }
  if(action==='mailbox-download-attachment'){
    const messageId=target.getAttribute('data-message-id'),attachmentId=target.getAttribute('data-attachment-id');
    c.busy=true;c.error='';render();
    try{
      if(!window.engagementService?.mailboxAttachment)throw Error('service-unavailable');
      const result=await window.engagementService.mailboxAttachment({action:'download',messageId,attachmentId});
      if(c!==mailboxContext())return;
      if(!result?.ok||!result.base64)throw Error('attachment-not-found');
      const bytes=Uint8Array.from(atob(result.base64),character=>character.charCodeAt(0));
      const url=URL.createObjectURL(new Blob([bytes],{type:result.mime||'application/octet-stream'}));
      const link=document.createElement('a');link.href=url;link.download=result.name||'附件';
      document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    }catch(error){if(c===mailboxContext())c.error=mailboxError(error);}
    finally{if(c===mailboxContext()){c.busy=false;render();}}
    return;
  }
  if(action==='mailbox-upload-attachment'){
    const sent=c.lastSent,file=document.getElementById('mailbox-attachment-file')?.files?.[0];
    if(!sent||!file){showToast('請先選擇附件',true);return;}
    const mime=({pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',txt:'text/plain'})[file.name.split('.').pop().toLowerCase()]||file.type;
    if(file.size<1||file.size>2*1024*1024||!['application/pdf','image/png','image/jpeg','text/plain'].includes(mime)){
      showToast('僅支援 PDF、PNG、JPG、TXT，單檔最多 2 MB',true);return;
    }
    c.busy=true;c.error='';render();
    try{
      const base64=await new Promise((resolve,reject)=>{
        const reader=new FileReader();reader.onerror=()=>reject(Error('file-read-failed'));
        reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');reader.readAsDataURL(file);
      });
      if(!window.engagementService?.mailboxAttachment)throw Error('service-unavailable');
      const result=await window.engagementService.mailboxAttachment({action:'upload',targetUid:sent.targetUid,
        messageId:sent.messageId,operationId:crypto.randomUUID(),name:file.name,mime,base64});
      if(c!==mailboxContext())return;
      if(!result?.ok)throw Error('attachment-upload-failed');
      showToast('附件已加到該封站內信');
    }catch(error){if(c===mailboxContext())c.error=mailboxError(error);}
    finally{if(c===mailboxContext()){c.busy=false;render();}}
    return;
  }
  let payload;
  if(action==='mailbox-toggle-read')payload={action:target.getAttribute('data-read')==='1'?'markUnread':'markRead',messageId:target.getAttribute('data-message-id'),operationId:crypto.randomUUID()};
  else if(action==='mailbox-send-test'){
    const targetUid=(document.getElementById('mailbox-recipient')?.value||'').trim(),subject=(document.getElementById('mailbox-subject')?.value||'').trim(),body=(document.getElementById('mailbox-body')?.value||'').trim();
    if(!targetUid||!subject||!body){showToast('請完整填寫玩家 UID、標題與內容',true);return;}
    if(!confirm(`確認發送「${subject}」給指定玩家？`))return;
    payload={action:'send',targetUid,subject,body,type:'test',operationId:crypto.randomUUID()};
  }else return;
  c.busy=true;c.error='';render();
  try{
    if(!window.engagementService?.mailbox)throw Error('service-unavailable');
    const result=await window.engagementService.mailbox(payload);if(c!==mailboxContext())return;if(!result?.ok)throw Error('operation-failed');
    if(action==='mailbox-send-test'){c.lastSent={targetUid:payload.targetUid,messageId:result.messageId};showToast(result.replayed?'這封測試信先前已送出':'測試信已送出');}
    c.busy=false;const refresh=loadMailbox(true);c.busy=true;
    await refresh;
  }catch(error){if(c===mailboxContext())c.error=mailboxError(error);}
  finally{if(c===mailboxContext()){c.busy=false;render();}}
}

Object.assign(window.BXHMailbox||(window.BXHMailbox={}),{mailboxContext,mailboxError,loadMailbox,mailboxVisibleAttachments,mailboxButtonHtml,renderMailboxPage,captureViewport,restoreViewport,openMailboxPartnerContract,handleMailbox});

})();
