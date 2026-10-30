/* Partner organizer identity shell. A backend-issued grant is required before
   this mode is shown; this module does not grant privileges or create rooms. */
(function(root){
  function grant(profile){
    const value=profile&&profile.partnerOrganizer;
    if(!profile||profile.active!==true||profile.role!=='player'||profile.isTestAccount===true
      ||profile.deleted===true||['deleted','disabled','frozen'].includes(profile.accountStatus)
      ||!value||typeof value!=='object'||value.status!=='active'
      ||typeof value.organizationId!=='string'||!value.organizationId.trim())return null;
    const timestamp=raw=>{
      if(typeof raw!=='number'&&typeof raw!=='string')return NaN;
      if(typeof raw==='string'&&!raw.trim())return NaN;
      const numeric=Number(raw);
      return Number.isFinite(numeric)?numeric:Date.parse(raw);
    };
    const rawStart=value.startsAtMs??value.startsAt;
    const start=rawStart==null?(value.scope==='contract'?NaN:0):timestamp(rawStart);
    const expiry=timestamp(value.expiresAtMs??value.expiresAt);
    const now=Date.now();
    return Number.isFinite(start)&&start>=0&&start<=now&&Number.isFinite(expiry)&&expiry>now&&expiry>start?value:null;
  }
  function safe(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function render(profile){
    const value=grant(profile);
    if(!value)return '';
    const name=safe(value.organizationName||'合作主辦');
    const orderCode=value.orderCode||value.contractOrderCode||profile.partnerContractOrderCode||'';
    const quota=orderCode?`<p class="hint" data-partner-room-quota="${safe(orderCode)}" role="status">開房次數｜讀取中……</p>`:'<p class="hint">目前為手動授權；尚無合約場次紀錄。</p>';
    return `<div class="partner-workspace"><div class="role-indicator">合作主辦｜${name} <button class="btn btn-ghost btn-sm" data-action="switch-to-player-mode">切換回玩家模式</button></div><section class="auth-card"><h2>合作主辦工作台</h2>${quota}<p>此身分已開通。方案與賽事權限將由 BXH 後台設定並於此顯示。</p><p class="hint">正式開賽與積分資格需通過後端授權檢查。</p></section></div>`;
  }
  const quotaState={orderCode:'',actor:'',loading:false,used:null,total:null,error:'',generation:0,key:'',contract:null};
  function currentGrant(){try{return root.partnerOrganizerGrant?.()||null;}catch(error){return null;}}
  function grantKey(value){return JSON.stringify([value?.organizationId,value?.orderCode||value?.contractOrderCode||'',value?.scope,value?.startsAtMs??value?.startsAt,value?.expiresAtMs??value?.expiresAt]);}
  function resetQuota(orderCode='',actor='',key=''){
    Object.assign(quotaState,{orderCode,actor,key,loading:false,used:null,total:null,error:'',contract:null,generation:quotaState.generation+1});
  }
  function dateLabel(value){
    if(value==null||value==='')return '未設定';
    const n=Number(value),date=new Date(Number.isFinite(n)?n:value);
    return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(date):'未設定';
  }
  function overviewBody(value,orderCode){
    const contract=quotaState.contract;
    const ready=orderCode&&quotaState.total!==null&&!quotaState.loading&&!quotaState.error;
    const remaining=ready?Math.max(0,quotaState.total-quotaState.used):null;
    const status=!orderCode?(value.scope==='contract'?'合約待核對':'手動授權'):quotaState.loading?'讀取中':quotaState.error?'待核對':ready?(remaining===0?'場次已用完':'合約已啟用'):'讀取中';
    const stats=[['授權總場次',ready?quotaState.total+' 場':'—'],['已使用',ready?quotaState.used+' 場':'—'],['剩餘可開',ready?remaining+' 場':'—']];
    const notice=!orderCode?(value.scope==='contract'?'合作授權缺少合約編號，無法查閱剩餘場次。請聯絡 BXH 核對合約綁定。':'目前為手動授權，未綁定合約，場次額度未設定；不代表剩餘 0 場或無限場次。請聯絡 BXH 核對授權內容。')
      :quotaState.error?quotaState.error:!ready?'正在向雲端確認合約與剩餘場次……':remaining===0?'合約可開場次已用完，請聯絡 BXH 確認後續方案。':'成功建立雲端房間後才使用 1 場；實際建房仍以雲端授權檢查為準。';
    return `<div class="panel-title" style="display:flex;gap:12px;justify-content:space-between;align-items:center;flex-wrap:wrap"><span>我的合作方案</span><span class="badge badge-gold">${safe(status)}</span></div>
      <p style="overflow-wrap:anywhere"><strong>${safe(value.organizationName||value.organizationId)}</strong> · 方案 ${safe(contract?.planName||contract?.planCode||value.planCode||value.plan||'未設定')}</p>
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px">${stats.map(([label,n])=>`<div class="stat-box" style="min-width:0"><div class="label">${label}</div><div class="value small" style="overflow-wrap:anywhere">${n}</div></div>`).join('')}</div>
      <p class="hint">合作期限（台灣時間）：${safe(dateLabel(value.startsAtMs??value.startsAt))} ～ ${safe(dateLabel(value.expiresAtMs??value.expiresAt))}</p>
      ${orderCode?`<p class="hint" style="overflow-wrap:anywhere">合約編號：${safe(orderCode)}</p>`:''}
      <p class="${quotaState.error?'auth-error':'hint'}" role="status">${safe(notice)}</p>
      <div class="btn-row">${orderCode?`${value.scope==='contract'?'<button type="button" class="btn btn-primary btn-sm" data-action="switch-tab" data-tab="partner-quota">購買場次</button><button type="button" class="btn btn-ghost btn-sm" data-action="switch-tab" data-tab="partner-orders">我的訂單</button>':''}<button type="button" class="btn btn-ghost btn-sm" data-partner-quota-refresh ${quotaState.loading?'disabled':''}>重新整理場次</button><button type="button" class="btn btn-ghost btn-sm" data-partner-own-contract ${!contract||quotaState.loading||quotaState.error?'disabled':''}>查看合約</button>`:''}</div>`;
  }
  function renderOverview(profile){
    const value=grant(profile);if(!value)return '';
    const orderCode=value.orderCode||value.contractOrderCode||profile.partnerContractOrderCode||'';
    const actor=actorUid(),key=grantKey(value);
    if(quotaState.orderCode!==orderCode||quotaState.actor!==actor||quotaState.key!==key)resetQuota(orderCode,actor,key);
    return `<section class="panel" aria-label="我的合作方案" data-partner-overview data-partner-order="${safe(orderCode)}">${overviewBody(value,orderCode)}</section>`;
  }
  function quotaError(error){
    const code=String(error?.code||error?.message||'');
    if(/permission-denied|unauthenticated/.test(code))return '目前無法讀取合作合約。請確認登入狀態，或聯絡 BXH 核對授權；這不代表剩餘場次為 0。';
    if(/quota-invalid/.test(code))return '合約場次資料待核對，暫時無法顯示餘額。請聯絡 BXH。';
    if(/contract-inactive/.test(code))return '合作合約尚未啟用或已停止，請聯絡 BXH 核對合約狀態。';
    return '場次讀取失敗，請重新整理場次；若仍失敗，請聯絡 BXH。';
  }
  function validQuota(contract,orderCode,actor){
    if(contract?.orderCode!==orderCode||contract.targetUid!==actor)throw Error('quota-invalid');
    if(contract.status!=='active')throw Error('contract-inactive');
    if(!Number.isSafeInteger(contract.includedEvents)||contract.includedEvents<0||!Number.isSafeInteger(contract.usedEvents)||contract.usedEvents<0||contract.usedEvents>contract.includedEvents)throw Error('quota-invalid');
    return {total:contract.includedEvents,used:contract.usedEvents};
  }
  function decorateQuota(){
    const panel=document.querySelector('[data-partner-overview]');
    const label=document.querySelector('[data-partner-room-quota]');
    const value=currentGrant(),actor=actorUid();
    if(!value||!actor){if(quotaState.actor)resetQuota();ownContractClose?.();return;}
    if(ownContractContext&&ownContractContext!==actor+'|'+grantKey(value))ownContractClose?.();
    if(!panel&&!label)return;
    const orderCode=(panel?.getAttribute('data-partner-order')||label?.getAttribute('data-partner-room-quota'))||'';
    const key=grantKey(value);
    if(quotaState.orderCode!==orderCode||quotaState.actor!==actor||quotaState.key!==key)resetQuota(orderCode,actor,key);
    if(panel){const html=overviewBody(value,orderCode);if(panel._quotaMarkup!==html){panel.innerHTML=html;panel._quotaMarkup=html;}}
    if(!orderCode)return;
    const display=quotaState.error?`開房次數｜讀取失敗：${quotaState.error}`:quotaState.total===null?'開房次數｜讀取中……':`開房次數｜剩餘 ${Math.max(0,quotaState.total-quotaState.used)} / ${quotaState.total} 場（已使用 ${quotaState.used} 場）`;
    if(label&&label.textContent!==display)label.textContent=display;
    if(quotaState.loading||quotaState.total!==null||quotaState.error)return;
    quotaState.loading=true;const generation=quotaState.generation;
    const current=()=>quotaState.orderCode===orderCode&&quotaState.actor===actor&&actorUid()===actor&&quotaState.generation===generation&&currentGrant()&&grantKey(currentGrant())===key;
    Promise.resolve().then(()=>{if(typeof root.engagementService?.getPartnerContract!=='function')throw Error('service-unavailable');return root.engagementService.getPartnerContract({orderCode});}).then(contract=>{
      if(!current())return;
      const counts=validQuota(contract,orderCode,actor);
      quotaState.total=counts.total;quotaState.used=counts.used;quotaState.contract=contract;
    }).catch(error=>{if(current())quotaState.error=quotaError(error);})
      .finally(()=>{if(quotaState.orderCode===orderCode&&quotaState.actor===actor&&quotaState.generation===generation){quotaState.loading=false;decorateQuota();}});
  }
  function refreshQuota(){resetQuota(quotaState.orderCode,actorUid(),grantKey(currentGrant()));decorateQuota();}
  let ownContractClose=null,ownContractContext='';
  function openOwnContract(){
    const contract=quotaState.contract,value=currentGrant();
    if(!value||!contract||quotaState.loading||quotaState.error||quotaState.actor!==actorUid()||quotaState.key!==grantKey(value))return;
    ownContractClose?.();
    const overlay=document.createElement('div');overlay.setAttribute('data-partner-own-contract-dialog','');
    overlay.style.cssText='position:fixed;inset:0;z-index:2147483640;background:rgba(0,0,0,.82);display:flex;align-items:center;justify-content:center;padding:16px';
    overlay.innerHTML=`<section role="dialog" aria-modal="true" aria-label="我的合作合約" style="width:min(100%,620px);max-height:88vh;overflow:auto;padding:24px;border:1px solid #bd953d;border-radius:16px;background:var(--bg,#1e2029);color:var(--text,#fff);overflow-wrap:anywhere"><h2>我的合作合約</h2><p>合約編號：${safe(contract.orderCode)}</p><p>合作方：${safe(contract.organizationName||value.organizationName||value.organizationId)}</p><p>方案：${safe(contract.planName||contract.planCode||value.plan||'未設定')}</p><p>合作期限（台灣時間）：${safe(dateLabel(contract.startsAt??value.startsAtMs??value.startsAt))} ～ ${safe(dateLabel(contract.expiresAt??value.expiresAtMs??value.expiresAt))}</p><p>總共 ${quotaState.total} 場 · 已使用 ${quotaState.used} 場 · 剩餘 ${quotaState.total-quotaState.used} 場</p><h3>合約條款</h3><div style="white-space:pre-wrap">${safe(contract.terms||contract.planDetails||'此合約未提供條款，請聯絡 BXH。')}</div><button type="button" class="btn btn-ghost" data-partner-own-contract-close style="margin-top:16px">關閉</button></section>`;
    const previous=document.activeElement;
    function close(){overlay.remove();document.removeEventListener('keydown',onKey);ownContractClose=null;ownContractContext='';if(previous?.isConnected)previous.focus?.();}
    function onKey(event){if(event.key==='Escape'){close();return;}if(event.key==='Tab'){event.preventDefault();overlay.querySelector('button')?.focus();}}
    overlay.addEventListener('click',event=>{if(event.target===overlay||event.target.closest?.('[data-partner-own-contract-close]'))close();});
    ownContractClose=close;ownContractContext=actorUid()+'|'+grantKey(value);
    document.addEventListener('keydown',onKey);document.body.appendChild(overlay);overlay.querySelector('button')?.focus();
  }
  const reviewState={actor:'',contracts:null,loading:false,error:'',scheduled:false};
  function actorUid(){try{return String(root.currentAuthUid?.()||'');}catch(error){return '';}}
  function isReviewScreen(){
    try{return typeof document!=='undefined'&&root.isSuperAdmin?.()===true&&!!document.querySelector('.account-management-panel');}
    catch(error){return false;}
  }
  function reviewCard(uid){
    return [...document.querySelectorAll('.account-user-card')].find(card=>card.querySelector('.account-batch-checkbox')?.getAttribute('data-uid')===uid)||null;
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
    const body=reviewState.loading&&reviewState.contracts===null?'<p class="hint">正在讀取待審合約……</p>':reviewState.error?`<div class="auth-error">讀取失敗：${safe(reviewState.error)}</div>`:rows.length?`<div style="display:grid;gap:8px">${rows.map(contract=>`<div class="account-detail-item" style="display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap"><div><strong>${safe(contract.organizationName||contract.targetUid)}</strong><div class="hint">${safe(contract.orderCode)}｜${safe(contract.planCode||'')}｜${safe(labels[contract.status]||contract.status)}</div></div><button type="button" class="btn ${contract.status==='signed'?'btn-primary':'btn-ghost'} btn-sm" data-partner-review-open="${safe(contract.targetUid)}" data-partner-review-order="${safe(contract.orderCode)}">${contract.status==='signed'?'前往確認':'查看合約'}</button></div>`).join('')}</div>`:'<div class="empty-state">目前沒有待審合作合約</div>';
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
  async function openReviewContract(uid,orderCode){
    const listed=(reviewState.contracts||[]).find(contract=>contract.targetUid===uid&&contract.orderCode===orderCode);
    if(!listed){root.showToast?.('找不到這筆合作合約，請重新整理清單',true);return;}
    if(typeof root.engagementService?.getPartnerContract!=='function'){
      root.showToast?.('目前無法開啟合約，請重新整理頁面',true);return;
    }
    document.querySelector('[data-partner-review-dialog]')?._bxhClose?.();
    const actor=actorUid(),overlay=document.createElement('div');
    overlay.setAttribute('data-partner-review-dialog','');
    overlay.style.cssText='position:fixed;inset:0;z-index:2147483640;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.82)';
    overlay.innerHTML='<section role="dialog" aria-modal="true" aria-label="合作合約確認" style="width:min(100%,620px);max-height:90vh;overflow:auto;padding:24px;border:1px solid #bd953d;border-radius:16px;background:#1e2029;color:#fff"><p>正在讀取合約……</p><button type="button" class="btn btn-ghost" data-partner-review-close>關閉</button></section>';
    document.body.appendChild(overlay);
    const onKeydown=event=>{if(event.key==='Escape')close();};
    function close(){overlay.remove();document.removeEventListener('keydown',onKeydown);}
    overlay._bxhClose=close;
    document.addEventListener('keydown',onKeydown);
    overlay.addEventListener('click',event=>{if(event.target===overlay||event.target.closest?.('[data-partner-review-close]'))close();});
    try{
      const contract=await root.engagementService.getPartnerContract({orderCode});
      if(!overlay.isConnected||actor!==actorUid())return;
      if(contract?.orderCode!==orderCode||contract?.targetUid!==uid)throw new Error('讀取的合約與所選訂單不符');
      const signed=contract.status==='signed';
      overlay.querySelector('[role="dialog"]').innerHTML=`<h2 style="margin-top:0">${signed?'確認合作合約與付款':'查看合作合約'}</h2><p>合作訂單：${safe(orderCode)}<br>合作方：${safe(contract.organizationName||uid)}<br>方案：${safe(contract.planCode||'')}｜金額 NT$ ${safe(contract.amountTwd??'')}<br>合作期間：${safe(contract.startsAt||'')} 至 ${safe(contract.expiresAt||'')}<br>條款版本：${safe(contract.termsVersion||'')}｜狀態：${safe(contract.status||'')}</p><h3>完整合約條款</h3><div style="white-space:pre-wrap;overflow-wrap:anywhere;padding:16px;border:1px solid #68626b;border-radius:8px">${safe(contract.terms||'此合約未提供條款')}</div>${signed?`<p>合作方已於 ${safe(contract.signedAt||'系統記錄時間')} 簽署。請核對合約及收款紀錄後，再確認授權。</p><label for="partner-payment-reference">付款紀錄或備註</label><input id="partner-payment-reference" type="text" maxlength="120" autocomplete="off" placeholder="請填寫付款紀錄編號" style="display:block;width:100%;box-sizing:border-box;margin:8px 0 16px;padding:12px"><button type="button" class="btn btn-primary" data-partner-review-activate>確認已收款並成立合作</button>`:''}<button type="button" class="btn btn-ghost" data-partner-review-close style="margin:8px">關閉</button><p role="alert" data-partner-review-error style="color:#ff9999"></p>`;
      overlay.querySelector('[data-partner-review-close]')?.focus();
      const activate=overlay.querySelector('[data-partner-review-activate]');
      activate?.addEventListener('click',async()=>{
        const reference=overlay.querySelector('#partner-payment-reference')?.value.trim()||'';
        const error=overlay.querySelector('[data-partner-review-error]');
        if(!reference){error.textContent='請先填寫付款紀錄或備註';return;}
        if(!root.confirm('確認這筆合作訂單已收款，並正式授權合作主辦？'))return;
        activate.disabled=true;error.textContent='正在確認付款與授權……';
        try{
          const result=await root.engagementService.activatePartnerContract({orderCode,paymentConfirmed:true,paymentReference:reference});
          if(!overlay.isConnected||actor!==actorUid())return;
          if(result?.status!=='active')throw new Error('授權結果未確認，請重新整理清單');
          close();root.showToast?.('合作合約已成立並授權');await loadPendingContracts(true);
        }catch(failure){if(overlay.isConnected)error.textContent=`確認失敗：${String(failure?.message||failure)}`;}
        finally{if(activate.isConnected)activate.disabled=false;}
      });
    }catch(error){
      if(overlay.isConnected)overlay.querySelector('[role="dialog"]').innerHTML=`<h2>無法開啟合約</h2><p role="alert" style="color:#ff9999">${safe(String(error?.message||error))}</p><button type="button" class="btn btn-ghost" data-partner-review-close>關閉</button>`;
    }
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
      if(event.target.closest?.('[data-partner-quota-refresh]')){refreshQuota();return;}
      if(event.target.closest?.('[data-partner-own-contract]')){openOwnContract();return;}
      const refresh=event.target.closest?.('[data-partner-review-refresh]');if(refresh){loadPendingContracts(true);return;}
      const open=event.target.closest?.('[data-partner-review-open]');if(open){event.preventDefault();openReviewContract(open.getAttribute('data-partner-review-open')||'',open.getAttribute('data-partner-review-order')||'');}
    });
    root.addEventListener('bxh-partner-room-created',refreshQuota);
    const observer=new MutationObserver(()=>{if(reviewState.scheduled)return;reviewState.scheduled=true;queueMicrotask(()=>{reviewState.scheduled=false;decorateReviewPanel();decorateMailboxContractButtons();decorateQuota();});});
    const start=()=>{observer.observe(document.body,{childList:true,subtree:true});decorateMailboxContractButtons();decorateQuota();};
    if(document.body)start();else document.addEventListener('DOMContentLoaded',start,{once:true});
  }
  const api={hasGrant:profile=>!!grant(profile),grant,render,renderOverview,validQuota,
    remainingRooms:orderCode=>quotaState.orderCode===orderCode&&quotaState.actor===actorUid()&&currentGrant()&&quotaState.key===grantKey(currentGrant())&&!quotaState.loading&&!quotaState.error&&quotaState.total!==null
      ?Math.max(0,quotaState.total-quotaState.used):null};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  root.BXHPartnerOrganizer=api;
})(typeof window!=='undefined'?window:globalThis);

