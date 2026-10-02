// Core Phase 2A — Share / QR feature module.
// Cohesive feature extraction: share targets, URL/text composition, QR scheduling and modal rendering.
// Runtime dependencies (state, shareTarget, tournamentStatus, QR renderer, esc, LOGO_SRC) remain owned by main app.

const SHARE_TARGET_CONFIG = {
  event:{label:"活動入口",description:"掃描後選擇報名或觀賽"},
  register:{label:"玩家報名",description:"登入後直接開啟報名頁"},
  watch:{label:"即時觀賽",description:"直接查看公開即時戰況"},
  bracket:{label:"完整對戰表",description:"直接查看公開對戰表"},
  result:{label:"賽事結果",description:"賽後查看最終對戰與名次"}
};
function shareTargetEnabled(target){
  if(!state.cloudCode) return false;
  if(target==="register") return !!(state.meta&&state.meta.registrationEnabled&&state.meta.publishedAt);
  if(target==="result") return tournamentStatus()==="done";
  return true;
}
function currentShareUrl(){ return state.cloudCode?buildTournamentEntryUrl(state.cloudCode,shareTarget):""; }
function currentShareText(){
  const cfg=SHARE_TARGET_CONFIG[shareTarget]||SHARE_TARGET_CONFIG.event;
  const lines=["⚔️ BXH ARENA｜"+cfg.label,"賽事："+(state.meta.name||"未命名賽事")];
  if(state.meta.date) lines.push("日期："+state.meta.date+(state.meta.startTime?" "+state.meta.startTime:""));
  if(state.meta.location) lines.push("地點："+state.meta.location);
  lines.push(cfg.description);
  return lines.join("\n");
}
function renderCurrentShareQr(){
  const url=currentShareUrl();
  setTimeout(()=>{
    renderQrCodeInto("share-center-qr",url,216);
  },0);
}

function renderShareModal(){
  if(!shareModalOpen) return "";
  if(!SHARE_TARGET_CONFIG[shareTarget]) shareTarget="event";
  const canNativeShare = (typeof navigator!=="undefined" && typeof navigator.share==="function");
  const hasLink=!!state.cloudCode;
  const url=hasLink?currentShareUrl():"";
  const cfg=SHARE_TARGET_CONFIG[shareTarget];
  if(hasLink) renderCurrentShareQr();
  return `<div class="modal-overlay" data-action="close-share-modal">
    <div class="modal-box share-modal-box">
      <div class="share-modal-header">
        <img src="${LOGO_SRC}" alt="" class="share-modal-logo">
        <div>
          <h3 style="margin:0;">分享賽事</h3>
          <div class="hint" style="margin-top:2px;">${esc(state.meta.name||"未命名賽事")}</div>
        </div>
      </div>
      <div class="share-target-tabs" style="margin-top:14px;">
        ${Object.entries(SHARE_TARGET_CONFIG).map(([key,item])=>`<button class="btn btn-sm ${shareTarget===key?'btn-primary':'btn-ghost'}" data-action="share-select-target" data-target="${key}" ${shareTargetEnabled(key)?'':'disabled'}>${item.label}</button>`).join("")}
      </div>
      ${hasLink?`<div class="hint" style="text-align:center;margin-top:6px;"><b>${esc(cfg.label)}</b>｜${esc(cfg.description)}</div>
      <div id="share-center-qr" class="share-qr-box"></div>
      <div class="share-summary-box" style="word-break:break-all;font-size:12px;">${esc(url)}</div>
      <div class="btn-row" style="margin-top:12px;flex-direction:column;align-items:stretch;">
        <button class="btn btn-primary" data-action="share-copy-url">複製${esc(cfg.label)}網址</button>
        ${canNativeShare?`<button class="btn btn-ghost" data-action="share-native">系統分享</button>`:""}
        <div class="btn-row"><button class="btn btn-ghost" data-action="share-download-qr">下載 QR</button><button class="btn btn-ghost" data-action="share-fullscreen-qr">全螢幕 QR</button></div>
      </div>`:`<div class="banner" style="margin-top:14px;"><span>尚未建立雲端賽事代碼，請先完成賽事架構並發布。</span></div>`}
      <div class="share-summary-box">${esc(currentShareText()).replace(/\n/g,"<br>")}</div>
      <div class="btn-row" style="margin-top:10px;flex-direction:column;align-items:stretch;">
        <button class="btn btn-ghost" data-action="share-copy-summary">複製分享文字</button>
      </div>
      <div class="hint" style="margin-top:10px;text-align:center;">JSON 匯入／匯出已回歸資料備份功能，不再與對外分享混用。</div>
      <div class="btn-row" style="margin-top:10px;">
        <button class="btn btn-ghost btn-block" data-action="close-share-modal">關閉</button>
      </div>
    </div>
  </div>`;
}

Object.assign(window.BXHShareFeature||(window.BXHShareFeature={}),{SHARE_TARGET_CONFIG,shareTargetEnabled,currentShareUrl,currentShareText,renderCurrentShareQr,renderShareModal});
