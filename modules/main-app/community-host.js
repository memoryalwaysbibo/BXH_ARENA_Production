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
  if(communityEventsCache===null && !communityEventsLoading && !communityEventsError){ setTimeout(()=>handleAction("community-load-events",{getAttribute:()=>null}),0); }
  if(communityEventsLoading && communityEventsCache===null) return `<div class="panel community-host-loading">
    <div class="empty-state"><div class="big">正在讀取房間資料…</div><div class="hint">正在同步房間與主辦紀錄，手機網路第一次讀取可能需要數秒。</div></div>
  </div>`;
  if(communityEventsError && communityEventsCache===null) return `<div class="panel community-host-loading">
    <div class="empty-state"><div class="big">房間資料讀取逾時</div><div class="hint">${esc(communityEventsError)}</div></div>
    <div class="btn-row" style="justify-content:center;margin-top:12px;"><button class="btn btn-primary" data-action="community-load-events">重新連線</button></div>
  </div>`;
  const rooms=communityEventsCache||[],history=communityHistoryCache||[];
  const card=t=>`<div class="community-event-card"><div class="community-event-name">${esc(t.name||"未命名賽事")}</div><div class="hint">${esc(t.eventDate||"日期未設定")}｜${esc(t.location||"")}｜${esc(t.code)}</div><div class="hint">${esc(communityPhaseLabel(t))}｜${esc(communityExpiryLabel(t))}</div><div class="btn-row"><button class="btn btn-primary btn-sm" data-action="community-open-room" data-code="${esc(t.code)}">${schedulePhase(t)==='done'?'查看完賽房間':'開啟房間'}</button><button class="btn btn-ghost btn-sm" data-action="community-copy-code" data-code="${esc(t.code)}">複製代碼</button><button class="btn btn-danger btn-sm" data-action="community-delete-room" data-code="${esc(t.code)}" data-name="${esc(t.name||'未命名賽事')}">刪除</button></div></div>`;
  return `<div class="panel community-host-hero"><div class="panel-title">我的房間</div><p class="hint">建立你的陀螺賽事，自訂賽制、邀請朋友一起對戰。</p><div class="room-create-action"><button class="btn btn-primary" data-action="community-create-open">＋ 建立房間</button></div><p class="room-policy">房間屬於一般賽事，不計入 BXH 天梯。只有房主、尚無其他參賽者且未建立賽程的空白房，連續 6 小時無操作後清理；已有名單／賽程或進行中的房間連續 24 小時無操作後清理。已排定未來活動且有名單或對戰架構者，至少保留至活動日後 14 天。已完成房間持續保留，可自行刪除；完賽摘要保留於「我的主辦紀錄」。</p></div>
  ${communityEventsError?`<div class="auth-error">${esc(communityEventsError)}</div>`:''}
  ${scheduleGroups('rooms',rooms,card)}
  ${foldSection('host-history','我的主辦紀錄',history.length,`<p class="hint">完成主辦場數（一般＋正式）：${hostAchievementCount===null?'同步中':hostAchievementCount<0?'暫時無法同步，請重新整理':hostAchievementCount}（經伺服器驗證；測試與系統關閉不計入）</p>`+history.map(h=>`<div class="community-history-card"><b>${esc(h.name||'未命名賽事')}</b><div class="hint">${esc(h.eventDate||'')}｜${Number(h.playerCount||0)} 人｜${esc(h.format||'')}</div><div class="hint">冠軍：${esc(h.championName||'—')}　亞軍：${esc(h.runnerUpName||'—')}</div></div>`).join(''),false)}`;
}


