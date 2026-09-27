/* Partner organizer identity shell. A backend-issued grant is required before
   this mode is shown; this module does not grant privileges or create rooms. */
(function(root){
  function grant(profile){
    const value=profile&&profile.partnerOrganizer;
    return profile&&profile.active===true&&value&&typeof value==='object'&&value.status==='active'&&typeof value.organizationId==='string'&&value.organizationId.length>0&&(value.expiresAt==null||Number(value.expiresAt)>Date.now())?value:null;
  }
  function safe(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function render(profile){
    const value=grant(profile);
    if(!value)return '';
    const name=safe(value.organizationName||'合作主辦');
    return `<div class="partner-workspace"><div class="role-indicator">合作主辦｜${name} <button class="btn btn-ghost btn-sm" data-action="switch-to-player-mode">切換回玩家模式</button></div><section class="auth-card"><h2>合作主辦工作台</h2><p>此身分已開通。方案與賽事權限將由 BXH 後台設定並於此顯示。</p><p class="hint">正式開賽與積分資格需通過後端授權檢查。</p></section></div>`;
  }
  const reviewState={actor:'',contracts:null,loading:false,error:'',scheduled:false};
  function actorUid(){try{return String(root.currentAuthUid?.()||'');}catch(error){return '';}}
  function isReviewScreen(){
    try{return typeof document!=='undefined'&&root.isSuperAdmin?.()===true&&!!document.querySelector('.account-management-panel');}
    catch(error){return false;}
  }
  function reviewCard(uid){
    return [...document.querySelectorAll('.account-user-card')].find(card=>card.textContent.includes(uid))||null;
  }
  function revealReviewControls(){
    for(const contract of reviewState.contracts||[]){
      const card=reviewCard(contract.targetUid);if(!card)continue;
      const status=card.querySelector('.partner-status'),form=card.querySelector('.partner-config');
      if(status)status.value='active';
      if(form)form.hidden=false;
    }
  }
  async function loadPendingContracts(force=false){
    if(!isReviewScreen()||reviewState.loading)return;
    const actor=actorUid();if(!actor)return;
    if(reviewState.actor!==actor){reviewState.actor=actor;reviewState.contracts=null;reviewState.error='';}
    if(!force&&reviewState.contracts!==null)return;
    reviewState.loading=true;reviewState.error='';decorateReviewPanel();
    try{
      const service=root.engagementService;
      if(!service?.tournamentOperation)throw Error('service-unavailable');
      const result=await service.tournamentOperation('listPartnerContracts',{});
      if(actor!==actorUid())return;
      reviewState.contracts=Array.isArray(result?.contracts)?result.contracts:[];
      for(const contract of reviewState.contracts){
        if(!contract?.targetUid||!contract?.orderCode)continue;
        sessionStorage.setItem('bxh-partner-order:'+actor+':'+contract.targetUid,JSON.stringify({orderCode:contract.orderCode,status:contract.status}));
      }
      if(typeof root.render==='function')root.render();
    }catch(error){
      if(actor===actorUid()){reviewState.contracts=[];reviewState.error=String(error?.message||error);}
    }finally{
      reviewState.loading=false;
      setTimeout(decorateReviewPanel,0);
    }
  }
  function reviewPanelMarkup(){
    const labels={draft:'草稿待寄送',sent:'等待玩家簽署',signed:'待最高管理員確認付款'};
    const rows=reviewState.contracts||[];
    const body=reviewState.loading&&reviewState.contracts===null?'<p class="hint">正在讀取待審合約……</p>':reviewState.error?`<div class="auth-error">讀取失敗：${safe(reviewState.error)}</div>`:rows.length?`<div style="display:grid;gap:8px">${rows.map(contract=>`<div class="account-detail-item" style="display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap"><div><strong>${safe(contract.organizationName||contract.targetUid)}</strong><div class="hint">${safe(contract.orderCode)}｜${safe(contract.planCode||'')}｜${safe(labels[contract.status]||contract.status)}</div></div><button class="btn ${contract.status==='signed'?'btn-primary':'btn-ghost'} btn-sm" data-partner-review-open="${safe(contract.targetUid)}">${contract.status==='signed'?'前往確認':'查看合約'}</button></div>`).join('')}</div>`:'<div class="empty-state">目前沒有待審合作合約</div>';
    return `<div class="panel-title">待審合作合約 <span class="badge badge-gold">${rows.length}</span><button class="btn btn-ghost btn-sm" data-partner-review-refresh ${reviewState.loading?'disabled':''}>重新整理</button></div><p class="hint">合約由系統保存；重整或換裝置後仍可找回。玩家簽名後，按「前往確認」即可處理付款與成立授權。</p>${body}`;
  }
  function decorateReviewPanel(){
    if(!isReviewScreen())return;
    const host=document.querySelector('.account-management-panel');if(!host)return;
    let panel=host.querySelector('[data-partner-review-panel]');
    if(!panel){panel=document.createElement('section');panel.className='panel';panel.style.marginBottom='14px';panel.setAttribute('data-partner-review-panel','');const hint=host.querySelector(':scope > .hint');hint?.insertAdjacentElement('afterend',panel);}
    const markup=reviewPanelMarkup();
    if(panel._bxhMarkup!==markup){panel.innerHTML=markup;panel._bxhMarkup=markup;}
    revealReviewControls();
    loadPendingContracts();
  }
  function openReviewContract(uid){
    document.querySelector('[data-action="account-clear-filters"]')?.click();
    setTimeout(()=>{
      decorateReviewPanel();const card=reviewCard(uid);
      if(!card){root.showToast?.('找不到合約對應的玩家帳號',true);return;}
      card.open=true;revealReviewControls();card.scrollIntoView({behavior:'smooth',block:'start'});
      setTimeout(()=>card.querySelector('[data-action="partner-refresh-contract"]')?.focus({preventScroll:true}),350);
    },50);
  }
  const completedMailboxContracts=new Map(),mailboxContractChecks=new Set();
  function applyMailboxContractStatus(button,status){
    if(status==='sent'){
      button.disabled=false;button.removeAttribute('aria-disabled');button.textContent='閱讀合約與簽名';return;
    }
    button.disabled=true;button.setAttribute('aria-disabled','true');
    button.textContent=status==='active'?'✓ 合約已成立':'✓ 已完成簽署';
    button.title=status==='active'?'合作合約已成立':'已完成簽署，等待最高管理員確認';
  }
  function decorateMailboxContractButtons(){
    if(typeof document==='undefined')return;
    for(const button of document.querySelectorAll('[data-action="mailbox-open-contract"][data-order-code]')){
      const code=button.getAttribute('data-order-code')||'',key=actorUid()+'|'+code;
      if(!code)continue;
      if(completedMailboxContracts.has(key)){applyMailboxContractStatus(button,completedMailboxContracts.get(key));continue;}
      if(mailboxContractChecks.has(key))continue;
      mailboxContractChecks.add(key);button.disabled=true;button.textContent='確認簽署狀態中……';
      Promise.resolve(root.engagementService?.getPartnerContract?.({orderCode:code})).then(order=>{
        const status=String(order?.status||'');
        if(status&&status!=='sent')completedMailboxContracts.set(key,status);
        if(button.isConnected)applyMailboxContractStatus(button,status||'sent');
      }).catch(()=>{if(button.isConnected)applyMailboxContractStatus(button,'sent');})
        .finally(()=>mailboxContractChecks.delete(key));
    }
  }
  if(typeof document!=='undefined'){
    document.addEventListener('click',event=>{
      const refresh=event.target.closest?.('[data-partner-review-refresh]');if(refresh){loadPendingContracts(true);return;}
      const open=event.target.closest?.('[data-partner-review-open]');if(open)openReviewContract(open.getAttribute('data-partner-review-open')||'');
    });
    const observer=new MutationObserver(()=>{if(reviewState.scheduled)return;reviewState.scheduled=true;queueMicrotask(()=>{reviewState.scheduled=false;decorateReviewPanel();decorateMailboxContractButtons();});});
    const start=()=>{observer.observe(document.body,{childList:true,subtree:true});decorateMailboxContractButtons();};
    if(document.body)start();else document.addEventListener('DOMContentLoaded',start,{once:true});
  }
  const api={hasGrant:profile=>!!grant(profile),render};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.BXHPartnerOrganizer=api;
})(typeof window!=='undefined'?window:globalThis);
