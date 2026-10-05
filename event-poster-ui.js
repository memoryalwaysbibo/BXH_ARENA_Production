(function(root){
"use strict";
const MAX_FILE_BYTES=6*1024*1024;
const POSTER_URL=/^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/bxh-arena\.firebasestorage\.app\/o\/room-posters%2FBXH-[A-Z0-9-]{4,24}%2F[a-f0-9-]{36}\.(?:jpg|png)\?alt=media&token=[a-f0-9-]{36}$/;
function safePosterUrl(value){return typeof value==="string"&&POSTER_URL.test(value)?value:"";}
function validatePosterFile(file){
  if(!file)return {ok:false,reason:"missing-file"};
  if(!["image/jpeg","image/png"].includes(file.type))return {ok:false,reason:"format"};
  if(!Number.isFinite(file.size)||file.size<1||file.size>MAX_FILE_BYTES)return {ok:false,reason:"size"};
  return {ok:true};
}
function distance(a,b){const dx=a.x-b.x,dy=a.y-b.y;return Math.sqrt(dx*dx+dy*dy);}
function asBase64(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error("read-failed"));reader.onload=()=>{const value=String(reader.result||"");const comma=value.indexOf(",");if(comma<0)return reject(new Error("read-failed"));resolve(value.slice(comma+1));};reader.readAsDataURL(file);});}
function thumbnailBase64(file){
  return createImageBitmap(file).then(bitmap=>{
    const canvas=document.createElement("canvas");canvas.width=240;canvas.height=240;
    const ctx=canvas.getContext("2d",{alpha:false});ctx.fillStyle="#fff";ctx.fillRect(0,0,240,240);
    const side=Math.min(bitmap.width,bitmap.height),sx=(bitmap.width-side)/2,sy=(bitmap.height-side)/2;
    ctx.drawImage(bitmap,sx,sy,side,side,0,0,240,240);bitmap.close();
    const data=canvas.toDataURL("image/jpeg",0.88).split(",")[1];
    if(!data||data.length>160000)throw new Error("thumbnail-too-large");
    return data;
  });
}
function getService(){return root.engagementService&&typeof root.engagementService.roomPosterCover==="function"?root.engagementService.roomPosterCover:null;}
function managementPosterUrl(value){return safePosterUrl(value);}
function adminTournamentFor(code){
  try{return (typeof adminTournamentListItems!=="undefined"?adminTournamentListItems:[]).find(item=>item&&String(item.code||"")===String(code||""))||null;}catch(_){return null;}
}
function addAdminPosterLayoutStyles(){
  if(document.getElementById("bxh-admin-poster-stats-style"))return;
  const style=document.createElement("style");style.id="bxh-admin-poster-stats-style";
  style.textContent=".tournament-poster-stats-layout{display:grid;grid-template-columns:minmax(88px,30%) minmax(0,1fr);gap:12px;align-items:start;margin-top:12px}.tournament-poster-stats-preview{margin:0;position:relative;min-width:0;max-width:220px;min-height:204px;display:flex;align-items:center;justify-content:center}.tournament-poster-stats-preview .lobby-poster-open{display:flex;align-items:center;justify-content:center;width:100%;height:100%;padding:0;border:0;background:transparent;cursor:zoom-in}.tournament-poster-stats-preview .lobby-poster-image{display:block;width:100%;height:auto;max-height:300px;object-fit:contain;object-position:top;border-radius:8px}.tournament-poster-stats-preview .lobby-poster-zoom{position:absolute;right:6px;bottom:6px;padding:5px 8px;border:1px solid rgba(255,255,255,.4);border-radius:7px;background:rgba(12,8,20,.82);color:#fff;font-size:12px}.tournament-poster-stats-layout>.grid.grid-3{display:grid!important;grid-template-columns:minmax(0,1fr)!important;grid-template-rows:repeat(3,minmax(64px,1fr))!important;gap:6px!important;margin-top:0!important}.tournament-poster-stats-layout>.grid.grid-3>.stat-box{min-width:0;min-height:64px!important;height:100%;box-sizing:border-box;padding:3px 8px!important;margin:0!important;display:flex!important;flex-direction:column;justify-content:center;gap:1px}.tournament-poster-stats-layout>.grid.grid-3>.stat-box .label{margin:0 0 1px!important;line-height:1.2!important}.tournament-poster-stats-layout>.grid.grid-3>.stat-box .value{line-height:1.1!important}.tournament-poster-stats-layout>.grid.grid-3 .stat-box{min-width:0}@media(max-width:600px){.tournament-poster-stats-layout{grid-template-columns:minmax(84px,32%) minmax(0,1fr);gap:9px}.tournament-poster-stats-preview .lobby-poster-image{max-height:260px}.tournament-poster-stats-layout>.grid.grid-3{gap:6px!important}}";
  document.head.appendChild(style);
}
function syncAdminPosterStatHeight(image,stats,preview){
  if(!image||!stats)return;
  const heightSource=preview||image;
  const sync=()=>{
    const height=Math.round(heightSource.getBoundingClientRect().height),target=Math.min(height,216);
    if(target>0&&stats.style.height!==target+"px"){stats.style.height=target+"px";stats.style.boxSizing="border-box";}
  };
  if(!image._bxhPosterStatsSync){
    image._bxhPosterStatsSync=sync;
    image.addEventListener("load",sync);
    if(typeof root.ResizeObserver==="function"){
      image._bxhPosterStatsObserver=new root.ResizeObserver(sync);
      image._bxhPosterStatsObserver.observe(heightSource);
    }
  }
  sync();
}
function applyAdminPosterStatsLayout(card,posterOverride){
  if(!card||!card.matches(".tournament-management-card"))return false;
  const stats=card.querySelector(".grid.grid-3");if(!stats)return false;
  const codeButton=card.querySelector('[data-action="cloud-admin-copy-code"][data-code]');
  const item=adminTournamentFor(codeButton&&codeButton.dataset.code);
  const poster=managementPosterUrl(posterOverride||item&&item.posterUrl);
  if(!poster)return false;
  addAdminPosterLayoutStyles();
  let layout=card.querySelector(":scope > .tournament-poster-stats-layout");
  let preview=layout&&layout.querySelector(".tournament-poster-stats-preview");
  if(!layout){layout=document.createElement("div");layout.className="tournament-poster-stats-layout";layout.setAttribute("data-poster-stats-layout","");}
  if(!preview){
    preview=document.createElement("figure");preview.className="tournament-poster-stats-preview";
    const open=document.createElement("button");open.type="button";open.className="lobby-poster-open";open.dataset.posterOpen="";open.setAttribute("aria-label","放大檢視活動海報");
    const image=document.createElement("img");image.className="lobby-poster-image";image.alt=(item&&item.name?item.name:"活動")+" 海報";image.loading="lazy";image.referrerPolicy="no-referrer";open.appendChild(image);
    const zoom=document.createElement("button");zoom.type="button";zoom.className="lobby-poster-zoom";zoom.dataset.posterOpen="";zoom.textContent="放大＋";zoom.setAttribute("aria-label","放大檢視活動海報");
    preview.append(open,zoom);
  }
  const image=preview.querySelector(".lobby-poster-image");
  if(image.src!==poster)image.src=poster;
  if(preview.parentElement!==layout||stats.parentElement!==layout||layout.firstElementChild!==preview||layout.lastElementChild!==stats)layout.replaceChildren(preview,stats);
  if(!layout.isConnected)card.insertBefore(layout,card.querySelector(".btn-row")||null);
  syncAdminPosterStatHeight(image,stats,preview);
  return true;
}
function isManagementMode(mode,role){return ["admin","event_staff","partner_organizer"].includes(mode)&&role==="admin";}
function currentInterfaceMode(){try{return {mode:typeof activeMode==="string"?activeMode:"",role:typeof currentRole==="string"?currentRole:""};}catch(_){return {mode:"",role:""};}}
function canManageInCurrentInterface(){const mode=currentInterfaceMode();return isManagementMode(mode.mode,mode.role);}
let manager=null,viewer=null;
function filterAdminRosterRows(rows,kind){
  const status=kind==="waitlist"?"waitlist":"confirmed";
  return (Array.isArray(rows)?rows:[])
    .filter(row=>row&&row.status===status)
    .map(row=>({name:String(row.publicName||row.displayName||row.participantName||row.realName||row.name||"未命名選手").trim()||"未命名選手"}));
}
function addInlineRosterStyles(){
  if(document.getElementById("bxh-admin-inline-roster-style"))return;
  const style=document.createElement("style");style.id="bxh-admin-inline-roster-style";
  style.textContent=".tournament-roster-toggle{cursor:pointer;touch-action:manipulation;transition:border-color .16s ease,background-color .16s ease,transform .12s ease}.tournament-roster-toggle .label{display:flex;align-items:center;justify-content:space-between;gap:6px}.tournament-roster-toggle .label:after{content:\"查看名單⌄\";flex:0 0 auto;padding:3px 6px;border:1px solid rgba(189,165,255,.38);border-radius:999px;background:rgba(137,91,219,.12);color:#cdb7ff;font-size:11px;font-weight:700;white-space:nowrap}.tournament-roster-toggle[aria-expanded=true] .label:after{content:\"收合名單⌃\";border-color:rgba(240,212,123,.42);background:rgba(240,212,123,.1);color:#f0d47b}.tournament-roster-toggle[data-roster-kind=confirmed]{border-color:rgba(93,213,222,.42)}.tournament-roster-toggle[data-roster-kind=waitlist]{border-color:rgba(255,190,95,.42)}.tournament-roster-toggle:active{transform:scale(.99);filter:brightness(1.12)}.tournament-roster-toggle:focus-visible{outline:2px solid #d9b95c;outline-offset:2px}.tournament-inline-roster{margin:7px 0 0;padding:8px 10px;border:1px solid rgba(170,112,255,.34);border-radius:10px;background:rgba(20,13,32,.9)}.tournament-inline-roster[hidden]{display:none!important}.tournament-inline-roster-title{margin:0 0 5px;font-size:14px;font-weight:800}.tournament-inline-roster-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;max-height:260px;overflow:auto;overscroll-behavior:contain}.tournament-inline-roster-list{margin:0;padding:0;list-style:none}.tournament-inline-roster-list li{display:grid;grid-template-columns:2.4em minmax(0,1fr);gap:2px;padding:2px 0;font-size:13px;line-height:1.35}.tournament-inline-roster-index{display:block;text-align:right;padding-right:4px;white-space:nowrap;font-variant-numeric:tabular-nums}.tournament-inline-roster-name{min-width:0;overflow-wrap:anywhere}.tournament-inline-roster-message{margin:0;color:#b8b2c4;font-size:13px}";
  document.head.appendChild(style);
}
function ensureInlineRosterPanel(card){
  if(!card||!card.matches(".tournament-management-card"))return null;
  let panel=card.querySelector(":scope > .tournament-inline-roster");
  if(!panel){
    panel=document.createElement("section");panel.className="tournament-inline-roster";panel.hidden=true;
    panel.setAttribute("aria-live","polite");
  }
  const anchor=card.querySelector(":scope > .tournament-poster-stats-layout")||card.querySelector(":scope > .grid.grid-3");
  if(anchor&&panel.previousElementSibling!==anchor)anchor.after(panel);
  return panel;
}
function setupInlineRosterToggles(card){
  if(!card||!card.matches(".tournament-management-card"))return;
  const stats=card.querySelector(".grid.grid-3");if(!stats)return;
  addInlineRosterStyles();ensureInlineRosterPanel(card);
  stats.querySelectorAll(":scope > .stat-box").forEach(box=>{
    const label=box.querySelector(".label");
    const title=String(label&&label.textContent||"").trim();
    const kind=title==="正取"?"confirmed":title==="備取"?"waitlist":"";
    if(!kind)return;
    box.classList.add("tournament-roster-toggle");box.dataset.rosterKind=kind;
    box.setAttribute("role","button");box.setAttribute("tabindex","0");
    box.setAttribute("aria-label","輕點查看"+title+"名單");
    box.setAttribute("aria-expanded","false");
  });
}
let activeInlineRoster=null,inlineRosterRequest=0;
function closeInlineRoster(){
  if(!activeInlineRoster)return;
  activeInlineRoster.button.setAttribute("aria-expanded","false");
  activeInlineRoster.button.setAttribute("aria-label","輕點查看"+(activeInlineRoster.kind==="waitlist"?"備取":"正取")+"名單");
  activeInlineRoster.panel.hidden=true;activeInlineRoster=null;
}
function setInlineRosterMessage(panel,message){
  const node=document.createElement("p");node.className="tournament-inline-roster-message";node.textContent=message;
  panel.replaceChildren(node);
}
function inlineRosterErrorMessage(error){
  const code=String(error&&error.code||error&&error.message||"").toLowerCase();
  if(code.includes("permission-denied"))return "你目前沒有查看這場賽事名單的權限。";
  if(code.includes("unauthenticated")||code.includes("auth-required"))return "登入狀態已失效，請重新登入後再試。";
  if(code.includes("unavailable")||code.includes("network")||code.includes("timeout"))return "網路連線失敗，請稍後重試。";
  if(code.includes("not-found"))return "找不到這場賽事資料，請重新整理後再試。";
  return "名單讀取失敗，請重新整理後再試。";
}
function renderInlineRoster(panel,kind,rows){
  const title=document.createElement("h4");title.className="tournament-inline-roster-title";
  title.textContent=(kind==="waitlist"?"備取":"正取")+"名單（"+rows.length+" 人）";
  const columns=document.createElement("div");columns.className="tournament-inline-roster-columns";
  const midpoint=Math.ceil(rows.length/2);
  [rows.slice(0,midpoint),rows.slice(midpoint)].forEach((column,columnIndex)=>{
    const list=document.createElement("ol");list.className="tournament-inline-roster-list";
    column.forEach((row,index)=>{const numberValue=(columnIndex?midpoint:0)+index+1;const item=document.createElement("li");const number=document.createElement("span");number.className="tournament-inline-roster-index";number.textContent=String(numberValue)+".";const name=document.createElement("span");name.className="tournament-inline-roster-name";name.textContent=row.name;item.append(number,name);list.appendChild(item);});
    columns.appendChild(list);
  });
  panel.replaceChildren(title,columns);
}
async function toggleInlineRoster(button){
  const card=button.closest(".tournament-management-card"),kind=button.dataset.rosterKind;
  const codeButton=card&&card.querySelector('[data-action="cloud-admin-copy-code"][data-code]');
  const code=codeButton&&codeButton.dataset.code;
  if(!card||!kind||!code||!canManageInCurrentInterface())return;
  const panel=ensureInlineRosterPanel(card);if(!panel)return;
  if(activeInlineRoster&&activeInlineRoster.button===button){inlineRosterRequest++;closeInlineRoster();return;}
  closeInlineRoster();
  const current={card,kind,button,panel,code};activeInlineRoster=current;
  button.setAttribute("aria-expanded","true");button.setAttribute("aria-label","收合"+(kind==="waitlist"?"備取":"正取")+"名單");panel.hidden=false;
  setInlineRosterMessage(panel,"名單載入中…");
  const request=++inlineRosterRequest;
  try{
    const cloud=root.cloudSync;
    if(!cloud||typeof cloud.listRegistrationNamesForStaff!=="function")throw new Error("cloud-unavailable");
    if(typeof cloud.connect==="function")await cloud.connect();
    const records=await cloud.listRegistrationNamesForStaff(code);
    if(activeInlineRoster!==current||request!==inlineRosterRequest)return;
    const rows=filterAdminRosterRows(records,kind);
    const expected=Number(records&&records.expectedCounts&&records.expectedCounts[kind]||0);
    if(!rows.length){
      setInlineRosterMessage(panel,expected>0
        ?"報名紀錄已有 "+expected+" 位"+(kind==="waitlist"?"備取":"正取")+"；姓名名單尚未同步，請由管理員進入報名管理查看。"
        :"目前沒有"+(kind==="waitlist"?"備取":"正取")+"人員。");
      return;
    }
    renderInlineRoster(panel,kind,rows);
    if(expected>rows.length){
      const note=document.createElement("p");note.className="tournament-inline-roster-message";
      note.textContent="已顯示 "+rows.length+" 位；報名紀錄共 "+expected+" 位，請由管理員進入報名管理核對其餘名單。";
      panel.appendChild(note);
    }
  }catch(error){
    if(activeInlineRoster===current&&request===inlineRosterRequest)setInlineRosterMessage(panel,inlineRosterErrorMessage(error));
  }
}
function scanCards(){
  document.querySelectorAll(".lobby-compact-card").forEach(card=>{
    if(card.dataset.posterAccessHook==="1")return;
    card.dataset.posterAccessHook="1";
    card.addEventListener("toggle",()=>{if(card.open)refreshPermission(card);});
    if(card.open)refreshPermission(card);
  });
  document.querySelectorAll(".tournament-management-card").forEach(card=>{
    applyAdminPosterStatsLayout(card);
    setupInlineRosterToggles(card);
    if(card.dataset.posterAccessHook==="1")return;
    const actions=card.querySelector(".btn-row");
    const codeButton=card.querySelector('[data-action="cloud-admin-copy-code"][data-code]');
    const code=codeButton&&codeButton.dataset.code;
    if(!actions||!code)return;
    card.dataset.posterAccessHook="1";
    const button=document.createElement("button");
    button.type="button";button.className="btn btn-ghost btn-sm";
    button.dataset.posterManage="";button.dataset.code=code;button.hidden=true;button.textContent="＋新增照片";
    const copy=card.querySelector('[data-action="cloud-admin-copy-code"]');
    actions.insertBefore(button,copy||null);
    refreshPermission(card);
  });
}
async function refreshPermission(card){
  const button=card.querySelector("[data-poster-manage]");
  if(!button)return;
  if(!canManageInCurrentInterface()){button.hidden=true;return;}
  const call=getService();
  if(!call||card.dataset.posterPermissionBusy==="1")return;
  card.dataset.posterPermissionBusy="1";
  try{
    const result=await call({action:"canManage",code:button.dataset.code});
    if(!button.isConnected)return;
    button.hidden=!canManageInCurrentInterface()||!result||result.allowed!==true;
    button.textContent=result&&result.hasPoster?"更換照片":"＋新增照片";
    button.dataset.posterHasPhoto=result&&result.hasPoster?"1":"0";
  }catch(_){button.hidden=true;}
  finally{delete card.dataset.posterPermissionBusy;}
}
function makeManager(){
  if(manager)return manager;
  manager=document.createElement("div");manager.className="lobby-poster-manager";manager.hidden=true;
  manager.innerHTML='<div class="lobby-poster-manager-backdrop" data-manager-close></div><section class="lobby-poster-manager-panel" role="dialog" aria-modal="true" aria-labelledby="lobby-poster-manager-title"><button class="lobby-poster-modal-close" type="button" data-manager-close aria-label="關閉">×</button><h2 id="lobby-poster-manager-title">活動照片</h2><p class="lobby-poster-manager-help">支援 JPG／PNG，原圖保持比例與畫質，檔案上限 6 MB。</p><label class="lobby-poster-file-label">選擇照片<input type="file" accept="image/jpeg,image/png" data-poster-file></label><div class="lobby-poster-preview" data-poster-preview hidden><img data-poster-preview-image alt="活動照片預覽"></div><div class="lobby-poster-error" role="alert" data-poster-error></div><div class="lobby-poster-manager-actions"><button type="button" class="btn btn-ghost" data-manager-close>取消</button><button type="button" class="btn btn-ghost" data-poster-save disabled>確認儲存</button></div></section>';
  document.body.appendChild(manager);
  manager.addEventListener("click",event=>{
    if(event.target.closest("[data-manager-close]"))closeManager();
    if(event.target.closest("[data-poster-save]"))saveSelectedPoster();
    const input=event.target.closest("[data-poster-file]");
    if(input)event.stopPropagation();
  });
  manager.querySelector("[data-poster-file]").addEventListener("change",selectPoster);
  return manager;
}
function closeManager(){
  if(!manager||manager._saving)return;
  if(manager._objectUrl)URL.revokeObjectURL(manager._objectUrl);
  manager.querySelector("[data-poster-preview-image]").removeAttribute("src");
  manager.hidden=true;manager._file=null;manager._dimensions=null;manager._code="";manager._card=null;manager._objectUrl="";
  document.body.classList.remove("lobby-poster-modal-open");
}
async function selectPoster(event){
  const modal=makeManager(),file=event.target.files&&event.target.files[0];
  const preview=modal.querySelector("[data-poster-preview]"),image=modal.querySelector("[data-poster-preview-image]");
  const error=modal.querySelector("[data-poster-error]"),save=modal.querySelector("[data-poster-save]");
  error.textContent="";save.disabled=true;modal._file=null;modal._dimensions=null;
  if(modal._objectUrl)URL.revokeObjectURL(modal._objectUrl);
  const validation=validatePosterFile(file);
  if(!validation.ok){error.textContent=validation.reason==="format"?"請選擇 JPG 或 PNG 圖片。":"圖片必須大於 0 且不超過 6 MB。";preview.hidden=true;return;}
  try{
    const bitmap=await createImageBitmap(file);
    if(bitmap.width>10000||bitmap.height>10000){bitmap.close();throw new Error("圖片尺寸過大，請選擇較小的原圖。");}
    modal._dimensions={width:bitmap.width,height:bitmap.height};bitmap.close();
    modal._file=file;modal._objectUrl=URL.createObjectURL(file);image.src=modal._objectUrl;preview.hidden=false;save.disabled=false;
  }catch(errorValue){error.textContent=errorValue.message||"無法讀取圖片，請重新選擇。";preview.hidden=true;}
}
function openManager(button){
  const modal=makeManager();if(modal._saving)return;
  modal._code=button.dataset.code;modal._card=button.closest(".lobby-compact-card, .tournament-management-card");
  modal.querySelector("[data-poster-file]").value="";
  modal.querySelector("[data-poster-preview]").hidden=true;
  modal.querySelector("[data-poster-error]").textContent="";
  modal.querySelector("[data-poster-save]").disabled=true;
  modal.querySelector("[data-poster-save]").textContent="確認儲存";
  modal.hidden=false;document.body.classList.add("lobby-poster-modal-open");
  modal.querySelector("[data-poster-file]").focus();
}
async function saveSelectedPoster(){
  const modal=makeManager(),file=modal._file,dimensions=modal._dimensions,call=getService();
  const code=modal._code,card=modal._card;
  const save=modal.querySelector("[data-poster-save]"),error=modal.querySelector("[data-poster-error]");
  if(!file||!dimensions||!call||modal._saving)return;
  modal._saving=true;save.disabled=true;save.textContent="儲存中…";error.textContent="";
  try{
    const values=await Promise.all([asBase64(file),thumbnailBase64(file)]);
    const result=await call({action:"savePoster",code,
      photo:{mimeType:file.type,width:dimensions.width,height:dimensions.height,base64:values[0]},
      cover:{mimeType:"image/jpeg",width:240,height:240,base64:values[1]}});
    if(!result||result.ok!==true||!safePosterUrl(result.posterUrl))throw new Error("伺服器未確認新照片，舊照片仍保留。請檢查網路後重試。");
    modal._saving=false;closeManager();
    if(card&&card.isConnected)applyPhoto(card,result.posterUrl,result.coverUrl,code);
  }catch(errorValue){
    error.textContent=errorValue&&errorValue.message&&errorValue.message!=="internal"?"上傳失敗，舊照片仍保留。"+errorValue.message:"上傳失敗，舊照片仍保留。請檢查網路後再按「確認儲存」重試。";
  }finally{modal._saving=false;if(manager&&!manager.hidden&&manager._code===code){save.disabled=!manager._file;save.textContent="確認儲存";}}
}
function applyPhoto(card,url,coverUrl,code){
  const safe=safePosterUrl(url);if(!safe)return;
  const slot=card.querySelector("[data-poster-slot]");
  if(slot){
    const name=card.querySelector(".lobby-room-name")?.textContent||"活動";
    const figure=document.createElement("figure");figure.className="lobby-poster-figure";
    const open=document.createElement("button");open.type="button";open.className="lobby-poster-open";open.dataset.posterOpen="";open.setAttribute("aria-label","放大檢視 "+name+" 海報");
    const image=document.createElement("img");image.className="lobby-poster-image";image.src=safe;image.alt=name+" 活動海報";image.loading="lazy";image.referrerPolicy="no-referrer";open.appendChild(image);
    const zoom=document.createElement("button");zoom.type="button";zoom.className="lobby-poster-zoom";zoom.dataset.posterOpen="";zoom.textContent="放大＋";zoom.setAttribute("aria-label","放大檢視海報");
    figure.append(open,zoom);slot.replaceChildren(figure);
  }
  const manage=card.querySelector("[data-poster-manage]");if(manage){manage.textContent="更換照片";manage.dataset.posterHasPhoto="1";}
  if(card.matches(".tournament-management-card")){applyAdminPosterStatsLayout(card,safe);setupInlineRosterToggles(card);}
  const summary=card.querySelector(".lobby-poster-cover");if(summary&&typeof coverUrl==="string")summary.src=coverUrl;
  card.dataset.posterUpdatedCode=code;
}
function openViewer(trigger){
  const figure=trigger.closest(".lobby-poster-figure, .tournament-poster-stats-preview"),image=figure&&figure.querySelector(".lobby-poster-image");
  const url=image&&safePosterUrl(image.src);if(!url)return;
  const overlay=document.createElement("div");overlay.className="lobby-poster-viewer";overlay.setAttribute("role","dialog");overlay.setAttribute("aria-modal","true");overlay.setAttribute("aria-label","海報全螢幕檢視");
  overlay.innerHTML='<div class="lobby-poster-viewer-toolbar"><button type="button" data-viewer-reset>重設</button><button type="button" data-viewer-close aria-label="關閉全螢幕檢視">×</button></div><div class="lobby-poster-viewer-stage"><img class="lobby-poster-viewer-image" draggable="false"></div><div class="lobby-poster-viewer-hint">雙指縮放／拖曳查看細節</div>';
  const viewerImage=overlay.querySelector("img");viewerImage.src=url;viewerImage.alt=image.alt;
  const savedY=window.scrollY,oldStyle={position:document.body.style.position,top:document.body.style.top,width:document.body.style.width,overflow:document.body.style.overflow};
  document.body.style.position="fixed";document.body.style.top="-"+savedY+"px";document.body.style.width="100%";document.body.style.overflow="hidden";
  document.body.appendChild(overlay);viewer=overlay;
  const pointers=new Map();let scale=1,x=0,y=0,startScale=1,startDistance=0,startX=0,startY=0,dragX=0,dragY=0;
  function paint(){viewerImage.style.transform="translate("+x+"px,"+y+"px) scale("+scale+")";}
  function reset(){scale=1;x=0;y=0;paint();}
  function close(){
    if(!viewer||viewer!==overlay)return;
    document.removeEventListener("keydown",keydown);
    overlay.remove();viewer=null;
    document.body.style.position=oldStyle.position;document.body.style.top=oldStyle.top;document.body.style.width=oldStyle.width;document.body.style.overflow=oldStyle.overflow;
    window.scrollTo(0,savedY);trigger.focus();
  }
  overlay.querySelector("[data-viewer-close]").addEventListener("click",close);
  overlay.querySelector("[data-viewer-reset]").addEventListener("click",reset);
  overlay.addEventListener("click",event=>{if(event.target===overlay||event.target.classList.contains("lobby-poster-viewer-stage"))close();});
  const keydown=event=>{if(event.key==="Escape")close();};
  document.addEventListener("keydown",keydown);
  viewerImage.addEventListener("pointerdown",event=>{
    event.preventDefault();viewerImage.setPointerCapture(event.pointerId);pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(pointers.size===2){const points=[...pointers.values()];startDistance=distance(points[0],points[1])||1;startScale=scale;}
    else{startX=event.clientX;startY=event.clientY;dragX=x;dragY=y;}
  });
  viewerImage.addEventListener("pointermove",event=>{
    if(!pointers.has(event.pointerId))return;
    pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
    if(pointers.size>=2){const points=[...pointers.values()];scale=Math.max(1,Math.min(6,startScale*distance(points[0],points[1])/startDistance));}
    else if(scale>1){x=dragX+event.clientX-startX;y=dragY+event.clientY-startY;}
    paint();
  });
  const release=event=>{pointers.delete(event.pointerId);if(pointers.size===1){const point=[...pointers.values()][0];startX=point.x;startY=point.y;dragX=x;dragY=y;startScale=scale;}};
  viewerImage.addEventListener("pointerup",release);viewerImage.addEventListener("pointercancel",release);
  viewerImage.addEventListener("wheel",event=>{event.preventDefault();scale=Math.max(1,Math.min(6,scale*(event.deltaY<0?1.15:0.87)));paint();},{passive:false});
}
function onClick(event){
  const rosterButton=event.target.closest&&event.target.closest("[data-roster-kind]");
  if(rosterButton){event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();toggleInlineRoster(rosterButton);return;}
  const manageButton=event.target.closest&&event.target.closest("[data-poster-manage]");
  if(manageButton&&!manageButton.hidden){
    if(!canManageInCurrentInterface()){manageButton.hidden=true;return;}
    event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();openManager(manageButton);return;
  }
  const openButton=event.target.closest&&event.target.closest("[data-poster-open]");
  if(openButton){event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();openViewer(openButton);}
}
function init(){
  if(!document.body)return;
  document.addEventListener("click",onClick,true);
  document.addEventListener("keydown",event=>{const button=event.target&&event.target.closest&&event.target.closest("[data-roster-kind]");if(button&&(event.key==="Enter"||event.key===" ")){event.preventDefault();event.stopPropagation();toggleInlineRoster(button);}},true);
  const observer=new MutationObserver(scanCards);observer.observe(document.body,{childList:true,subtree:true});
  scanCards();
}
const api={safePosterUrl,managementPosterUrl,validatePosterFile,isManagementMode,filterAdminRosterRows,inlineRosterErrorMessage,MAX_FILE_BYTES};
root.BXHEventPosterUI=api;
if(typeof module==="object"&&module.exports)module.exports=api;
if(root.document){if(root.document.readyState==="loading")root.document.addEventListener("DOMContentLoaded",init,{once:true});else init();}
})(typeof window!=="undefined"?window:globalThis);