function renderCommunityCreateScreen(){
  const hostName=String(userProfile?.gameId||userProfile?.displayName||userProfile?.nickname||userProfile?.realName||firebaseUser?.email||"玩家").trim();
  return authShellOpen("","community-create-content","community-create-shell")+`<div class="community-create-topbar"><button class="btn btn-ghost" type="button" data-action="community-create-cancel">← 返回我的房間</button></div>${authBrandHeader()}<div class="auth-card community-create-card">
    <div class="auth-card-title">快速開房</div>
    <div class="banner"><span>玩家主辦｜一般賽事｜不計 BXH 天梯積分</span></div>
    <p class="hint">房間名稱：${esc(hostName)}的房間｜日期與時間以建立當下的台灣時間為準。</p>
    <div class="field"><label>開房模式</label><select id="community-format"><option value="single">單淘汰賽</option><option value="double">雙敗制</option><option value="roundrobin">單循環賽</option></select></div>
    <label class="settings-check-row"><input id="community-registration-enabled" type="checkbox"><span><b>開放線上報名</b><small style="display:block;color:var(--metal-dim)">勾選後建立房間即可報名，不用設定時間。</small></span></label>
    <div class="field"><label>人數上限（選填）</label><input id="community-capacity" type="number" min="1" step="1" placeholder="留空不限人數"><small class="hint">沒填就沒上限；有填就依設定，包含參賽中的房主與現場選手。</small></div>
    <button class="hoc-btn hoc-btn-primary btn-block" data-action="community-create-submit" ${communityCreateSaving?"disabled":""}>${communityCreateSaving?"建立中…":"建立房間"}</button>
    <div class="auth-links"><button class="link-btn" data-action="community-create-cancel">返回我的房間</button></div>
  </div>`+authShellClose();
}
function renderCommunitySettings(){
  const m=state.meta||{},reg=!!m.registrationEnabled,quickRegistration=m.battleMode!=="team",accessLocked=!!state.startedAt||!!state.bracketSize||(state.matches||[]).some(x=>!x?.isBye)||state.archiveStatus==="completed";
  return `<div class="panel"><div class="panel-title">一般賽事設定 <span class="badge badge-metal">COMMUNITY</span></div>
    <div class="banner"><span>玩家一般賽事可開放線上報名；固定不計 BXH 官方天梯積分。</span></div>
    ${window.__BXH_COMMUNITY_SUMMARY_STATUS?.[state.cloudCode]?.ok===false?'<div class="banner warn"><span>設定已儲存，參賽人數摘要尚未同步。</span><button class="btn btn-ghost btn-sm" data-action="community-sync-summary">重新同步人數</button></div>':""}
    <div class="grid grid-2"><div class="field"><label>賽事名稱</label><input id="cset-name" value="${esc(m.name||"")}"></div><div class="field"><label>活動日期</label><input id="cset-date" type="date" value="${esc(m.date||"")}"></div><div class="field"><label>活動地點</label><input id="cset-location" value="${esc(m.location||"")}"></div><div class="field"><label>開賽時間</label><input id="cset-start" type="time" step="1800" value="${esc(m.startTime||"")}"></div></div>
    <div class="grid grid-2"><div class="field"><label>賽制</label><select id="cset-format"><option value="single" ${m.formatType==="single"?"selected":""}>單淘汰賽</option><option value="double" ${m.formatType==="double"?"selected":""}>雙敗制</option><option value="roundrobin" ${m.formatType==="roundrobin"?"selected":""}>單循環賽</option></select></div><div class="field"><label>戰鬥台數</label><input id="cset-stations" type="number" min="1" max="16" value="${Number(m.stations||1)}"></div></div>
    <div class="panel" style="margin-top:14px">
      <label class="settings-check-row"><input id="cset-registration-enabled" type="checkbox" ${reg?"checked":""}><span><b>開放線上報名</b><small style="display:block;color:var(--metal-dim)">${quickRegistration?"勾選並儲存後即可報名；未設定時間時，持續開放到房主關閉報名或開賽。":"團體賽沿用排程報名，需設定正取隊伍上限與報名開放／截止時間。"}</small></span></label>
      <div class="field" style="margin-top:12px"><label>${quickRegistration?"人數上限（選填）":"正取隊伍上限"}</label><input id="cset-capacity" type="number" min="1" step="1" value="${Number(m.registrationCapacity)>0?esc(String(m.registrationCapacity)):quickRegistration?"":"16"}" placeholder="${quickRegistration?"留空不限人數":"請填寫正整數"}"><small class="hint">${quickRegistration?"沒填就沒上限；有填就依設定，包含參賽中的房主與現場選手。":"團體賽名額以隊伍計算，須填寫正整數。"}</small></div>
      <details class="settings-accordion" ${!quickRegistration||m.registrationOpenAt||m.registrationCloseAt||m.cancellationDeadline||m.waitlistCapacity?"open":""}><summary><span>${quickRegistration?"進階設定（選填）：備取與排程":"團體賽報名排程與備取"}</span></summary><div class="grid grid-2" style="margin-top:12px">
        <div class="field"><label>備取名額</label><input id="cset-waitlist" type="number" min="0" step="1" value="${Number(m.waitlistCapacity||0)}"></div>
        <div class="field"><label>${quickRegistration?"報名開放時間（留空立即開放）":"報名開放時間（開放報名時必填）"}</label><input id="cset-reg-open" type="datetime-local" value="${esc(communityDateTimeValue(m.registrationOpenAt))}"></div>
        <div class="field"><label>${quickRegistration?"報名截止時間（選填）":"報名截止時間（開放報名時必填）"}</label><input id="cset-reg-close" type="datetime-local" value="${esc(communityDateTimeValue(m.registrationCloseAt))}"></div>
        <div class="field"><label>${quickRegistration?"取消報名期限（留空可於開賽前取消）":"取消報名期限（留空沿用報名截止時間）"}</label><input id="cset-reg-cancel" type="datetime-local" value="${esc(communityDateTimeValue(m.cancellationDeadline))}"></div>
      </div><p class="hint">${quickRegistration?"已有排程會保留；清空開放／截止時間後，改用立即開放與房主手動關閉。":"團體賽保留既有排程報名方式。"}</p></details>
    </div>
    <div class="panel" style="margin-top:14px"><div class="panel-title">🔐 房間存取</div><div class="grid grid-2"><div class="field"><label>房間類型</label><select id="cset-access-mode" ${accessLocked?"disabled":""}><option value="public" ${m.roomAccessMode!=="password"?"selected":""}>公開房間</option><option value="password" ${m.roomAccessMode==="password"?"selected":""}>密碼房間</option></select></div><div class="field"><label>房間密碼</label><input id="cset-access-password" type="password" maxlength="20" autocomplete="new-password" ${accessLocked?"disabled":""} placeholder="${m.roomAccessMode==="password"?"留空保留原密碼；輸入新值可重設":"切換為密碼房時輸入 4～20 字元"}"></div></div><p class="hint">${accessLocked?"比賽已開始或已建立對戰結構，房間存取設定已鎖定。":"切換或重設密碼會撤銷舊的 Access Grant；玩家需以新密碼重新解鎖。密碼不會寫入公開房間資料。"}</p></div>
    <div class="btn-row"><button class="btn btn-primary" data-action="community-save-settings" ${communitySettingsSaving?"disabled":""}>${communitySettingsSaving?"儲存中…":"儲存一般賽事設定"}</button><button class="btn btn-ghost" data-action="community-copy-code" data-code="${esc(state.cloudCode||"")}">複製房間代碼</button><button class="btn btn-ghost" data-action="open-share-modal">分享賽事／QR</button></div>
  </div>`;
}
function renderCommunityRoomApp(){
  const tabs=[["live","即時戰況"],["bracket","對戰表"],["referee","裁判台"],["people","人員管理"],["settings","賽事設定"]];
  let content=communityRoomActiveTab==="bracket"?renderBracket():communityRoomActiveTab==="referee"?renderReferee():communityRoomActiveTab==="people"?renderPeopleManagement():communityRoomActiveTab==="settings"?renderCommunitySettings():renderLive();
  const exp=communityRoomExpiryMs(state);
  return `<div class="stickytop"><header class="topbar"><button type="button" class="logo-wrap logo-refresh-button" data-action="header-refresh" aria-label="重新整理並讀取最新資訊" title="重新整理並讀取最新資訊"><div class="logo-glow"></div><img class="logo" src="${LOGO_SRC}" alt="BXH"></button><div class="brandtext"><span class="t1"><span class="w-bxh">BXH</span><span class="w-arena">ARENA</span></span><span class="t2">玩家一般賽事</span>${topbarConnectionRailHtml()}</div><div class="spacer"></div><img class="directive-warning-layer" src="./assets/ui/bxh-directive-warning.webp?v=20260927-2325" alt="" aria-hidden="true"><span class="badge badge-metal">一般賽事｜不計積分</span><button class="btn btn-ghost btn-sm" data-action="community-exit-room">返回我的房間</button></header>
  <div class="community-room-notice">主辦人：${esc((userProfile&& (userProfile.displayName||userProfile.realName))||"玩家")}　｜　代碼 ${esc(state.cloudCode||"—")}　｜　完整房間預計保留至 ${exp?new Date(exp).toLocaleString():"—"}</div>
  ${communityRoomActiveTab!=="settings"&&window.__BXH_COMMUNITY_SUMMARY_STATUS?.[state.cloudCode]?.ok===false?'<div class="banner warn"><span>設定已儲存，參賽人數摘要尚未同步。</span><button class="btn btn-ghost btn-sm" data-action="community-sync-summary">重新同步人數</button></div>':""}
  <nav class="tabs">${tabs.map(t=>`<button class="${communityRoomActiveTab===t[0]?"active":""}" data-action="community-switch-room-tab" data-tab="${t[0]}">${t[1]}</button>`).join("")}</nav></div><main>${content}</main>${renderModal()}${celebrationOpen?renderCelebrationOverlay():""}${shareModalOpen?renderShareModal():""}${renderEventEntryModal()}${renderQrScannerModal()}`;
}

Object.assign(window.BXHCommunityHostFeature||(window.BXHCommunityHostFeature={}),{communityPhaseLabel,communityExpiryLabel,renderPlayerCommunityHostTab,renderCommunityCreateScreen,renderCommunitySettings,renderCommunityRoomApp});

})();
