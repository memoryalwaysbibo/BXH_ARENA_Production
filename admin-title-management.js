/**
 * BXH ARENA Admin Title Manager v1
 * Uses BXHTitleManagement exclusively; no alternate write path.
 */
(function(){
'use strict';
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function svc(){if(!window.BXHTitleManagement)throw new Error('稱號管理服務尚未載入');return window.BXHTitleManagement;}
function shell(){
  let el=document.getElementById('bxh-title-admin');
  if(el)return el;
  el=document.createElement('section'); el.id='bxh-title-admin'; el.hidden=true;
  el.innerHTML=`
  <div class="bxh-title-admin-card">
   <div class="bxh-title-admin-head"><div><b>稱號管理</b><small>統一管理中心</small></div><button type="button" data-ta-close>關閉</button></div>
   <div class="bxh-title-admin-grid">
    <div class="bxh-title-admin-list"><button type="button" data-ta-new>＋ 新增稱號</button><div data-ta-list></div></div>
    <form data-ta-form>
     <input name="id" placeholder="稱號 ID（英文/數字）" required>
     <input name="name" placeholder="稱號名稱" required>
     <textarea name="description" placeholder="稱號說明"></textarea>
     <textarea name="unlockText" placeholder="獲得條件"></textarea>
     <div class="bxh-title-admin-row"><select name="rarity"><option value="common">一般</option><option value="rare">稀有</option><option value="epic">史詩</option><option value="limited">限定</option><option value="eternal">永恆</option><option value="legendary">傳說</option></select><select name="grantMode"><option value="manual">手動派發</option><option value="automatic">系統自動</option></select></div>
     <div class="bxh-title-admin-row"><input name="category" placeholder="分類" value="general"><input name="sortOrder" type="number" placeholder="排序" value="0"></div>
     <label><input name="unique" type="checkbox"> 唯一稱號</label><label><input name="enabled" type="checkbox" checked> 啟用</label>
     <div class="bxh-title-image"><img data-ta-preview alt="" hidden><input name="image" type="file" accept="image/*"><small data-ta-path></small></div>
     <input name="imagePath" type="hidden"><input name="imageUrl" type="hidden">
     <div class="bxh-title-admin-actions"><button type="submit">儲存／發布</button><button type="button" data-ta-disable>停用</button></div>
     <div data-ta-status></div>
    </form>
   </div>
  </div>`;
  document.body.appendChild(el); bind(el); return el;
}
function status(el,msg,ok){const x=el.querySelector('[data-ta-status]');x.textContent=msg||'';x.dataset.ok=ok?'1':'0';}
async function refresh(el){
 const list=await svc().list(); const box=el.querySelector('[data-ta-list]');
 box.innerHTML=list.map(x=>`<button type="button" class="bxh-title-row" data-ta-id="${esc(x.id)}"><span>${esc(x.name)}</span><small>${esc(x.rarity||'common')} · ${x.enabled===false?'停用':'啟用'}</small></button>`).join('')||'<small>尚無後台管理稱號；既有稱號仍由相容層顯示。</small>';
}
function fill(el,x){
 const f=el.querySelector('[data-ta-form]'); ['id','name','description','unlockText','rarity','grantMode','category','sortOrder','imagePath','imageUrl'].forEach(k=>{if(f.elements[k])f.elements[k].value=x&&x[k]!=null?x[k]:'';});
 f.elements.unique.checked=!!(x&&x.unique); f.elements.enabled.checked=!x||x.enabled!==false;
 const img=el.querySelector('[data-ta-preview]'); img.src=x&&x.imageUrl||''; img.hidden=!img.src;
 el.querySelector('[data-ta-path]').textContent=x&&x.imagePath||'';
}
function bind(el){
 el.querySelector('[data-ta-close]').onclick=()=>el.hidden=true;
 el.querySelector('[data-ta-new]').onclick=()=>fill(el,null);
 el.querySelector('[data-ta-list]').onclick=async e=>{const b=e.target.closest('[data-ta-id]');if(!b)return;fill(el,await svc().get(b.dataset.taId));};
 el.querySelector('[name=image]').onchange=async e=>{try{const f=el.querySelector('[data-ta-form]');status(el,'圖片上傳中…');const r=await svc().uploadImage(f.elements.id.value,e.target.files[0]);f.elements.imagePath.value=r.imagePath;f.elements.imageUrl.value=r.imageUrl;const img=el.querySelector('[data-ta-preview]');img.src=r.imageUrl;img.hidden=false;el.querySelector('[data-ta-path]').textContent=r.imagePath;status(el,'圖片已上傳',true);}catch(err){status(el,err.message);}};
 el.querySelector('[data-ta-form]').onsubmit=async e=>{e.preventDefault();try{status(el,'儲存中…');const f=e.currentTarget;const data=Object.fromEntries(new FormData(f).entries());delete data.image;data.unique=f.elements.unique.checked;data.enabled=f.elements.enabled.checked;await svc().save(data);await refresh(el);status(el,'已儲存並發布',true);}catch(err){status(el,err.message);}};
 el.querySelector('[data-ta-disable]').onclick=async()=>{try{const f=el.querySelector('[data-ta-form]');await svc().setEnabled(f.elements.id.value,false);f.elements.enabled.checked=false;await refresh(el);status(el,'已停用',true);}catch(err){status(el,err.message);}};
}
async function open(){const el=shell();el.hidden=false;try{await refresh(el);}catch(e){status(el,e.message);}}
window.BXHAdminTitles={open,refresh:()=>refresh(shell())};
document.addEventListener('click',e=>{const b=e.target.closest('[data-open-title-admin]');if(b){e.preventDefault();open();}});
})();
