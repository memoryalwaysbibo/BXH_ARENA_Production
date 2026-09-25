/* Inventory catalog management: published items, crafting drafts and gifts. */
'use strict';
let catalogAdminState=null;
function catalogState(){
 const key=currentAuthUid()+':'+engagementSessionEpoch;
 if(!catalogAdminState||catalogAdminState.key!==key){
  let pending=null;
  try{pending=JSON.parse(sessionStorage.getItem('bxh.catalog.gift:'+currentAuthUid())||'null');}catch{}
  catalogAdminState={key,zone:'items',items:null,loading:false,busy:false,error:'',success:'',draftId:'',draft:{name:'',purpose:'',description:'',imageUrl:'',type:'general',stage:'making',consumable:false},query:'',results:[],recipient:null,gift:{catalogId:'',quantity:'1',source:'',expiry:''},pending};
 }
 return catalogAdminState;
}
const catalogStages={making:'製作中',partial:'半成品',ready:'成品待發布',exception:'異常分析'};
function catalogErr(e){const m=String(e?.message||e);const map={'catalog-not-ready':'請先補齊名稱、用途，並將階段設為成品待發布。','catalog-not-available':'道具未上架或已停用，無法贈送。','catalog-already-published':'已上架道具不能改寫，請停用後另建立新版。','catalog-not-found':'找不到道具，請重新整理。','daily-grant-limit':'今日發放已達 999 筆，請明日再試。','operation-conflict':'發放紀錄不一致，請保留操作編號查核。','auth-required':'請重新登入。','super-admin-required':'只有最高管理員可以管理道具。'};for(const [k,v]of Object.entries(map))if(m.includes(k))return v;return '操作尚未完成，請稍後重試。';}
async function catalogLoad(){
 const c=catalogState();if(c.loading||c.busy||!isSuperAdmin())return;
 c.loading=true;c.error='';render();
 try{const r=await window.engagementService.catalog({action:'catalog-list'});if(c!==catalogState())return;if(!r?.ok)throw Error('load-failed');c.items=r.items||[];}
 catch(e){if(c===catalogState())c.error=catalogErr(e);}
 finally{if(c===catalogState()){c.loading=false;render();}}
}
function catalogCard(i){
 const status=i.status==='published'?'使用中':i.status==='disabled'?'停用':catalogStages[i.stage]||'製作中';
 return `<article class="panel catalog-item"><div class="catalog-item-head"><b>${esc(i.code||'草稿')}　${esc(i.name||'未命名道具')}</b><span>${esc(i.type==='limited'?'限定':'一般')} · ${esc(status)}</span></div><details><summary>說明展開</summary><p>${esc(i.description||i.purpose||'尚無說明')}</p><p class="hint">用途：${esc(i.purpose||'未填寫')} · ${i.consumable===true?'可消耗':'不可消耗'}</p></details>${i.status==='published'?`<button type="button" class="btn btn-ghost btn-sm" data-action="catalog-disable" data-id="${esc(i.id)}">停用新發放</button>`:i.status==='disabled'?`<button type="button" class="btn btn-ghost btn-sm" data-action="catalog-enable" data-id="${esc(i.id)}">恢復發放</button>`:''}</article>`;
}
function renderInventoryCatalogAdmin(){
 if(!isSuperAdmin())return '<section class="panel">目前沒有道具管理權限。</section>';
 const c=catalogState();if(c.items===null&&!c.loading&&!c.error)setTimeout(catalogLoad,0);
 const formal=(c.items||[]).filter(i=>i.status==='published'||i.status==='disabled'),drafts=(c.items||[]).filter(i=>i.status==='draft'),available=formal.filter(i=>i.status==='published');
 const d=c.draft,g=c.gift,lock=c.busy||!!c.pending;
 return `<section class="panel"><div class="panel-title"><span>道具管理</span><button type="button" class="btn btn-ghost btn-sm" data-action="catalog-refresh" ${c.loading||c.busy?'disabled':''}>重新整理</button></div>
 <nav class="catalog-tabs" aria-label="道具管理分區">${[['items','道具區'],['craft','製作區'],['gifts','贈品區']].map(([id,label])=>`<button type="button" class="btn ${c.zone===id?'btn-primary':'btn-ghost'}" data-action="catalog-zone" data-zone="${id}">${label}</button>`).join('')}</nav>
 ${c.error?`<p class="auth-error" role="alert">${esc(c.error)}</p>`:''}${c.success?`<p class="hint" role="status">${esc(c.success)}</p>`:''}
 ${c.zone==='items'?`<div class="catalog-list">${formal.length?formal.map(catalogCard).join(''):'<div class="empty-state">目前沒有道具。完成製作並發布後會顯示在這裡。</div>'}</div>`:''}
 ${c.zone==='craft'?`<div class="catalog-list">${drafts.length?drafts.map(i=>`<article class="panel catalog-item"><b>${esc(i.name||'未命名道具')}</b> · ${esc(catalogStages[i.stage]||'製作中')}<p class="hint">${esc(i.description||i.purpose||'尚未填寫說明')}</p><button type="button" class="btn btn-ghost btn-sm" data-action="catalog-edit" data-id="${esc(i.id)}">繼續製作</button>${i.stage==='ready'?`<button type="button" class="btn btn-primary btn-sm" data-action="catalog-publish" data-id="${esc(i.id)}">發布到道具區</button>`:''}</article>`).join(''):'<div class="empty-state">目前沒有製作中的道具。</div>'}</div>
 <section class="panel"><div class="panel-title">${c.draftId?'編輯道具草稿':'新增道具草稿'}</div><p class="hint">草稿不會出現在道具區，也不能贈送給玩家。</p>
 <div class="grid grid-2">
 <div class="field"><label>名稱</label><input data-catalog-field="name" value="${esc(d.name)}" maxlength="60"></div>
 <div class="field"><label>用途</label><input data-catalog-field="purpose" value="${esc(d.purpose)}" maxlength="300"></div>
 <div class="field"><label>類型</label><select data-catalog-field="type"><option value="general" ${d.type==='general'?'selected':''}>一般</option><option value="limited" ${d.type==='limited'?'selected':''}>限定</option></select></div>
 <div class="field"><label>製作階段</label><select data-catalog-field="stage">${Object.entries(catalogStages).map(([v,l])=>`<option value="${v}" ${d.stage===v?'selected':''}>${l}</option>`).join('')}</select></div>
 <div class="field"><label>圖片網址（選填）</label><input data-catalog-field="imageUrl" value="${esc(d.imageUrl)}" placeholder="https://..."><input type="file" accept="image/jpeg,image/png,image/webp" data-catalog-image aria-label="上傳道具圖片"></div>
 <div class="field"><label>說明</label><textarea data-catalog-field="description" maxlength="1000">${esc(d.description)}</textarea></div></div>
 <label><input type="checkbox" data-catalog-field="consumable" ${d.consumable?'checked':''}> 可消耗道具</label>
 <div class="row" style="margin-top:10px"><button type="button" class="btn btn-primary" data-action="catalog-save" ${c.busy?'disabled':''}>儲存草稿</button><button type="button" class="btn btn-ghost" data-action="catalog-new">新增另一項</button></div></section>
 ${typeof window.renderRewardRulesAdmin==='function'?window.renderRewardRulesAdmin():''}`:''}
 ${c.zone==='gifts'?`<section class="panel"><div class="panel-title">贈送道具</div><p class="hint">只能選擇道具區「使用中」的成品；草稿及停用品不能贈送。</p>
 ${c.pending?`<p class="auth-error">上一筆發放仍待確認，操作編號：${esc(c.pending.payload.operationId)}。請按下方按鈕確認原結果。</p>`:''}
 <div class="field"><label>對象</label><input data-catalog-query value="${esc(c.query)}" placeholder="姓名、玩家編號或 Email" ${lock?'disabled':''}><button type="button" class="btn btn-ghost btn-sm" data-action="catalog-search" ${lock?'disabled':''}>搜尋玩家</button></div>
 ${c.results.map(u=>`<button type="button" class="btn btn-ghost inventory-recipient" data-action="catalog-recipient" data-uid="${esc(u.uid)}">${esc(titleRecipientLabel(u))}</button>`).join('')}
 <p role="status">${c.recipient?'已選擇：'+esc(titleRecipientLabel(c.recipient)):'尚未選擇玩家'}</p>
 <div class="field"><label>道具</label><select data-catalog-gift="catalogId" ${lock?'disabled':''}><option value="">選擇已發布道具</option>${available.map(i=>`<option value="${esc(i.id)}" ${g.catalogId===i.id?'selected':''}>${esc(i.code)} ${esc(i.name)}</option>`).join('')}</select></div>
 <div class="grid grid-2"><div class="field"><label>數量</label><input type="number" min="1" max="10000" data-catalog-gift="quantity" value="${esc(g.quantity)}" ${lock?'disabled':''}></div><div class="field"><label>發放原因</label><input data-catalog-gift="source" value="${esc(g.source)}" maxlength="120" ${lock?'disabled':''}></div><div class="field"><label>到期時間（留空為無期限）</label><input type="datetime-local" data-catalog-gift="expiry" value="${esc(g.expiry)}" ${lock?'disabled':''}></div></div>
 <button type="button" class="btn btn-primary" data-action="catalog-grant" ${c.busy?'disabled':''}>${c.pending?'確認原發放結果':'確認贈送'}</button></section>`:''}
 </section>`;
}
async function catalogAction(action,target){
 const c=catalogState();if(!isSuperAdmin())return;
 if(action==='catalog-zone'){c.zone=target.dataset.zone;c.error='';c.success='';render();return;}
 if(action==='catalog-refresh'){await catalogLoad();return;}
 if(c.busy)return;
 if(action==='catalog-new'){c.draftId='';c.draft={name:'',purpose:'',description:'',imageUrl:'',type:'general',stage:'making',consumable:false};render();return;}
 if(action==='catalog-edit'){const item=(c.items||[]).find(i=>i.id===target.dataset.id&&i.status==='draft');if(item){c.draftId=item.id;c.draft={name:item.name,purpose:item.purpose,description:item.description,imageUrl:item.imageUrl,type:item.type,stage:item.stage,consumable:item.consumable===true};render();}return;}
 if(action==='catalog-recipient'){c.recipient=c.results.find(u=>u.uid===target.dataset.uid)||null;c.results=[];render();return;}
 if(action==='catalog-search'){
  if(!c.query.trim()){c.error='請先輸入玩家姓名或編號。';render();return;}
  c.busy=true;c.error='';render();
  try{const users=await window.cloudAuth.listUsers();if(c!==catalogState())return;c.results=titleRecipientMatches(users,c.query).filter(u=>u.active===true&&!['frozen','disabled'].includes(u.accountStatus));if(!c.results.length)c.error='找不到可贈送的玩家。';}
  catch(e){c.error='搜尋失敗，請稍後重試。';}finally{c.busy=false;render();}return;
 }
 if(action==='catalog-grant'){await catalogGift(c);return;}
 if(!['catalog-save','catalog-publish','catalog-disable','catalog-enable'].includes(action))return;
 if(action==='catalog-publish'&&!confirm('確定發布這項道具？發布後會進入道具區，並可在贈品區選取。'))return;
 if(action==='catalog-disable'&&!confirm('停用後將無法再贈送這項道具；既有玩家持有紀錄不受影響。'))return;
 c.busy=true;c.error='';c.success='';render();
 try{
  const payload=action==='catalog-save'?{action:'catalog-save',...(c.draftId?{id:c.draftId}:{}),...c.draft}:action==='catalog-publish'?{action:'catalog-publish',id:target.dataset.id}:{action:'catalog-status',id:target.dataset.id,status:action==='catalog-enable'?'published':'disabled'};
  const r=await window.engagementService.catalog(payload);if(c!==catalogState())return;if(!r?.ok)throw Error('catalog-failed');
  if(action==='catalog-save')c.draftId=r.id;
  c.success=action==='catalog-save'?'草稿已保存。':action==='catalog-publish'?'已發布：'+r.code:'道具狀態已更新。';
  c.busy=false;await catalogLoad();
 }catch(e){if(c===catalogState())c.error=catalogErr(e);}finally{if(c===catalogState()){c.busy=false;render();}}
}
async function catalogGift(c){
 c.error='';c.success='';render();
 try{
  if(!c.pending){
   const i=(c.items||[]).find(x=>x.id===c.gift.catalogId&&x.status==='published');
   if(!i)throw Error('catalog-not-available');
   if(!c.recipient)throw Error('invalid-recipient');
   const quantity=Number(c.gift.quantity),expiresAt=inventoryExpiry(c.gift.expiry),source=c.gift.source.trim();
   if(!Number.isSafeInteger(quantity)||quantity<1||quantity>10000)throw Error('invalid-quantity');
   if(!source||[...source].length>120)throw Error('invalid-source');
   if(expiresAt!==null&&expiresAt<=Date.now())throw Error('invalid-expiry');
   if(!confirm(`確認贈送給 ${titleRecipientLabel(c.recipient)}？\n${i.code} ${i.name} × ${quantity}\n原因：${source}\n期限：${expiresAt===null?'無期限':mailboxDate(expiresAt)}`))return;
   c.pending={actorUid:currentAuthUid(),payload:{action:'catalog-grant',catalogId:i.id,targetUid:c.recipient.uid,quantity,source,expiresAt,operationId:crypto.randomUUID()}};
   sessionStorage.setItem('bxh.catalog.gift:'+currentAuthUid(),JSON.stringify(c.pending));
  }
  c.busy=true;render();
  const r=await window.engagementService.inventory(c.pending.payload);if(c!==catalogState())return;if(!r?.ok)throw Error('grant-failed');
  c.success='已贈送成功，批次編號：'+String(r.itemCode||'')+'。';
  sessionStorage.removeItem('bxh.catalog.gift:'+currentAuthUid());c.pending=null;c.recipient=null;c.gift={catalogId:'',quantity:'1',source:'',expiry:''};
 }catch(e){if(c===catalogState())c.error=catalogErr(e);}finally{if(c===catalogState()){c.busy=false;render();}}
}
document.addEventListener('click',e=>{const t=e.target.closest?.('[data-action^="catalog-"]');if(!t)return;e.preventDefault();e.stopPropagation();catalogAction(t.dataset.action,t);},true);
document.addEventListener('input',e=>{const c=catalogState(),t=e.target;if(t.hasAttribute?.('data-catalog-query'))c.query=t.value;const f=t.getAttribute?.('data-catalog-field');if(f&&f!=='consumable'&&Object.hasOwn(c.draft,f))c.draft[f]=t.value;const g=t.getAttribute?.('data-catalog-gift');if(g&&Object.hasOwn(c.gift,g))c.gift[g]=t.value;});
document.addEventListener('change',async e=>{const c=catalogState(),t=e.target;if(t.getAttribute?.('data-catalog-field')==='consumable')c.draft.consumable=t.checked===true;const g=t.getAttribute?.('data-catalog-gift');if(g&&Object.hasOwn(c.gift,g))c.gift[g]=t.value;if(t.matches?.('[data-catalog-image]')&&t.files?.[0]){const file=t.files[0];c.busy=true;c.error='';render();try{const blob=await inventoryCompressImage(file);const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('image-read-failed'));reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');reader.readAsDataURL(blob);});const r=await callEngagementFunction('inventoryImageUpload',{contentType:'image/webp',base64},60000);if(!r?.ok)throw Error('upload-failed');c.draft.imageUrl=r.imageUrl;c.success='道具圖片已上傳。';}catch(err){c.error=catalogErr(err);}finally{c.busy=false;render();}}});
window.renderInventoryCatalogAdmin=renderInventoryCatalogAdmin;
