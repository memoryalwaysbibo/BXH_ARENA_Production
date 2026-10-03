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
let manager=null,viewer=null;
function scanCards(){
  document.querySelectorAll(".lobby-compact-card").forEach(card=>{
    if(card.dataset.posterAccessHook==="1")return;
    card.dataset.posterAccessHook="1";
    card.addEventListener("toggle",()=>{if(card.open)refreshPermission(card);});
    if(card.open)refreshPermission(card);
  });
}
async function refreshPermission(card){
  const button=card.querySelector("[data-poster-manage]"),call=getService();
  if(!button||!call||card.dataset.posterPermissionBusy==="1")return;
  card.dataset.posterPermissionBusy="1";
  try{
    const result=await call({action:"canManage",code:button.dataset.code});
    if(!button.isConnected)return;
    button.hidden=!result||result.allowed!==true;
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
  if(!manager)return;
  if(manager._objectUrl)URL.revokeObjectURL(manager._objectUrl);
  manager.hidden=true;manager._file=null;manager._dimensions=null;manager._code="";manager._card=null;
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
  const modal=makeManager();
  modal._code=button.dataset.code;modal._card=button.closest(".lobby-compact-card");
  modal.querySelector("[data-poster-file]").value="";
  modal.querySelector("[data-poster-preview]").hidden=true;
  modal.querySelector("[data-poster-error]").textContent="";
  modal.querySelector("[data-poster-save]").disabled=true;
  modal.hidden=false;document.body.classList.add("lobby-poster-modal-open");
  modal.querySelector("[data-poster-file]").focus();
}
async function saveSelectedPoster(){
  const modal=makeManager(),file=modal._file,dimensions=modal._dimensions,call=getService();
  const save=modal.querySelector("[data-poster-save]"),error=modal.querySelector("[data-poster-error]");
  if(!file||!dimensions||!call)return;
  save.disabled=true;save.textContent="儲存中…";error.textContent="";
  try{
    const values=await Promise.all([asBase64(file),thumbnailBase64(file)]);
    const result=await call({action:"savePoster",code:modal._code,
      photo:{mimeType:file.type,width:dimensions.width,height:dimensions.height,base64:values[0]},
      cover:{mimeType:"image/jpeg",width:240,height:240,base64:values[1]}});
    if(!result||result.ok!==true||!safePosterUrl(result.posterUrl))throw new Error("伺服器未確認新照片，舊照片仍保留。請檢查網路後重試。");
    const card=modal._card,code=modal._code;
    closeManager();
    if(card)applyPhoto(card,result.posterUrl,result.coverUrl,code);
  }catch(errorValue){
    error.textContent=errorValue&&errorValue.message&&errorValue.message!=="internal"?"上傳失敗，舊照片仍保留。"+errorValue.message:"上傳失敗，舊照片仍保留。請檢查網路後再按「確認儲存」重試。";
  }finally{if(manager&&!manager.hidden){save.disabled=!manager._file;save.textContent="確認儲存";}}
}
function applyPhoto(card,url,coverUrl,code){
  const safe=safePosterUrl(url);if(!safe)return;
  const slot=card.querySelector("[data-poster-slot]");if(!slot)return;
  const name=card.querySelector(".lobby-room-name")?.textContent||"活動";
  const figure=document.createElement("figure");figure.className="lobby-poster-figure";
  const open=document.createElement("button");open.type="button";open.className="lobby-poster-open";open.dataset.posterOpen="";open.setAttribute("aria-label","放大檢視 "+name+" 海報");
  const image=document.createElement("img");image.className="lobby-poster-image";image.src=safe;image.alt=name+" 活動海報";image.loading="lazy";image.referrerPolicy="no-referrer";open.appendChild(image);
  const zoom=document.createElement("button");zoom.type="button";zoom.className="lobby-poster-zoom";zoom.dataset.posterOpen="";zoom.textContent="放大＋";zoom.setAttribute("aria-label","放大檢視海報");
  figure.append(open,zoom);slot.replaceChildren(figure);
  const manage=card.querySelector("[data-poster-manage]");if(manage){manage.textContent="更換照片";manage.dataset.posterHasPhoto="1";}
  const summary=card.querySelector(".lobby-poster-cover");if(summary&&typeof coverUrl==="string")summary.src=coverUrl;
  card.dataset.posterUpdatedCode=code;
}
function openViewer(trigger){
  const figure=trigger.closest(".lobby-poster-figure"),image=figure&&figure.querySelector(".lobby-poster-image");
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
    if(!viewer)return;
    viewer.remove();viewer=null;
    document.body.style.position=oldStyle.position;document.body.style.top=oldStyle.top;document.body.style.width=oldStyle.width;document.body.style.overflow=oldStyle.overflow;
    window.scrollTo(0,savedY);trigger.focus();
  }
  overlay.querySelector("[data-viewer-close]").addEventListener("click",close);
  overlay.querySelector("[data-viewer-reset]").addEventListener("click",reset);
  overlay.addEventListener("click",event=>{if(event.target===overlay||event.target.classList.contains("lobby-poster-viewer-stage"))close();});
  const keydown=event=>{if(event.key==="Escape"){document.removeEventListener("keydown",keydown);close();}};
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
  const manageButton=event.target.closest&&event.target.closest("[data-poster-manage]");
  if(manageButton&&!manageButton.hidden){event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();openManager(manageButton);return;}
  const openButton=event.target.closest&&event.target.closest("[data-poster-open]");
  if(openButton){event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();openViewer(openButton);}
}
function init(){
  if(!document.body)return;
  document.addEventListener("click",onClick,true);
  const observer=new MutationObserver(scanCards);observer.observe(document.body,{childList:true,subtree:true});
  scanCards();
}
const api={safePosterUrl,validatePosterFile,MAX_FILE_BYTES};
root.BXHEventPosterUI=api;
if(typeof module==="object"&&module.exports)module.exports=api;
if(root.document){if(root.document.readyState==="loading")root.document.addEventListener("DOMContentLoaded",init,{once:true});else init();}
})(typeof window!=="undefined"?window:globalThis);
