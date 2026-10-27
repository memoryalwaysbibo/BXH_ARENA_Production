(function(root){
'use strict';
function mount({container,api,ui=root.BXHTeamUI,controllers=root.BXHTeamController}){
 if(!container||!ui||!controllers)throw Error('team-components-required');
 let previewVersion=0,previewUrl=null,previewBlob=null,previewTeam=null;
 function clearPreview(){previewVersion++;previewBlob=null;previewTeam=null;if(previewUrl){root.URL?.revokeObjectURL(previewUrl);previewUrl=null;}}
 const controller=controllers.createTeamController({api,onChange:render});
 function render(state){
  if(state.screen!=='mine'||state.team?.id!==previewTeam||state.busy)clearPreview();
  container.innerHTML='<style>'+ui.css+'</style>'+ui.tabs(state.screen==='create'?'create':['mine','applications','history','manage'].includes(state.screen)?'mine':'lobby')+(state.screen==='manage'&&state.loading?'<p role="status">正在載入成員…</p>':state.screen==='manage'&&!state.loaded?'<section><h2>管理成員</h2><button type="button" data-team-action="reload-manage">重新載入</button><button type="button" data-team-action="tab" data-value="mine">返回我的戰隊</button></section>':state.screen==='manage'?ui.manageMembers(state.team):state.screen==='history'&&state.loading?'<p role="status">正在載入戰隊紀錄…</p>':state.screen==='history'&&!state.loaded?'<section><h2>戰隊紀錄</h2><button type="button" data-team-action="reload-history">重新載入</button><button type="button" data-team-action="tab" data-value="mine">返回我的戰隊</button></section>':state.screen==='history'?ui.history({items:state.items,nextCursor:state.historyNextCursor,page:state.historyPage}):state.screen==='applications'&&state.loading?'<p role="status">正在載入加入申請…</p>':state.screen==='applications'&&!state.loaded?'<section><h2>加入申請</h2><button type="button" data-team-action="reload-applications">重新載入</button><button type="button" data-team-action="tab" data-value="mine">返回我的戰隊</button></section>':state.screen==='applications'&&!state.loading&&state.loaded?ui.applications({items:state.items,hasMore:state.hasMore,teamId:state.applicationsTeamId}):state.screen==='create'&&!state.loading&&state.loaded?ui.createTeam(state.team):state.screen==='mine'&&!state.loading&&state.loaded?ui.myTeam(state.team):state.screen==='members'&&!state.loading&&state.loaded&&state.team?'<button type="button" data-team-action="back">返回戰隊大廳</button>'+ui.publicMembers(state.team):ui.lobby({...state,...state.query,error:state.loaded?null:state.error}));
  if(previewUrl&&previewBlob){const img=container.querySelector('[data-emblem-preview]'),button=container.querySelector('[data-team-action="emblem-upload"]');if(img){img.src=previewUrl;img.hidden=false;}if(button)button.disabled=false;}
  if(state.busy)for(const button of container.querySelectorAll('button'))button.disabled=true;
  if(state.pending){const retry=container.ownerDocument.createElement('button');retry.type='button';retry.dataset.teamAction='retry';retry.textContent='重試上一筆操作';retry.disabled=state.busy||state.loading;container.append(retry);}
  if(state.error){const p=container.ownerDocument.createElement('p');p.setAttribute('role','alert');p.textContent=state.error;container.append(p);}
 }
 const click=async event=>{
  const button=event.target.closest('[data-team-action]');if(!button||!container.contains(button)||button.disabled)return;
  const action=button.dataset.teamAction,id=button.dataset.teamId;
  if(action==='retry')await controller.retryPending();
  else if(action==='emblem-upload'){
   const team=controller.snapshot().team,version=previewVersion,blob=previewBlob;if(!blob||team?.role!=='captain'||!team.id)return;
   button.disabled=true;
   try{const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);const base64=root.btoa(binary);
    if(version!==previewVersion||controller.snapshot().team?.id!==team.id||controller.snapshot().team?.role!=='captain')return;
    const result=await controller.operate('emblem',team.id,{base64});const status=container.querySelector('[data-emblem-status]');if(result.ok&&status)status.textContent='圖案已儲存。';
   }catch(_){const status=container.querySelector('[data-emblem-status]');if(version===previewVersion&&status){status.textContent='圖片無法上傳，請重新選擇。';button.disabled=false;}}
  }
  else if(action==='tab'&&button.dataset.value==='mine')await controller.mine();
  else if(action==='tab'&&button.dataset.value==='create')await controller.create();
  else if(action==='tab'&&button.dataset.value==='lobby')await controller.search(controller.snapshot().query);
  else if(action==='view')await controller.view(id);
  else if(action==='manage')await controller.manage(id);
  else if(action==='reload-manage')await controller.manage(controller.snapshot().managementTeamId);
  else if(action==='history')await controller.history(id);
  else if(action==='reload-history')await controller.history(controller.snapshot().historyTeamId);
  else if(action==='history-next')await controller.historyNext();
  else if(action==='history-previous')await controller.historyPrevious();
  else if(action==='applications')await controller.applications(id);
  else if(action==='reload-applications')await controller.applications(controller.snapshot().applicationsTeamId);
  else if(action==='leave'||action==='dissolve'){const message=action==='leave'?'確定退出這支戰隊？':'確定解散戰隊？解散後無法繼續使用這支戰隊。';if(typeof root.confirm==='function'&&root.confirm(message))await controller.operate(action,id);}
  else if(action==='transfer'){if(typeof root.confirm==='function'&&root.confirm('確定將隊長轉交給 '+button.dataset.targetName+'？轉交後你將成為一般隊員。'))await controller.operate('transfer',id,{targetUid:button.dataset.targetUid});}
  else if(action==='approve'||action==='reject')await controller.operate(action,id,{targetUid:button.dataset.targetUid});
  else if(action==='clear')await controller.clear();
  else if(action==='back')await controller.search(controller.snapshot().query);
  else if(action==='join'||action==='apply'||action==='cancel')await controller.operate(action,id);
 };
 const submit=async event=>{
  const form=event.target.closest('[data-team-form]');if(!form||!container.contains(form))return;
  if(form.dataset.teamForm==='assign'){
   event.preventDefault();const role=String(new FormData(form).get('role')||'');
   if(!['member','elite','deputy'].includes(role))return;
   await controller.operate('assign',form.dataset.teamId,{targetUid:form.dataset.targetUid,role});return;
  }
  if(form.dataset.teamForm==='remove'){
   event.preventDefault();const data=new FormData(form),reasonCode=String(data.get('reasonCode')||''),reasonNote=String(data.get('reasonNote')||'').trim();
   const note=form.querySelector('[name="reasonNote"]');note.setCustomValidity(reasonCode==='other'&&!reasonNote?'請填寫移除原因。':'');
   if(!reasonCode||(reasonCode==='other'&&!reasonNote)){form.reportValidity();return;}
   await controller.operate('remove',form.dataset.teamId,{targetUid:form.dataset.targetUid,reasonCode,reasonNote:reasonCode==='other'?reasonNote:''});return;
  }
  if(form.dataset.teamForm==='create'){
   event.preventDefault();const data=new FormData(form),name=String(data.get('name')||'').trim();
   if(name.length<2||name.length>24){form.reportValidity();return;}
   if(!root.crypto?.randomUUID){const p=container.ownerDocument.createElement('p');p.setAttribute('role','alert');p.textContent='目前無法安全建立戰隊，請重新載入再試。';container.append(p);return;}
   await controller.operate('create',root.crypto.randomUUID(),{name});return;
  }
  if(form.dataset.teamForm==='admission'){
   event.preventDefault();const data=new FormData(form),team=controller.snapshot().team;
   if(team?.id)await controller.operate('admission',team.id,{policy:{mode:String(data.get('mode')||''),minLadderTier:String(data.get('minLadderTier')||'')||null,minTier:String(data.get('minTier')||'')||null}});return;
  }
  if(form.dataset.teamForm==='frame'){
   event.preventDefault();const raw=String(new FormData(form).get('frame')??''),team=controller.snapshot().team;
   if(!team?.id||!['','4','7','10'].includes(raw))return;
   await controller.operate('frame',team.id,{frame:raw===''?null:Number(raw)});return;
  }
  if(form.dataset.teamForm!=='search')return;
  event.preventDefault();const data=new FormData(form);await controller.search({query:String(data.get('query')||''),mode:String(data.get('mode')||'all'),recruitment:String(data.get('recruitment')||'all')});
 };
 const change=async event=>{const select=event.target;
  if(select.hasAttribute?.('data-team-emblem')){
   if(!container.contains(select)||controller.snapshot().team?.role!=='captain')return;
   clearPreview();previewTeam=controller.snapshot().team?.id;const version=previewVersion,file=select.files?.[0],img=container.querySelector('[data-emblem-preview]'),status=container.querySelector('[data-emblem-status]'),button=container.querySelector('[data-team-action="emblem-upload"]');
   if(button)button.disabled=true;
   if(!file||!img||!status)return;img.hidden=true;status.textContent='正在處理圖案…';
   try{if(!root.BXHTeamEmblem||!root.URL?.createObjectURL)throw Error('unavailable');const blob=await root.BXHTeamEmblem.prepare(file);if(version!==previewVersion)return;const currentImg=container.querySelector('[data-emblem-preview]'),currentStatus=container.querySelector('[data-emblem-status]'),currentButton=container.querySelector('[data-team-action="emblem-upload"]');if(!currentImg||!currentStatus)return;previewBlob=blob;previewUrl=root.URL.createObjectURL(blob);currentImg.src=previewUrl;currentImg.hidden=false;if(currentButton)currentButton.disabled=false;currentStatus.textContent='圖片尚未儲存，確認後請按上傳。';}
   catch(error){if(version===previewVersion&&container.contains(select))status.textContent=error?.message==='invalid-image-type'?'請選擇 JPG、PNG 或 WebP 圖片。':error?.message==='invalid-image-size'?'請選擇 10 MB 以下的圖片。':'圖片無法預覽，請換一張圖片再試。';}
   return;
  }
  if(select.name!=='reasonCode')return;const form=select.closest('[data-team-form="remove"]');if(!form||!container.contains(form))return;const label=form.querySelector('[data-other-reason]'),note=form.querySelector('[name="reasonNote"]');label.hidden=select.value!=='other';note.required=select.value==='other';note.setCustomValidity('');};
 const input=event=>{if(event.target.name==='reasonNote')event.target.setCustomValidity('');};
 container.addEventListener('click',click);container.addEventListener('submit',submit);container.addEventListener('change',change);container.addEventListener('input',input);void controller.search();
 return {controller,destroy(){clearPreview();controller.dispose();container.removeEventListener('click',click);container.removeEventListener('submit',submit);container.removeEventListener('change',change);container.removeEventListener('input',input);container.replaceChildren();}};
}
if(typeof module==='object'&&module.exports)module.exports={mount};else root.BXHTeamMount={mount};
})(typeof window==='object'?window:globalThis);
