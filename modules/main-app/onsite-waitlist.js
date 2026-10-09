/* ARENA onsite waitlist trial. Server owns identities, locked selections, random draws and commits. */
(function(global){
  'use strict';
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const statusLabels = {confirmed:'正取',waitlist:'備取',not_selected:'未中選'};
  const definitiveErrors = new Set(['stale-revision','candidate-changed','candidate-list-changed','candidate-hash-mismatch','invalid-candidate-hash','failed-precondition','permission-denied','unauthenticated','invalid-argument','feature-disabled','event-disabled','waitlist-closed','invalid-slots','insufficient-candidates','no-eligible-candidates','no-vacancies','not-found','operation-conflict','lock-required','lock-invalidated','selection-locked','lock-mismatch','lock-active','lock-consumed','lock-payload-mismatch','insufficient-selected-participants','no-replacement-candidates','withdrawal-not-replaceable','replacement-already-completed','withdrawal-not-found','participant-not-active','original-accepted-protected','not-waitlist','insufficient-capacity','rounds-closed','invalid-operation','invalid-participant','invalid-slot-count','auth-required','event-feature-disabled','bracket-locked','participant-frozen','frozen-participants-present']);
  const errorLabels = {
    'candidate-list-changed':'本輪名單或空缺已改變，請重新讀取後確認。',
    'accepted-roster-incomplete':'請先同步最新正取名單，再啟用或完成現場候補抽選。',
    'draw-session-finalized':'本場抽選已完成，請返回一般賽事管理；原抽選紀錄保持不變。',
    'waitlist-close-required':'請先結束候補，再完成抽選並返回賽事管理。',
    'active-waitlist-present':'仍有尚未結束的備取，請先重新讀取並結束候補。',
    'auth-required':'登入已失效，請重新登入後再試。',
    'event-feature-disabled':'這場賽事未開放現場候補抽籤。',
    'rounds-closed':'本場候補已結束，不能再次抽籤。',
    'invalid-slot-count':'遞補名額必須是至少 1 名的整數。',
    'insufficient-capacity':'本輪名額超過目前空缺，請重新設定。',
    'insufficient-eligible-participants':'本輪到場人數不足，請調整名額或確認更多到場選手。',
    'participant-not-found':'找不到這筆參賽資料，請重新讀取名單。',
    'snapshot-required':'請先確認最新候補名單，再執行抽籤。',
    'bracket-locked':'已產生對戰表或賽事已開始，目前不能調整候補。',
    'duplicate-participant':'此參賽身分已存在，請先核對現有名單。',
    'invalid-participant':'請填寫有效的現場選手名稱。',
    'capacity-must-increase':'加開後的名額必須高於目前正取上限。',
    'invalid-capacity':'請輸入有效的正取上限，最多 512 名。',
    'store-busy':'本機名單正在保存，請使用同一筆操作重試。',
    'stale-revision':'名單已由其他工作人員更新。請重新讀取名單，再確認本輪。',
    'candidate-changed':'本輪候補名單已改變，請重新確認。',
    'candidate-hash-mismatch':'本輪候補名單已改變，請重新確認。',
    'invalid-candidate-hash':'本輪候補名單已改變，請重新確認。',
    'permission-denied':'此帳號沒有操作這場候補抽籤的權限。',
    'unauthenticated':'登入已失效，請重新登入後再試。',
    'feature-disabled':'候補抽籤尚未啟用。',
    'event-disabled':'這場賽事未開放候補抽籤。',
    'waitlist-closed':'本場候補已結束，不能再次抽籤。',
    'invalid-slots':'請輸入至少 1 名，且不超過空缺及本輪候補人数。',
    'insufficient-candidates':'本輪已到場人數不足，請調整名額後再確認。',
    'no-eligible-candidates':'請先勾選至少一位已到場的備取選手。',
    'no-vacancies':'目前沒有可遞補的空缺。',
    'operation-conflict':'這筆操作編號已使用，請先核對抽籤紀錄。',
    'lock-required':'請先鎖定名單，再開始抽選。',
    'lock-invalidated':'鎖定後名單或空缺有變動，請先解鎖調整，再重新鎖定。',
    'selection-locked':'名單已鎖定，請先解鎖再調整。',
    'lock-mismatch':'鎖定名單已更新，請重新讀取並核對。',
    'lock-active':'目前有鎖定名單，請先解鎖調整。',
    'lock-consumed':'這份鎖定名單已抽選完成，請重新鎖定下一輪。',
    'original-accepted-protected':'原有正取受到保護，不能從此處操作放棄。',
    'participant-not-active':'這位選手已不在可操作名單，請重新讀取。',
    'not-waitlist':'這位選手目前不是備取，請重新核對名單。',
    'no-replacement-candidates':'原輪未中選名單已沒有可加抽的人員，可改為手動選取。',
    'withdrawal-not-replaceable':'這筆放棄紀錄沒有可遞補的中選名額。',
    'replacement-already-completed':'這筆放棄名額已遞補完成，請查看紀錄。',
    'insufficient-selected-participants':'勾選人數少於抽出名額，請調整後再鎖定。',
    'participant-frozen':'這位備取已凍結，請先解凍，再重新確認抽選名單。',
    'frozen-participants-present':'仍有凍結的備取，請先處理後再變更抽選模式。',
    'storage-unavailable':'無法保存操作編號。請開放瀏覽器儲存空間後再試，以免斷線後無法確認同一筆抽籤。'
  };

  function mount(root, options={}) {
    if(!root) throw new Error('A mount element is required');
    // Importing this module alone never enables a feature or sends a request.
    if(options.enabled !== true) return {enabled:false,refresh:async()=>null,destroy:()=>{}};
    if(typeof options.api !== 'function' || !options.code) throw new Error('Explicit API and tournament code are required');
    const code=String(options.code), actorId=String(options.actorId || 'current-user');
    const storage=options.storage || global.localStorage;
    const pendingKey='bxh.onsite-waitlist.pending.v1:'+encodeURIComponent(actorId)+':'+encodeURIComponent(code);
    let snapshot=null, slots=null, busy=false, destroyed=false, dialog=null, notice=null, pending=null, bodyOverflow=null;
    let lastFocus=null, hydratedLockId=null, footerObserved=null, historyOwned=false, historyBackPending=false;
    const selectionDraft=new Map();
    const historyKey='owd-dialog-'+code+'-'+Date.now();
    const footerObserver=global.ResizeObserver?new ResizeObserver(updateFooterSpace):null;
    const toolDraft={name:'',additional:2};
    try {
      const saved=storage.getItem(pendingKey);
      if(saved){
        const parsed=JSON.parse(saved);
        if(parsed.code===code && typeof parsed.operationId==='string' && ['configure','finalize','checkIn','draw','close','setEligibility','lock','unlock','freeze','unfreeze','withdraw','replace','addOnsite','increaseCapacity'].includes(parsed.action)) pending=parsed;
      }
    } catch(_){ /* No mutation may begin unless a fresh pending operation can be persisted. */ }

    const waiting=()=>snapshot?.state.participants.filter(p=>p.status==='waitlist') || [];
    const frozen=p=>p?.frozen===true;
    const drawableWaiting=()=>waiting().filter(p=>!frozen(p));
    const frozenCount=()=>waiting().filter(frozen).length;
    const selectionLock=()=>snapshot?.state.lock || null;
    const disabled=()=>busy || !!pending || snapshot?.state.status==='closed' || snapshot?.state.enabled===false;
    const eligibilityDisabled=()=>disabled() || !!dialog || !!selectionLock();
    const selectedValue=p=>selectionLock()?selectionLock().registrationIds.includes(p.registrationId):!frozen(p) && (selectionDraft.has(p.registrationId)?selectionDraft.get(p.registrationId):true);
    const candidates=()=>waiting().filter(selectedValue);
    const selectedCount=()=>selectionLock()?selectionLock().registrationIds.length:candidates().length;
    const slotLimit=()=>Math.max(0,Math.min(Number(snapshot?.state.availableSlots)||0,selectedCount()));
    const validSlots=()=>Number.isSafeInteger(slots) && slots>=1 && slots<=slotLimit();
    const drawAllowed=()=>selectionLock()?selectionLock().valid!==false && validSlots():validSlots();
    const withdrawDisabled=()=>busy || !!pending || snapshot?.state.enabled===false || snapshot?.state.finalized===true;
    const staffDisabled=()=>disabled() || !!selectionLock();
    const withdrawals=()=>snapshot?.state.withdrawals || [];
    const replacements=()=>snapshot?.state.replacements || [];
    const pendingReplacements=()=>Array.isArray(snapshot?.state.pendingReplacements)?snapshot.state.pendingReplacements.map(p=>Object.assign({},withdrawals().find(w=>w.id===p.withdrawalId),p,{id:p.withdrawalId})):withdrawals().filter(w=>w.wasWinner && !replacements().some(r=>r.withdrawalId===w.id));
    const replacementAllowed=w=>snapshot?.state.status!=='closed' && pendingReplacements().find(p=>p.id===w.id)?.canReplace!==false;
    const managedWinnerIds=()=>new Set([...(snapshot?.state.rounds||[]).flatMap(r=>r.winnerIds),...replacements().map(r=>r.registrationId)]);
    const canWithdraw=p=>p && (p.status==='waitlist' || (p.status==='confirmed' && managedWinnerIds().has(p.registrationId)));
    const replacementRound=w=>(snapshot?.state.rounds||[]).find(r=>r.id===w.roundId);
    const randomReplacementCandidates=w=>{const pending=pendingReplacements().find(p=>p.id===w.id);return Array.isArray(pending?.eligibleRandomIds)?drawableWaiting().filter(p=>pending.eligibleRandomIds.includes(p.registrationId)):drawableWaiting().filter(p=>replacementRound(w)?.loserIds.includes(p.registrationId));};
    const nextRound=()=>1+(snapshot?.state.rounds?.length||0);
    function request(data){ return options.api(Object.assign({code},data)); }
    function applySnapshot(result){
      if(!result || !result.state || !Array.isArray(result.state.participants)) throw Object.assign(new Error('Invalid server response'),{code:'invalid-response'});
      if(!snapshot || Number(result.state.revision)>=Number(snapshot.state.revision)) snapshot=result;
      if(selectionLock()){
        slots=selectionLock().slots;
        // Hydrate a durable lock once. Later state reads must not inject a newly
        // unfrozen entrant into that pool, or erase their future editable choice.
        if(hydratedLockId!==selectionLock().id){
          for(const p of waiting()){
            if(selectionLock().registrationIds.includes(p.registrationId))selectionDraft.set(p.registrationId,true);
            else if(!frozen(p))selectionDraft.set(p.registrationId,false);
          }
          hydratedLockId=selectionLock().id;
        }
      }else{
        hydratedLockId=null;
        if(slots===null)slots=Math.max(1,Math.min(10,Number(snapshot.state.availableSlots)||1));
      }
      if(!destroyed && options.onStateChange) { try { options.onStateChange(snapshot.state); } catch (_) { /* Host rendering cannot alter a committed operation. */ } }
    }
    function preservePending(body){
      try{ storage.setItem(pendingKey,JSON.stringify(body)); if(storage.getItem(pendingKey)!==JSON.stringify(body)) throw new Error(); }
      catch(_){throw Object.assign(new Error('Storage unavailable'),{code:'storage-unavailable'});}
      pending=body;
    }
    function clearPending(){
      try{storage.removeItem(pendingKey);}catch(_){/* Replaying a committed operation is safe. */}
      pending=null;
    }
    function opId(){
      if(!global.crypto?.randomUUID) throw Object.assign(new Error('Secure operation ID unavailable'),{code:'storage-unavailable'});
      return global.crypto.randomUUID(); // Identifier only; winners are exclusively selected by the server.
    }
    function focusKey(){
      const el=document.activeElement;
      return root.contains(el) ? el.id || null : null;
    }
    function restoreFocus(key){
      if(!key) return;
      const el=document.getElementById(key);
      if(el && root.contains(el) && !el.disabled) el.focus({preventScroll:true});
    }
    function updateFooterSpace(){
      const footer=root.querySelector('.owd-footer');
      // Match the actual bar height, including wrapped errors and device safe areas.
      root.style.setProperty('--owd-footer-space',footer?Math.ceil(footer.getBoundingClientRect().height+24)+'px':'24px');
    }
    function observeFooter(){
      const footer=root.querySelector('.owd-footer');
      if(footer!==footerObserved){footerObserver?.disconnect();footerObserved=footer;if(footer)footerObserver?.observe(footer);}
      updateFooterSpace();
    }
    function syncDialogHistory(){
      if(dialog && !historyOwned && !historyBackPending){
        try{global.history.pushState(Object.assign({},global.history.state,{owdDialog:historyKey}),'');historyOwned=true;}catch(_){}
      }else if(!dialog && historyOwned){
        historyOwned=false;
        if(global.history.state?.owdDialog===historyKey){historyBackPending=true;global.history.back();}
      }
    }
    function onPopState(){
      const dismissedEarlier=historyBackPending;historyBackPending=false;
      if(dismissedEarlier && dialog){historyOwned=false;syncDialogHistory();return;}
      if(dialog && global.history.state?.owdDialog!==historyKey){
        historyOwned=false;
        // Leaving a confirmation never submits it. A submitted operation is still
        // persisted and completes safely even if the dialog is dismissed by Back.
        setDialog(null);
      }else if(!dialog && global.history.state?.owdDialog===historyKey){
        const state=Object.assign({},global.history.state);delete state.owdDialog;global.history.replaceState(state,'');
      }
    }
    function setDialog(value){
      if(value && !dialog) lastFocus=focusKey();
      dialog=value; render();
      if(value) focusDialog();
      else restoreFocus(lastFocus);
    }
    function focusDialog(){
      (root.querySelector('.owd-dialog [data-focus]:not(:disabled)') || root.querySelector('.owd-dialog'))?.focus({preventScroll:true});
    }
    function showError(error, uncertain=false){
      const code=String(error?.code||'network-error');
      notice={type:'error',text:uncertain?'操作結果尚未確認。請使用「確認同一筆操作」，會取回原結果，不會重新抽籤。':(errorLabels[code] || '操作未完成，請重新讀取名單或檢查本場設定。'),code};
    }
    async function refresh(){
      if(busy || destroyed) return;
      busy=true;render();
      try{ applySnapshot(await request({action:'preview'})); if(!pending) notice=null; }
      catch(error){showError(error);}
      finally{busy=false;render();}
    }
    async function commit(body){
      if(busy || destroyed) return;
      const inline=['lock','unlock','freeze','unfreeze'].includes(body.action),mutationFocus=focusKey();
      let succeeded=false,readbackFailed=false;
      busy=true;notice=null;render(inline);
      try{
        const result=await request(body);
        applySnapshot(result);clearPending();succeeded=true;

        // Every mutation advances the canonical roster revision, including locks/freeze.
        if(!destroyed && options.onRosterCommitted) {try{await options.onRosterCommitted(result);}catch(_){readbackFailed=true;}}
        if(body.action==='draw'){
          selectionDraft.clear();slots=selectionLock()?.slots ?? Math.max(1,Math.min(10,result.state.availableSlots||1));
          if(!dialog)lastFocus='owd-open-draw';
          const round=result.round || result.state.rounds.find(r=>r.operationId===body.operationId) || result.state.rounds.at(-1);
          dialog={type:'result',round};
          notice={type:'success',text:'第 '+round.number+' 輪已完成。結果已保存，未中選者繼續保留備取。'};
        }else if(body.action==='close'){
          dialog=null;notice={type:'success',text:'候補已結束。剩餘備取標示為未中選，未產生取消紀錄或取消次數。'};
        }else{
          dialog=null;
          if(body.action==='addOnsite'){toolDraft.name='';notice={type:'success',text:'已加入現場備取。即使有空缺，也需參加候補抽籤。'};}
          else if(body.action==='increaseCapacity'){notice={type:'success',text:'名額已加開；線上報名維持關閉，可繼續抽下一輪。'};slots=Math.max(1,Math.min(result.state.availableSlots,candidates().length||1));}
          else if(body.action==='withdraw'){
            const withdrawal=result.withdrawal || withdrawals().find(w=>w.id===result.withdrawalId);
            notice={type:'success',text:snapshot.state.status==='closed'?'已記錄放棄。候補已結束，不再補額。':'已記錄放棄，本場不再列入抽選。'};
            if(withdrawal?.wasWinner){const open=pendingReplacements().find(w=>w.id===withdrawal.id);const filled=replacements().find(r=>r.withdrawalId===withdrawal.id);if(open && replacementAllowed(open))dialog={type:'replacement',withdrawal:open};else if(filled)dialog={type:'replacement-result',replacement:filled};}
          }
          else if(body.action==='replace'){
            const replacement=result.replacement || replacements().find(r=>r.withdrawalId===body.withdrawalId);
            dialog={type:'replacement-result',replacement};
            notice={type:'success',text:'遞補已完成，原輪抽選紀錄完整保留。'};
          }
          else if(body.action==='lock')notice=null;
          else if(body.action==='unlock')notice=null;
          else if(['freeze','unfreeze'].includes(body.action))notice=null;
          else notice=null;
        }
      }catch(error){
        const definitive=error.definitive===true || definitiveErrors.has(String(error.code)) || (Number(error.status)>=400 && Number(error.status)<500);
        if(definitive){ clearPending();dialog=null;showError(error);try{applySnapshot(await request({action:'preview'}));}catch(_){} }
        else{dialog=null;showError(error,true);}
      }finally{
        if(readbackFailed)notice={type:'error',text:'操作已保存，但完整名單尚未同步。請重新讀取名單確認。'};
        busy=false;render(inline && succeeded);
        if(dialog)focusDialog();else restoreFocus(mutationFocus);
      }
      return succeeded;
    }
    async function startMutation(action,extra){
      if(busy || pending) return;
      let body;
      try{ body=Object.assign({code,action,operationId:opId(),expectedRevision:snapshot.state.revision},extra);preservePending(body); }
      catch(error){showError(error);render();return;}
      return commit(body);
    }
    function setSelection(ids,selected){
      if(eligibilityDisabled() || !ids.length){render(true);return;}
      const available=new Set(drawableWaiting().map(p=>p.registrationId));
      for(const id of ids){if(available.has(id))selectionDraft.set(id,selected);}
      notice=null;render(true);
    }
    async function prepare(type){
      if(disabled()) return;
      busy=true;notice=null;render();
      try{
        applySnapshot(await request({action:'preview'}));
        if(snapshot.state.status==='closed') throw Object.assign(new Error('本場候補已結束。'),{code:'waitlist-closed'});
        const selected=waiting();
        setDialog({type,slots,revision:snapshot.state.revision,hash:snapshot.candidateHash,participants:selected.map(p=>Object.assign({},p))});
      }catch(error){showError(error);}
      finally{busy=false;render();if(dialog)focusDialog();}
    }
    function renderNotice(){
      if(!notice && (!pending || busy)) return '';
      const text=notice?.text || '有一筆操作尚未確認。請取回同一筆結果後再繼續。';
      return `<div class="owd-notice ${notice?.type==='error'?'is-error':''}" role="${notice?.type==='error'?'alert':'status'}">${escapeHTML(text)}${pending && (!snapshot || snapshot.state.status==='closed')?'<button id="owd-retry" data-owd-action="retry" class="owd-outline" '+(busy?'disabled':'')+'>確認同一筆操作</button>':''}</div>`;
    }
    function withdrawButton(p){
      return canWithdraw(p)?`<button class="owd-withdraw" data-owd-action="withdraw" data-person-id="${escapeHTML(p.registrationId)}" aria-label="${escapeHTML(p.name)} 放棄本次抽選" ${withdrawDisabled()?'disabled':''}>放棄</button>`:'';
    }
    function freezeButton(p){
      if(p.status!=='waitlist')return '';
      return `<button id="owd-freeze-${escapeHTML(p.registrationId)}" class="owd-freeze" data-owd-action="${frozen(p)?'unfreeze':'freeze'}" data-person-id="${escapeHTML(p.registrationId)}" aria-label="${escapeHTML(p.name)} ${frozen(p)?'解凍':'凍結'}" ${disabled()?'disabled':''}>${frozen(p)?'解凍':'凍結'}</button>`;
    }
    function participantSelectionLabel(p){
      if(busy && ['freeze','unfreeze'].includes(pending?.action) && pending.registrationId===p.registrationId)return pending.action==='freeze'?'正在凍結…':'正在解凍…';
      if(frozen(p))return selectionLock()?.registrationIds.includes(p.registrationId)?'已凍結 · 請重新鎖定':'已凍結 · 暫停抽選';
      return selectedValue(p)?'參加本輪':'本輪不抽';
    }
    function personRow(p,i){
      const child=!!p.familyPlayerId,selected=selectedValue(p);
      return `<div class="owd-person ${selected?'is-eligible':''} ${frozen(p)?'is-frozen':''}" data-registration-id="${escapeHTML(p.registrationId)}"><label class="owd-person-choice"><input type="checkbox" id="owd-person-${escapeHTML(p.registrationId)}" data-eligibility="${escapeHTML(p.registrationId)}" aria-label="${escapeHTML(p.name)} 列入本輪抽選" ${selected?'checked':''} ${eligibilityDisabled()||frozen(p)?'disabled':''}><div class="owd-person-main"><div class="owd-name">${escapeHTML(p.name)} ${child?'<span class="owd-tag">子女選手</span>':''}</div><div class="owd-person-meta"><span class="owd-index">備 ${String(i+1).padStart(2,'0')}</span> · ${child?'以子女身分獨立抽選':'獨立參賽名額'}${p.checkedIn?' · 已報到':''}</div><span class="owd-eligible-label">${escapeHTML(participantSelectionLabel(p))}</span></div></label><div class="owd-person-actions">${freezeButton(p)}${withdrawButton(p)}</div></div>`;
    }
    function drawFollowups(){
      const managed=managedWinnerIds(),winners=snapshot.state.participants.filter(p=>p.status==='confirmed' && managed.has(p.registrationId));
      const pendingRows=pendingReplacements();
      const people=new Map(snapshot.state.participants.map(p=>[p.registrationId,p]));
      const pendingHTML=pendingRows.length?`<section class="owd-replacement-tasks" aria-label="待處理遞補"><h2>${snapshot.state.status==='closed'?'未遞補紀錄':'待處理遞補'} · ${pendingRows.length} 名</h2><p class="owd-help">${snapshot.state.status==='closed'?'候補已結束，不再補額。':'中選者放棄後不會自動遞補。選擇加抽、手動指定，或保留稍後處理。'}</p>${pendingRows.map(w=>`<div class="owd-history-row"><span>${escapeHTML(people.get(w.registrationId)?.name||w.registrationId)} 已放棄</span><button data-owd-action="replacement" data-withdrawal-id="${escapeHTML(w.id)}" ${disabled()||!replacementAllowed(w)?'disabled':''}>${replacementAllowed(w)?'處理遞補':'不再遞補'}</button></div>`).join('')}</section>`:'';
      const winnersHTML=winners.length?`<details class="owd-history owd-managed-winners"><summary>本場抽選中選者 · ${winners.length} 人</summary>${winners.map(p=>`<div class="owd-history-row"><span>${escapeHTML(p.name)}</span>${withdrawButton(p)}</div>`).join('')}</details>`:'';
      const audit=[...withdrawals().map(w=>({at:w.createdAt||w.withdrawnAt||0,text:(people.get(w.registrationId)?.name||w.registrationId)+' · 放棄本次抽選'})),...replacements().map(r=>({at:r.createdAt||r.replacedAt||0,text:(people.get(r.registrationId)?.name||r.registrationId)+' · '+(r.mode==='random'?'隨機加抽':'手動遞補')}))].sort((a,b)=>a.at-b.at);
      const auditHTML=audit.length?`<details class="owd-history"><summary>放棄與遞補紀錄 · ${audit.length} 筆</summary>${audit.map(a=>`<div class="owd-history-row">${escapeHTML(a.text)}</div>`).join('')}</details>`:'';
      return pendingHTML+winnersHTML+auditHTML;
    }
    function staffTools(){
      return `<details class="owd-tools"><summary>現場工作人員工具 <span class="owd-muted">＋</span></summary><div class="owd-tool-body"><label for="owd-onsite-name">新增現場備取</label><p class="owd-help">僅建立新的現場參賽身分；已有報名的家長或子女，請從原名單勾選。</p><div class="owd-tool-row"><input id="owd-onsite-name" maxlength="100" placeholder="現場選手名稱" value="${escapeHTML(toolDraft.name)}" ${staffDisabled()?'disabled':''}><button data-owd-action="add-onsite" ${staffDisabled()?'disabled':''}>加入備取</button></div><label for="owd-additional">加開正取名額</label><p class="owd-help">目前上限 ${snapshot.state.capacity} 人。只增加空缺，線上報名維持關閉。</p><div class="owd-tool-row"><input id="owd-additional" type="number" inputmode="numeric" min="1" max="${512-snapshot.state.capacity}" value="${toolDraft.additional}" aria-label="加開名額數" ${staffDisabled()?'disabled':''}><button data-owd-action="increase-capacity" ${staffDisabled()?'disabled':''}>加開名額</button></div></div></details>`;
    }
    function history(){
      const rounds=snapshot.state.rounds||[];
      return rounds.length?`<details class="owd-history"><summary>已保存的抽籤紀錄 · ${rounds.length} 輪</summary>${rounds.map(r=>`<div class="owd-history-row"><span>第 ${r.number} 輪 · ${r.candidateIds.length} 人抽 ${r.winnerIds.length} 名</span><button data-owd-action="history" data-round="${escapeHTML(r.id)}">查看結果</button></div>`).join('')}</details>`:'';
    }
    function renderDialog(){
      if(!dialog) return '';
      let head,body,actions;
      if(dialog.type==='result'){
        const r=dialog.round;
        if(!r) return '';
        const map=new Map(snapshot.state.participants.map(p=>[p.registrationId,p]));
        head=`<div><div class="owd-eyebrow">ROUND ${String(r.number).padStart(2,'0')} · SAVED</div><h2>本輪中選 ${r.winnerIds.length} 人</h2></div>`;
        body=`<div class="owd-result-icon" aria-hidden="true">✓</div><p class="owd-muted owd-small">已升為正取，原有正取名單完整保留。</p><div>${r.winnerIds.map((id,i)=>`<div class="owd-result-row"><span class="owd-result-name"><span class="owd-result-number">${String(i+1).padStart(2,'0')}</span>${escapeHTML(map.get(id)?.name||id)}</span><span class="owd-result-badge">${map.get(id)?.status==='withdrawn'?'已放棄':'本輪中選'}</span>${withdrawButton(map.get(id))}</div>`).join('')}</div><div class="owd-notice">本輪未中選 ${r.loserIds.length} 人繼續保留備取，可參加下一輪。</div><div class="owd-snapshot">紀錄 ${escapeHTML(r.id)}<br>相同操作重試只會取回這份結果。</div>`;
        actions=`<button data-focus class="owd-primary" data-owd-action="dismiss-result">${snapshot.state.availableSlots>0 && snapshot.state.status!=='closed'?'準備下一輪':'返回候補名單'}</button>`;
      }else if(dialog.type==='withdraw'){
        const p=dialog.person,winner=p.status==='confirmed';
        head='<div><div class="owd-eyebrow">WITHDRAW</div><h2>確認放棄本次抽選？</h2></div>';
        body=`<p><strong>${escapeHTML(p.name)}</strong> 將標示為「放棄本次抽選」，保留操作紀錄，之後不再列入本場抽選。</p><p class="owd-small owd-muted">此動作無法從試用介面還原。${winner?(snapshot.state.status==='closed'?'候補已結束，不再補額。':'會釋出 1 個名額，接著可選擇加抽、手動遞補或稍後處理，不會自動遞補。'):'若只是本輪不參加，請返回並取消勾選即可。'}</p>${selectionLock()?'<div class="owd-notice">若此人在已鎖定名單中，需解鎖調整並重新鎖定後才能抽選。</div>':''}`;
        actions=`<button data-focus data-owd-action="dismiss" ${busy?'disabled':''}>返回</button><button class="owd-primary" data-owd-action="confirm-withdraw" ${busy?'disabled':''}>${busy?'保存中…':'確認放棄'}</button>`;
      }else if(dialog.type==='replacement'){
        const w=dialog.withdrawal,p=snapshot.state.participants.find(p=>p.registrationId===w.registrationId),pool=randomReplacementCandidates(w);
        head='<div><div class="owd-eyebrow">REPLACE A WINNER</div><h2>如何遞補這個名額？</h2></div>';
        body=`<p>${escapeHTML(p?.name||w.registrationId)} 已放棄，這個名額尚未遞補。</p><div class="owd-notice">隨機加抽只從原輪參加且未中選、目前仍為備取的 ${pool.length} 人中抽出 1 人；不包含原輪取消勾選的人員。</div><p class="owd-small owd-muted">手動選取可指定目前未凍結的備取人員；原輪未勾選者會另外標示。原輪抽選紀錄不會改寫。</p>${selectionLock()?'<div class="owd-notice">目前另有鎖定名單；遞補後若名單或空缺改變，需解鎖調整再抽選。</div>':''}`;
        actions=`<button data-focus data-owd-action="dismiss" ${busy?'disabled':''}>稍後處理</button><button data-owd-action="replacement-manual" ${disabled()||!replacementAllowed(w)||!drawableWaiting().length?'disabled':''}>手動選取</button><button class="owd-primary" data-owd-action="replacement-random" ${disabled()||!replacementAllowed(w)||!pool.length?'disabled':''}>隨機加抽</button>`;
      }else if(dialog.type==='replacement-manual'){
        const round=replacementRound(dialog.withdrawal);
        head='<div><div class="owd-eyebrow">MANUAL REPLACEMENT</div><h2>手動選取遞補人員</h2></div>';
        body=`<p class="owd-small owd-muted">請指定 1 位未凍結的備取人員。確認後直接升為正取，並保留手動遞補紀錄。</p><div class="owd-manual-list">${drawableWaiting().map(p=>`<label class="owd-manual-choice"><input type="radio" name="owd-replacement-person" value="${escapeHTML(p.registrationId)}" ${dialog.registrationId===p.registrationId?'checked':''} ${busy?'disabled':''}><span>${escapeHTML(p.name)}${!round?.candidateIds.includes(p.registrationId)?'<small>本輪未勾選</small>':''}</span></label>`).join('')}</div>`;
        actions=`<button data-focus data-owd-action="replacement-back" ${busy?'disabled':''}>返回</button><button class="owd-primary" data-owd-action="confirm-replacement" ${busy||!dialog.registrationId?'disabled':''}>${busy?'保存中…':'確認遞補'}</button>`;
      }else if(dialog.type==='replacement-result'){
        const r=dialog.replacement,p=snapshot.state.participants.find(p=>p.registrationId===r?.registrationId);
        head='<div><div class="owd-eyebrow">REPLACEMENT SAVED</div><h2>遞補已完成</h2></div>';
        body=`<div class="owd-result-icon" aria-hidden="true">✓</div><p><strong>${escapeHTML(p?.name||r?.registrationId||'')}</strong> 已升為正取。</p><p class="owd-small owd-muted">${r?.mode==='random'?'隨機加抽':'手動選取'}結果已保存。原輪中選與未中選紀錄保持不變。</p><div class="owd-snapshot">遞補紀錄 ${escapeHTML(r?.id||'')}</div>`;
        actions='<button data-focus class="owd-primary" data-owd-action="dismiss">返回名單</button>';
      }else if(dialog.type==='capacity'){
        head='<div><div class="owd-eyebrow">INCREASE CAPACITY</div><h2>確認加開名額</h2></div>';
        body=`<p>正取上限將從 ${snapshot.state.capacity} 人增加至 ${dialog.capacity} 人，新增 ${dialog.capacity-snapshot.state.capacity} 個空缺。</p><div class="owd-notice">線上報名維持關閉。現場選手仍需加入備取，由工作人員確認到場後抽籤。</div>`;
        actions=`<button data-focus data-owd-action="dismiss" ${busy?'disabled':''}>返回</button><button class="owd-primary" data-owd-action="confirm-capacity" ${busy?'disabled':''}>${busy?'保存中…':'確認加開'}</button>`;
      }else if(dialog.type==='finalize'){
        head='<div><div class="owd-eyebrow">FINISH ONSITE DRAW</div><h2>完成抽選，返回賽事管理？</h2></div>';
        body='<p>此步完成後不能再抽選、加抽或從抽選頁補額。原抽選與放棄紀錄會保留。</p><p>一般報到、賽事編排、開賽與裁判操作將恢復；公開報名與自動補位仍維持關閉。</p>';
        actions='<button data-focus data-owd-action="dismiss">返回</button><button class="owd-primary" data-owd-action="confirm-finalize">完成抽選，返回賽事管理</button>';
      }else if(dialog.type==='configure'){
        head='<div><div class="owd-eyebrow">ONSITE WAITLIST</div><h2>啟用現場候補抽選？</h2></div>';
        body='<p>線上報名及自動補位將關閉。原有正取保持不變；備取與新到場選手改由此處抽選，抽中後仍需報到。</p><p>啟用後公開報名與自動補位維持關閉。結束候補並完成抽選後，才能返回一般賽事管理。</p>';
        actions='<button data-focus data-owd-action="dismiss">返回</button><button class="owd-primary" data-owd-action="confirm-configure">確認啟用</button>';
      }else{
        head='<div><div class="owd-eyebrow">CLOSE WAITLIST</div><h2>結束本場候補？</h2></div>';
        body=`<p>剩餘 ${dialog.participants.length} 位備取將標示為「未中選」，本場不再開放後續候補抽籤。</p><div class="owd-notice">這是系統結束候補，不算玩家取消；不增加取消次數，也不觸發取消限制。</div><p class="owd-small owd-muted">已中選及原有正取不受影響。</p><div class="owd-snapshot">名單快照 v${dialog.revision}</div>`;
        actions=`<button data-focus data-owd-action="dismiss" ${busy?'disabled':''}>繼續候補</button><button class="owd-primary" data-owd-action="confirm-close" ${busy?'disabled':''}>${busy?'保存中…':'確認結束候補'}</button>`;
      }
      return `<div class="owd-overlay" data-owd-action="backdrop"><section class="owd-dialog" tabindex="-1" role="dialog" aria-modal="true" aria-label="${({finalize:'完成抽選，返回賽事管理',configure:'啟用現場候補抽選',result:'抽籤結果',withdraw:'確認放棄本次抽選',replacement:'選擇遞補方式','replacement-manual':'手動選取遞補人員','replacement-result':'遞補已完成',capacity:'確認加開名額',close:'結束本場候補'})[dialog.type]}"><div class="owd-dialog-head">${head}<button class="owd-close" aria-label="關閉" data-owd-action="dismiss" ${busy?'disabled':''}>×</button></div><div class="owd-dialog-body">${body}</div><div class="owd-dialog-actions ${dialog.type==='replacement'?'owd-replacement-actions':''}">${actions}</div></section></div>`;
    }
    function footerStatus(){
      if(pending && !busy)return notice?.text || '有一筆操作尚未確認，請先確認同一筆操作。';
      if(notice?.type==='error')return notice.text;
      if(busy && ['freeze','unfreeze'].includes(pending?.action))return pending.action==='freeze'?'正在保存凍結狀態…':'正在保存解凍狀態…';
      if(busy)return pending?.action==='draw'?'正在抽選並保存結果…':pending?.action==='lock'?'正在鎖定名單…':pending?.action==='unlock'?'正在解鎖名單…':'正在讀取最新名單…';
      if(selectionLock()?.valid===false)return '鎖定後名單或空缺有變動，請先解鎖調整，再重新鎖定。';
      if(selectionLock())return '名單與名額已鎖定。按「開始抽選」才會抽出中選者。';
      if(snapshot.state.availableSlots===0)return '目前沒有空缺；可加開名額後再抽選。';
      if(!selectedCount())return !drawableWaiting().length && frozenCount()?'備取已全部凍結，請先解凍要參加的人員。':'請至少勾選一位參加本輪抽選的人員。';
      if(!validSlots())return '請輸入 1 至 '+slotLimit()+' 名，或增加勾選人數。';
      return frozenCount()?'凍結者暫停後續抽選；解凍後可再參加。確認本輪名單後鎖定。':'目前是可編輯名單。取消不抽的人員，確認後鎖定名單。';
    }
    function renderFooter(){
      const s=snapshot.state;
      return `<div class="owd-footer"><div class="owd-footer-inner"><div class="owd-footer-summary"><strong data-owd-selected>${selectedCount()}</strong>人<span data-owd-selection-status>${selectionLock()?'已鎖定':'已勾選'}</span><span data-owd-footer-summary>可遞補 ${s.availableSlots} 名 · 凍結 ${frozenCount()} 人</span></div><div class="owd-footer-slots"><label for="owd-slots">本輪抽出</label><div class="owd-stepper"><button id="owd-minus" aria-label="減少遞補名額" data-owd-action="minus" ${eligibilityDisabled()||slots<=1?'disabled':''}>−</button><input id="owd-slots" aria-label="本輪遞補名額" aria-describedby="owd-footer-status" type="number" inputmode="numeric" min="1" max="${s.availableSlots}" value="${Number.isFinite(slots)?slots:''}" ${eligibilityDisabled()||s.availableSlots===0?'disabled':''}><button id="owd-plus" aria-label="增加遞補名額" data-owd-action="plus" ${eligibilityDisabled()||slots>=s.availableSlots?'disabled':''}>+</button></div><span>名</span></div><button id="owd-open-draw" class="owd-primary" data-owd-action="${selectionLock()?'draw':'lock'}" ${disabled()||!drawAllowed()?'disabled':''}>${busy?pending?.action==='draw'?'抽選中…':'處理中…':s.availableSlots===0?'目前無空缺':selectionLock()?'開始抽選':'鎖定名單'}</button><button id="owd-unlock" class="owd-text-btn owd-unlock" data-owd-action="unlock" ${!selectionLock()?'hidden':''} ${disabled()?'disabled':''}>解鎖調整</button><div id="owd-footer-status" class="owd-footer-status ${notice?.type==='error'?'is-error':''}" role="status" aria-live="polite">${escapeHTML(footerStatus())}</div><button id="owd-retry" data-owd-action="retry" class="owd-outline owd-footer-retry" ${!pending||busy?'hidden':''} ${busy?'disabled':''}>確認同一筆操作</button></div></div>`;
    }
    function renderInline(){
      const rows=[...root.querySelectorAll('[data-registration-id]')],w=waiting();
      if(dialog || !snapshot || !root.querySelector('.owd-footer') || snapshot.state.status==='closed' || rows.length!==w.length || rows.some((row,i)=>row.dataset.registrationId!==w[i].registrationId))return false;
      root.setAttribute('aria-busy',String(busy));
      rows.forEach((row,i)=>{
        const p=w[i],selected=selectedValue(p),input=row.querySelector('[data-eligibility]');
        input.checked=selected;input.disabled=eligibilityDisabled()||frozen(p);
        row.classList.toggle('is-eligible',selected);row.classList.toggle('is-frozen',frozen(p));
        const saving=busy && ['freeze','unfreeze'].includes(pending?.action) && pending.registrationId===p.registrationId;
        row.classList.toggle('is-saving',saving);row.setAttribute('aria-busy',String(saving));
        row.querySelector('.owd-eligible-label').textContent=participantSelectionLabel(p);
        const freeze=row.querySelector('.owd-freeze');
        freeze.disabled=disabled();freeze.dataset.owdAction=frozen(p)?'unfreeze':'freeze';freeze.textContent=frozen(p)?'解凍':'凍結';freeze.setAttribute('aria-label',p.name+' '+(frozen(p)?'解凍':'凍結'));
        const withdraw=row.querySelector('[data-owd-action="withdraw"]');if(withdraw)withdraw.disabled=withdrawDisabled();
      });
      const count=selectedCount(),drawable=drawableWaiting(),all=drawable.length>0 && count===drawable.length;
      root.querySelector('[data-owd-roster-count]').textContent=count+' / '+w.length+' 人';
      root.querySelector('[data-owd-frozen-count]').textContent='凍結 '+frozenCount()+' 人';
      root.querySelector('[data-owd-toolbar-status]').textContent=selectionLock()?'名單已鎖定':count?'已勾選 '+count+' 人':'尚未勾選抽選名單';
      const selectAll=root.querySelector('[data-owd-action="select-all"]');selectAll.textContent=all?'取消全部勾選':'全部選取';selectAll.disabled=eligibilityDisabled()||!drawable.length;
      root.querySelector('[data-owd-selected]').textContent=count;
      root.querySelector('[data-testid="accepted-count"]').textContent=snapshot.state.acceptedCount;
      root.querySelector('[data-testid="available-slots"]').textContent=snapshot.state.availableSlots;
      root.querySelector('[data-testid="waitlist-count"]').textContent=w.length;
      root.querySelector('[data-owd-footer-summary]').textContent='可遞補 '+snapshot.state.availableSlots+' 名 · 凍結 '+frozenCount()+' 人';
      const input=root.querySelector('#owd-slots');if(document.activeElement!==input)input.value=Number.isFinite(slots)?slots:'';
      input.max=snapshot.state.availableSlots;input.disabled=eligibilityDisabled()||snapshot.state.availableSlots===0;
      root.querySelector('#owd-minus').disabled=eligibilityDisabled()||slots<=1;
      root.querySelector('#owd-plus').disabled=eligibilityDisabled()||slots>=snapshot.state.availableSlots;
      const primary=root.querySelector('#owd-open-draw');primary.disabled=disabled()||!drawAllowed();primary.dataset.owdAction=selectionLock()?'draw':'lock';
      primary.textContent=busy?pending?.action==='draw'?'抽選中…':'處理中…':snapshot.state.availableSlots===0?'目前無空缺':selectionLock()?'開始抽選':'鎖定名單';
      root.querySelector('[data-owd-selection-status]').textContent=selectionLock()?'已鎖定':'已勾選';
      const unlock=root.querySelector('#owd-unlock');unlock.hidden=!selectionLock();unlock.disabled=disabled();
      const status=root.querySelector('#owd-footer-status');status.textContent=footerStatus();status.classList.toggle('is-error',notice?.type==='error');
      const retry=root.querySelector('#owd-retry');retry.hidden=!pending||busy;retry.disabled=busy;
      for(const control of root.querySelectorAll('.owd-secondary-tools button:not(#owd-refresh),.owd-secondary-tools input'))control.disabled=disabled()||!!selectionLock();
      root.querySelector('#owd-refresh').disabled=busy;
      root.querySelector('.owd-notice-slot').innerHTML=renderNotice();
      observeFooter();return true;
    }
    function render(inline=false){
      if(destroyed) return;
      if(inline && renderInline())return;
      const active=focusKey(),scrollX=global.scrollX,scrollY=global.scrollY;
      const scrollers=[];for(let el=root;el;el=el.parentElement){if(el.scrollTop || el.scrollLeft)scrollers.push([el,el.scrollTop,el.scrollLeft]);}
      root.classList.add('owd');
      root.setAttribute('aria-busy',String(busy));
      if(!snapshot){root.innerHTML=`<div class="owd-head"><div><div class="owd-eyebrow">ONSITE WAITLIST</div><h1>現場候補抽籤</h1></div></div>${renderNotice()}<div class="owd-empty">${busy?'正在讀取候補名單…':'尚未載入候補名單'}</div><button data-owd-action="refresh" ${busy?'disabled':''}>重新讀取名單</button>`;return;}
      const s=snapshot.state,w=waiting(),c=candidates(),closed=s.status==='closed';
      if(s.enabled!==true && options.allowConfigure===true){
        root.innerHTML='<section class="owd-main-content" '+(dialog?'inert':'')+'><h2>現場候補抽選</h2><p>切換後，備取由工作人員鎖定名單並抽選；原有正取不變。</p>'+renderNotice()+'<button class="owd-primary" data-owd-action="configure" '+(busy||pending?'disabled':'')+'>啟用現場候補抽選</button>'+(pending?'<button data-owd-action="retry" '+(busy?'disabled':'')+'>確認同一筆操作</button>':'')+'</section>'+renderDialog();
        syncDialogHistory();return;
      }
      const notSelected=s.participants.filter(p=>p.status==='not_selected');
      const all=drawableWaiting().length>0 && c.length===drawableWaiting().length;
      const roster = closed?`<div class="owd-list-head"><h2>未中選名單 <span class="owd-muted owd-small">${notSelected.length} 人</span></h2></div><p class="owd-list-help">系統結束候補 · 不列入取消紀錄</p><div class="owd-list">${notSelected.map((p,i)=>`<div class="owd-person"><span class="owd-index">${String(i+1).padStart(2,'0')}</span><div class="owd-person-main"><div class="owd-name">${escapeHTML(p.name)}</div><div class="owd-person-meta">候補結束，未中選</div></div><span class="owd-tag">未中選</span></div>`).join('')||'<div class="owd-empty">沒有剩餘備取</div>'}</div>`:`<div class="owd-list-head"><h2><span class="owd-step">1</span>本輪抽選名單</h2><div class="owd-roster-counts"><span class="owd-gold owd-small" data-owd-roster-count>${selectedCount()} / ${w.length} 人</span><span class="owd-small owd-frozen-count" data-owd-frozen-count>凍結 ${frozenCount()} 人</span></div></div><p class="owd-list-help">未凍結者預設全選。取消勾選只排除本輪；凍結會暫停後續抽選，解凍後可再參加。放棄則退出本場並保留紀錄。</p><div class="owd-toolbar"><span class="owd-muted" data-owd-toolbar-status>${selectionLock()?'名單已鎖定':c.length?'已勾選 '+c.length+' 人':'尚未勾選抽選名單'}</span><button class="owd-text-btn" data-owd-action="select-all" ${eligibilityDisabled()||!drawableWaiting().length?'disabled':''}>${all?'取消全部勾選':'全部選取'}</button></div><div class="owd-list">${w.map(personRow).join('')||'<div class="owd-empty">已無備取選手</div>'}</div>`;
      const overview=`<section class="owd-card" aria-label="名額概況"><div class="owd-stat-grid"><div class="owd-stat"><strong data-testid="accepted-count">${s.acceptedCount}</strong><span>目前正取</span></div><div class="owd-stat"><strong class="owd-stat-gold" data-testid="available-slots">${s.availableSlots}</strong><span>可遞補空缺</span></div><div class="owd-stat"><strong data-testid="waitlist-count">${w.length}</strong><span>備取人數</span></div></div><div class="owd-protection"><span class="owd-shield" aria-hidden="true">◇</span>原有正取保留，只遞補剩餘空缺</div></section>`;
      const guide=closed?`<section class="owd-closed"><div class="owd-result-icon" aria-hidden="true">✓</div><h2>本場候補已結束</h2><p class="owd-muted owd-small">剩餘備取 ${notSelected.length} 人標示為未中選。<br>沒有取消次數或取消限制。</p></section>`:`<div class="owd-flow-steps" aria-label="抽選流程"><span>1 全選可抽名單，取消本輪不抽的人</span><span>2 鎖定名單與名額</span><span>3 開始抽選</span></div>`;
      const secondary=`<div class="owd-secondary-tools">${closed&&!s.finalized?'<button class="owd-primary" data-owd-action="finalize" '+(busy||pending?'disabled':'')+'>完成抽選，返回賽事管理</button>':''}${!closed?`<div class="owd-end-row"><div><p>現場候補全部結束了？</p><p class="owd-small owd-muted">剩餘備取標示為未中選</p></div><button class="owd-outline" data-owd-action="close" ${staffDisabled()?'disabled':''}>結束候補</button></div>${staffTools()}`:''}${history()}<button id="owd-refresh" class="owd-text-btn" data-owd-action="refresh" ${busy?'disabled':''}>${busy?'處理中…':'↻ 重新讀取名單'}</button></div>`;
      root.innerHTML=`<div class="owd-main-content" ${dialog?'inert':''}><header class="owd-head"><div><div class="owd-eyebrow">ONSITE WAITLIST</div><h1>現場候補抽籤</h1><p class="owd-small owd-muted">${s.finalized?'以下為完成抽選時的歷史紀錄，不代表目前賽事名單。':'選好名單、鎖定後，再公平抽選。'}</p></div><span class="owd-round-chip">${closed?'已結束':'第 '+String(nextRound()).padStart(2,'0')+' 輪'}</span></header><div class="owd-notice-slot">${renderNotice()}</div><div class="owd-layout"><div class="owd-left">${overview}${guide}</div><div class="owd-right">${roster}${drawFollowups()}</div>${secondary}</div>${!closed?renderFooter():''}</div>${renderDialog()}`;
      if(dialog && bodyOverflow===null){bodyOverflow=document.body.style.overflow;document.body.style.overflow='hidden';}
      if(!dialog && bodyOverflow!==null){document.body.style.overflow=bodyOverflow;bodyOverflow=null;}
      syncDialogHistory();observeFooter();
      restoreFocus(active);
      for(const [el,top,left] of scrollers){el.scrollTop=top;el.scrollLeft=left;}
      if(global.scrollX!==scrollX || global.scrollY!==scrollY)global.scrollTo(scrollX,scrollY);
    }
    async function onClick(event){
      const target=event.target.closest('[data-owd-action]');
      if(!target || !root.contains(target) || target.disabled) return;
      const action=target.dataset.owdAction;
      // A double click on Lock must not become a second click on Start after the
      // fast local save changes this same button's phase.
      if(action==='draw' && event.detail>1)return;
      if(action==='backdrop' && event.target!==target) return;
      if(['dismiss','backdrop','dismiss-result'].includes(action)){
        if(busy) return;
        if(action==='dismiss-result' && snapshot.state.availableSlots>0) slots=Math.max(1,Math.min(snapshot.state.availableSlots,candidates().length||1));
        setDialog(dialog?.previous || null);return;
      }
      if(action==='refresh'){await refresh();return;}
      if(action==='configure' && options.allowConfigure===true && snapshot?.state.enabled!==true && !busy && !pending){setDialog({type:'configure'});return;}
      if(action==='confirm-configure' && dialog?.type==='configure' && options.allowConfigure===true){await startMutation('configure',{enabled:true});return;}
      if(action==='finalize' && snapshot?.state.status==='closed' && !snapshot?.state.finalized && !busy && !pending){setDialog({type:'finalize',revision:snapshot.state.revision,hash:snapshot.candidateHash});return;}
      if(action==='confirm-finalize' && dialog?.type==='finalize' && snapshot?.state.status==='closed' && !snapshot?.state.finalized){await startMutation('finalize',{candidateHash:dialog.hash,expectedRevision:dialog.revision});return;}
      if(action==='retry'){if(pending) await commit(pending);return;}
      if(action==='history'){const round=snapshot.state.rounds.find(r=>r.id===target.dataset.round);if(round)setDialog({type:'result',round});return;}
      if(action==='select-all'){setSelection(drawableWaiting().map(p=>p.registrationId),selectedCount()!==drawableWaiting().length);return;}
      if(disabled() && !(['withdraw','confirm-withdraw'].includes(action) && !withdrawDisabled())) return;
      if(action==='freeze'||action==='unfreeze'){
        if(event.detail>1)return; // A double click must not reverse a completed toggle.
        const person=waiting().find(p=>p.registrationId===target.dataset.personId);
        if(person && frozen(person)===(action==='unfreeze'))await startMutation(action,{registrationId:person.registrationId});return;
      }
      if(action==='withdraw'){
        const person=snapshot.state.participants.find(p=>p.registrationId===target.dataset.personId);
        if(canWithdraw(person))setDialog({type:'withdraw',person:Object.assign({},person),previous:dialog});return;
      }
      if(action==='confirm-withdraw' && dialog?.type==='withdraw'){
        await startMutation('withdraw',{registrationId:dialog.person.registrationId});return;
      }
      if(action==='replacement'){
        const withdrawal=pendingReplacements().find(w=>w.id===target.dataset.withdrawalId);
        if(withdrawal)setDialog({type:'replacement',withdrawal});return;
      }
      if(action==='replacement-manual' && dialog?.type==='replacement' && replacementAllowed(dialog.withdrawal)){
        setDialog({type:'replacement-manual',withdrawal:dialog.withdrawal,registrationId:null});return;
      }
      if(action==='replacement-back' && dialog?.type==='replacement-manual'){
        setDialog({type:'replacement',withdrawal:dialog.withdrawal});return;
      }
      if(action==='replacement-random' && dialog?.type==='replacement' && replacementAllowed(dialog.withdrawal)){
        await startMutation('replace',{withdrawalId:dialog.withdrawal.id,mode:'random'});return;
      }
      if(action==='confirm-replacement' && dialog?.type==='replacement-manual' && dialog.registrationId && drawableWaiting().some(p=>p.registrationId===dialog.registrationId) && replacementAllowed(dialog.withdrawal)){
        await startMutation('replace',{withdrawalId:dialog.withdrawal.id,mode:'manual',registrationId:dialog.registrationId});return;
      }
      if(['add-onsite','increase-capacity','minus','plus','close'].includes(action) && selectionLock())return;
      if(action==='add-onsite'){
        const name=String(root.querySelector('#owd-onsite-name')?.value||'').trim();
        if(!name){notice={type:'error',text:'請先填寫現場選手名稱。'};render();return;}
        await startMutation('addOnsite',{name,participantId:'onsite_'+opId(),onsiteEligible:false});return;
      }
      if(action==='increase-capacity'){
        const amount=Number(root.querySelector('#owd-additional')?.value);
        if(!Number.isSafeInteger(amount)||amount<1||snapshot.state.capacity+amount>512){notice={type:'error',text:'請輸入至少 1 名，加開後上限不得超過 512 人。'};render();return;}
        setDialog({type:'capacity',capacity:snapshot.state.capacity+amount});return;
      }
      if(action==='confirm-capacity' && dialog?.type==='capacity'){await startMutation('increaseCapacity',{capacity:dialog.capacity});return;}
      if(action==='minus'||action==='plus'){slots=Math.max(1,Math.min(snapshot.state.availableSlots,(Number(slots)||1)+(action==='plus'?1:-1)));render(true);return;}
      if(action==='lock' && !selectionLock() && validSlots()){
        await startMutation('lock',{registrationIds:candidates().map(p=>p.registrationId),slots});return;
      }
      if(action==='unlock' && selectionLock()){
        await startMutation('unlock',{lockId:selectionLock().id});return;
      }
      if(action==='draw' && selectionLock() && drawAllowed()){
        await startMutation('draw',{lockId:selectionLock().id});return;
      }
      if(action==='close'){await prepare(action);return;}
      if(action==='confirm-close' && dialog?.type==='close'){
        await startMutation('close',{candidateHash:dialog.hash,expectedRevision:dialog.revision});
      }
    }
    async function onChange(event){
      if(event.target.name==='owd-replacement-person' && dialog?.type==='replacement-manual' && !busy && drawableWaiting().some(p=>p.registrationId===event.target.value)){
        dialog.registrationId=event.target.value;root.querySelector('[data-owd-action="confirm-replacement"]').disabled=false;return;
      }
      if(event.target.matches('[data-eligibility]')) setSelection([event.target.dataset.eligibility],event.target.checked);
      if(event.target.id==='owd-slots' && !eligibilityDisabled()) {slots=event.target.value===''?NaN:Number(event.target.value);render(true);}
    }
    function onInput(event){if(event.target.id==='owd-slots' && !eligibilityDisabled()){slots=event.target.value===''?NaN:Number(event.target.value);render(true);}if(event.target.id==='owd-onsite-name')toolDraft.name=event.target.value;if(event.target.id==='owd-additional')toolDraft.additional=event.target.value;}
    function onKeydown(event){
      if(event.repeat && (event.key==='Enter' || event.key===' ')){event.preventDefault();return;}
      if(!dialog) return;
      if(event.key==='Escape' && !busy){event.preventDefault();setDialog(dialog.previous || null);return;}
      if(event.key==='Tab'){
        const focusables=[...root.querySelectorAll('.owd-dialog button:not(:disabled),.owd-dialog input:not(:disabled),.owd-dialog [tabindex="0"]')];
        const first=focusables[0],last=focusables.at(-1);
        if(!first){event.preventDefault();focusDialog();return;}
        if(!root.querySelector('.owd-dialog').contains(document.activeElement)){event.preventDefault();first.focus();return;}
        if(event.shiftKey && (document.activeElement===first || document.activeElement===root.querySelector('.owd-dialog'))){event.preventDefault();last?.focus();}
        else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}
      }
    }
    global.addEventListener('popstate',onPopState);global.addEventListener('resize',updateFooterSpace);
    root.addEventListener('input',onInput);root.addEventListener('click',onClick);root.addEventListener('change',onChange);root.addEventListener('keydown',onKeydown);
    render();refresh();
    return {enabled:true,refresh,destroy(){destroyed=true;footerObserver?.disconnect();global.removeEventListener('popstate',onPopState);global.removeEventListener('resize',updateFooterSpace);if(global.history.state?.owdDialog===historyKey){const state=Object.assign({},global.history.state);delete state.owdDialog;global.history.replaceState(state,'');}root.removeEventListener('input',onInput);root.removeEventListener('click',onClick);root.removeEventListener('change',onChange);root.removeEventListener('keydown',onKeydown);if(bodyOverflow!==null) document.body.style.overflow=bodyOverflow;root.innerHTML='';root.classList.remove('owd');root.style.removeProperty('--owd-footer-space');},getState:()=>snapshot?.state};
  }
  global.BXHOnsiteWaitlistDraw=Object.freeze({mount,version:'0.4.0-production'});
})(window);
