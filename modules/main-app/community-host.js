(function(){
// Core Phase 2D — Community Host / player room feature module.
// Keeps community-room labels, host rendering, create/settings and room shell together.
function communityPhaseLabel(t){
  if(t.systemClosed||(t.parsedData?.systemClosure&&!t.parsedData.systemClosure.restoredAt))return "比賽結束（系統關閉）";
  const p=canonicalPublicTournamentPhase(t);
  return p==="cancelled"?"已取消":p==="done"?"已結束":p==="settling"?"結算中":p==="live"?"比賽中":"等待開始";
}
function communityExpiryLabel(t){
  if(schedulePhase(t)==="done")return "完整房間保留，可自行刪除；主辦摘要持續保留";
  const raw=t.expiresAt;
  let ms=0;
  try{ ms=raw&&typeof raw.toMillis==="function"?raw.toMillis():Number(raw||0); }catch(e){}
  if(!ms) return "依房間生命週期自動清理";
  return new Date(ms).toLocaleString()+" 前保留完整房間";
}
function renderPlayerCommunityHostTab(){
  const ownerUid=currentAuthUid();
  resetCommunityHostOnAccountChange(ownerUid);
  if(ownerUid && communityEventsCache===null && !communityEventsLoading && !communityEventsError){
    setTimeout(()=>{
      if(appPhase==="player-center" && playerActiveTab==="host" && currentAuthUid()===ownerUid && communityEventsCache===null && !communityEventsError){
        handleAction("community-load-events",{getAttribute:()=>null});
      }
    },0);
  }
  if(ownerUid && communityEventsCache===null && !communityEventsError) return `<div class="panel community-host-loading">
    <div class="empty-state"><div class="big">正在讀取房間資料…</div></div>
  </div>`;
  if(communityEventsError && communityEventsCache===null) return `<div class="panel community-host-loading">
    <div class="empty-state"><div class="big">房間讀取未完成</div><div class="hint">${esc(communityEventsError)}</div></div>
    <div class="btn-row" style="justify-content:center;margin-top:12px;"><button class="btn btn-primary" data-action="community-load-events">重新連線</button></div>
  </div>`;
  const rooms=communityEventsCache||[],history=communityHistoryCache||[];
  const card=t=>`<div class="community-event-card"><div class="community-event-name">${esc(t.name||"未命名賽事")}</div><div class="hint">${esc(t.eventDate||"日期未設定")}｜${esc(t.location||"")}｜${esc(t.code)}</div><div class="hint">${esc(communityPhaseLabel(t))}｜${esc(communityExpiryLabel(t))}</div><div class="btn-row"><button class="btn btn-primary btn-sm" data-action="community-open-room" data-code="${esc(t.code)}">${schedulePhase(t)==='done'?'查看完賽房間':'開啟房間'}</button><button class="btn btn-ghost btn-sm" data-action="community-copy-code" data-code="${esc(t.code)}">複製代碼</button><button class="btn btn-danger btn-sm" data-action="community-delete-room" data-code="${esc(t.code)}" data-name="${esc(t.name||'未命名賽事')}">刪除</button></div></div>`;
  return `<div class="panel community-host-hero"><div class="panel-title">我的房間</div><p class="hint">建立你的陀螺賽事，自訂賽制、邀請朋友一起對戰。</p><div class="room-create-action"><button class="btn btn-primary" data-action="community-create-open">＋ 建立房間</button></div><p class="room-policy">房間屬於一般賽事，不計入 BXH 天梯。只有房主、尚無其他參賽者且未建立賽程的空白房，連續 6 小時無操作後清理；已有名單／賽程或進行中的房間連續 24 小時無操作後清理。已排定未來活動且有名單或對戰架構者，至少保留至活動日後 14 天。已完成房間持續保留，可自行刪除；完賽摘要保留於「我的主辦紀錄」。</p></div>
  ${communityEventsError?`<div class="auth-error">${esc(communityEventsError)}</div>`:''}
  ${scheduleGroups('rooms',rooms,card)}
  ${foldSection('host-history','我的主辦紀錄',communityHistoryCache===null?'…':history.length,`<p class="hint">完成主辦場數（一般＋正式）：${hostAchievementCount===null?'同步中':hostAchievementCount<0?'暫時無法同步，請重新整理':hostAchievementCount}（經伺服器驗證；測試與系統關閉不計入）</p>`+history.map(h=>`<div class="community-history-card"><b>${esc(h.name||'未命名賽事')}</b><div class="hint">${esc(h.eventDate||'')}｜${Number(h.playerCount||0)} 人｜${esc(h.format||'')}</div><div class="hint">冠軍：${esc(h.championName||'—')}　亞軍：${esc(h.runnerUpName||'—')}</div></div>`).join(''),false)}`;
}


function renderCommunityCreateScreen(){
  const hostName=String(userProfile?.gameId||userProfile?.displayName||userProfile?.nickname||userProfile?.realName||firebaseUser?.email||"玩家").trim();
  return authShellOpen("","community-create-content","community-create-shell")+`<div class="community-create-topbar"><button class="btn btn-ghost" type="button" data-action="community-create-cancel">← 返回我的房間</button></div>${authBrandHeader()}<div class="auth-card community-create-card">
    <div class="auth-card-title">快速開房</div>
    <p class="hint">玩家一般賽事，不計 BXH 天梯積分。</p>
    <div class="field"><label for="community-name">房間名稱</label><input id="community-name" type="text" value="${esc(hostName)}的房間"></div>
    <div class="community-settings-grid community-settings-pair">
      <div class="field"><label for="community-format">賽制</label><select id="community-format"><option value="single">單淘汰賽</option><option value="double">雙敗制</option><option value="roundrobin">單循環賽</option></select></div>
      <div class="field"><label for="community-stations">戰鬥台數</label><input id="community-stations" type="number" min="1" max="16" step="1" value="1"></div>
    </div>
    <div class="field"><label for="community-name-mode">參賽名稱</label><select id="community-name-mode" aria-describedby="community-name-mode-hint"><option value="realName">本名</option><option value="gameId">ID</option><option value="any">不限</option></select><small class="hint" id="community-name-mode-hint">不限時依個人資料的名稱偏好；未設定 ID 時使用本名。名稱於報名時保存。</small></div>
    <div class="field"><label for="community-capacity">人數上限（選填）</label><input id="community-capacity" type="number" min="1" step="1" placeholder="留空不限人數"></div>
    <label class="settings-check-row"><input id="community-registration-enabled" type="checkbox"><span><b>開放線上報名</b><small class="hint">開房後立即開放報名。</small></span></label>
    <button class="hoc-btn hoc-btn-primary btn-block" data-action="community-create-submit" ${communityCreateSaving?"disabled":""}>${communityCreateSaving?"建立中…":"立即開房"}</button>
  </div>`+authShellClose();
}
function renderCommunitySettings(){
  const m=state.meta||{},reg=!!m.registrationEnabled,quickRegistration=m.battleMode!=="team",accessLocked=!!state.startedAt||!!state.bracketSize||(state.matches||[]).some(x=>!x?.isBye)||state.archiveStatus==="completed";
  const registrationLocked=onsiteRegistrationSettingsLocked();
  const hasSchedule=!!(m.registrationOpenAt||m.registrationCloseAt||m.cancellationDeadline||m.waitlistCapacity);
  return `<section class="panel community-settings">
    <div class="panel-title">房間設定</div>
    <p class="hint">參賽名稱：${m.participantNameMode==='any'?'不限（依個人名稱偏好）':m.participantNameMode==='gameId'?'ID（未設定時使用本名）':'本名'}。已報名選手保留報名時的名稱。</p>
    ${window.__BXH_COMMUNITY_SUMMARY_STATUS?.[state.cloudCode]?.ok===false?'<div class="banner warn"><span>設定已儲存，參賽人數摘要尚未同步。</span><button class="btn btn-ghost btn-sm" data-action="community-sync-summary">重新同步人數</button></div>':""}
    <div class="field"><label for="cset-name">房間名稱</label><input id="cset-name" type="text" value="${esc(m.name||"")}"></div>
    <div class="community-settings-grid community-settings-pair">
      <div class="field"><label for="cset-format">賽制</label><select id="cset-format"><option value="single" ${m.formatType==="single"?"selected":""}>單淘汰賽</option><option value="double" ${m.formatType==="double"?"selected":""}>雙敗制</option><option value="roundrobin" ${m.formatType==="roundrobin"?"selected":""}>單循環賽</option></select></div>
      <div class="field"><label for="cset-stations">戰鬥台數</label><input id="cset-stations" type="number" min="1" max="16" value="${Number(m.stations||1)}"></div>
    </div>
    ${managedRegistrationSettingsNotice()}
    <fieldset class="community-settings-fieldset" ${registrationLocked?'disabled aria-describedby="onsite-registration-lock-notice"':""}>
      <div class="field"><label for="cset-capacity">${quickRegistration?"人數上限（選填）":"正取隊伍上限"}</label><input id="cset-capacity" type="number" min="1" step="1" value="${Number(m.registrationCapacity)>0?esc(String(m.registrationCapacity)):quickRegistration?"":"16"}" placeholder="${quickRegistration?"留空不限人數":"請填寫正整數"}"><small class="hint">${quickRegistration?"上限包含參賽的房主和現場選手。":"團體賽名額以隊伍計算，須填寫正整數。"}</small></div>
      <details id="community-settings-registration" class="settings-accordion" ${!quickRegistration||reg||hasSchedule?"open":""}>
        <summary><span>線上報名、備取與排程</span></summary>
        <div class="settings-accordion-body">
          <label class="settings-check-row"><input id="cset-registration-enabled" type="checkbox" ${reg?"checked":""}><span><b>開放線上報名</b><small class="hint">${quickRegistration?"留空開放時間，儲存後即開放報名。":"團體賽沿用排程報名。正取隊伍上限與報名開放／截止時間於開放報名時必填。"}</small></span></label>
          <div class="community-settings-grid">
            <div class="field"><label for="cset-waitlist">備取名額</label><input id="cset-waitlist" type="number" min="0" step="1" value="${Number(m.waitlistCapacity||0)}"></div>
            <div class="field"><label for="cset-reg-open">${quickRegistration?"報名開放時間（選填）":"報名開放時間"}</label><input id="cset-reg-open" type="datetime-local" value="${esc(communityDateTimeValue(m.registrationOpenAt))}"></div>
            <div class="field"><label for="cset-reg-close">${quickRegistration?"報名截止時間（選填）":"報名截止時間"}</label><input id="cset-reg-close" type="datetime-local" value="${esc(communityDateTimeValue(m.registrationCloseAt))}"></div>
            <div class="field"><label for="cset-reg-cancel">取消報名期限（選填）</label><input id="cset-reg-cancel" type="datetime-local" value="${esc(communityDateTimeValue(m.cancellationDeadline))}"></div>
          </div>
          <p class="hint">${quickRegistration?"未設定截止時間時，報名開放到房主關閉報名或開賽。未設定取消期限時，玩家可在開賽前取消。":"未設定取消期限時，沿用報名截止時間。"}</p>
        </div>
      </details>
    </fieldset>
    <details id="community-settings-schedule" class="settings-accordion">
      <summary><span>活動日期、時間與地點</span></summary>
      <div class="settings-accordion-body community-settings-grid">
        <div class="field"><label for="cset-date">活動日期</label><input id="cset-date" type="date" value="${esc(m.date||"")}"></div>
        <div class="field"><label for="cset-start">開賽時間</label><input id="cset-start" type="time" value="${esc(m.startTime||"")}"></div>
        <div class="field"><label for="cset-location">活動地點</label><input id="cset-location" type="text" value="${esc(m.location||"")}"></div>
      </div>
    </details>
    <details id="community-settings-access" class="settings-accordion">
      <summary><span>房間存取與密碼</span></summary>
      <div class="settings-accordion-body community-settings-access">
        <div class="community-settings-grid">
          <div class="field"><label for="cset-access-mode">房間類型</label><select id="cset-access-mode" ${accessLocked?"disabled":""}><option value="public" ${m.roomAccessMode!=="password"?"selected":""}>公開房間</option><option value="password" ${m.roomAccessMode==="password"?"selected":""}>密碼房間</option></select></div>
          <div class="field community-settings-password"><label for="cset-access-password">房間密碼</label><input id="cset-access-password" type="password" maxlength="20" autocomplete="new-password" ${accessLocked?"disabled":""} placeholder="${m.roomAccessMode==="password"?"留空保留原密碼":"輸入 4～20 字元"}"></div>
        </div>
        <p class="hint">${accessLocked?"比賽已開始或已建立對戰表，房間存取設定已鎖定。":"變更密碼後，已解鎖的玩家需重新輸入。"}</p>
      </div>
    </details>
    <div class="community-settings-save"><button class="btn btn-primary" data-action="community-save-settings" ${communitySettingsSaving||(registrationLocked&&state.onsiteWaitlistFinalized!==true)?"disabled":""}>${communitySettingsSaving?"儲存中…":registrationLocked&&state.onsiteWaitlistFinalized!==true?"候補抽選中・暫停儲存":"儲存一般賽事設定"}</button></div>
  </section>`;
}
function renderCommunityRoomOverview(){
  const code=state.cloudCode;
  const canPrepare=!state.startedAt&&!state.meta?.eventCancelled&&state.archiveStatus!=="completed"&&!(state.systemClosure&&!state.systemClosure.restoredAt);
  const canStart=canPrepare&&state.bracketSize&&state.matches.length;
  return `<section class="panel community-room-overview" aria-label="房間總覽">
    <div class="hint">玩家一般賽事 · 不計天梯積分</div>
    <h1>${esc(state.meta?.name||"未命名房間")}</h1>
    ${code?`<div class="community-room-code"><span>房間代碼</span><strong>${esc(code)}</strong></div>
    <div class="community-room-actions"><button class="btn btn-ghost" data-action="community-copy-code" data-code="${esc(code)}">複製代碼</button><button class="btn btn-ghost" data-action="open-share-modal">分享／QR</button></div>`:""}
    ${canStart?`<button class="btn btn-primary btn-block" data-action="start-tournament" ${bracketCommitBlocked()?"disabled":""}>開始比賽</button>`:canPrepare?'<button class="btn btn-primary btn-block" data-action="community-switch-room-tab" data-tab="people" data-section="bracket">抽籤與開賽</button>':""}
  </section>`;
}
function renderCommunityRoomApp(){
  const tabs=[["live","房間總覽"],["bracket","對戰表"],["referee","裁判台"],["people","人員管理"],["settings","賽事設定"]];
  let content=communityRoomActiveTab==="bracket"?renderBracket():communityRoomActiveTab==="referee"?renderReferee():communityRoomActiveTab==="people"?renderPeopleManagement():communityRoomActiveTab==="settings"?renderCommunitySettings():renderCommunityRoomOverview()+renderLive();
  const exp=communityRoomExpiryMs(state);
  return `<div class="stickytop"><header class="topbar"><button type="button" class="logo-wrap logo-refresh-button" data-action="header-refresh" aria-label="重新整理並讀取最新資訊" title="重新整理並讀取最新資訊"><div class="logo-glow"></div><img class="logo" src="${LOGO_SRC}" alt="BXH"></button><div class="brandtext"><span class="t1"><span class="w-bxh">BXH</span><span class="w-arena">ARENA</span></span><span class="t2">玩家一般賽事</span>${topbarConnectionRailHtml()}</div><div class="spacer"></div><span class="three-gods-puzzle-layer" aria-hidden="true"></span><span class="hunter-license-layer" aria-hidden="true"></span><span class="akatsuki-red-cloud-layer" aria-hidden="true"></span><span class="clow-seal-layer" aria-hidden="true"></span><span class="zeon-emblem-layer" aria-hidden="true"></span><span class="gundam-haro-layer" aria-hidden="true"></span><img class="directive-warning-layer" src="./assets/ui/bxh-directive-warning.webp?v=20260927-2325" alt="" aria-hidden="true"><span class="badge badge-metal">一般賽事｜不計積分</span><button class="btn btn-ghost btn-sm" data-action="community-exit-room">返回我的房間</button></header>
  <div class="community-room-notice">主辦人：${esc((userProfile&& (userProfile.displayName||userProfile.realName))||"玩家")}　｜　代碼 ${esc(state.cloudCode||"—")}　｜　完整房間預計保留至 ${exp?new Date(exp).toLocaleString():"—"}</div>
  ${communityRoomActiveTab!=="settings"&&window.__BXH_COMMUNITY_SUMMARY_STATUS?.[state.cloudCode]?.ok===false?'<div class="banner warn"><span>設定已儲存，參賽人數摘要尚未同步。</span><button class="btn btn-ghost btn-sm" data-action="community-sync-summary">重新同步人數</button></div>':""}
  <nav class="tabs community-room-tabs" aria-label="房間管理">${tabs.map(t=>`<button class="${communityRoomActiveTab===t[0]?"active":""}" data-action="community-switch-room-tab" data-tab="${t[0]}" ${communityRoomActiveTab===t[0]?'aria-current="page"':""}>${t[1]}</button>`).join("")}</nav></div><main>${content}</main>${renderModal()}${celebrationOpen?renderCelebrationOverlay():""}${shareModalOpen?renderShareModal():""}${renderEventEntryModal()}${renderQrScannerModal()}`;
}

Object.assign(window.BXHCommunityHostFeature||(window.BXHCommunityHostFeature={}),{communityPhaseLabel,communityExpiryLabel,renderPlayerCommunityHostTab,renderCommunityCreateScreen,renderCommunitySettings,renderCommunityRoomOverview,renderCommunityRoomApp});

})();

