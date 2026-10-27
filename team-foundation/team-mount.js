(function(root){
'use strict';
function mount({container,api,ui=root.BXHTeamUI,controllers=root.BXHTeamController}){
 if(!container||!ui||!controllers)throw Error('team-components-required');
 const controller=controllers.createTeamController({api,onChange:render});
 function render(state){
  container.innerHTML='<style>'+ui.css+'</style>'+ui.tabs(state.screen==='create'?'create':state.screen==='mine'?'mine':'lobby')+(state.screen==='create'&&!state.loading&&state.loaded?ui.createTeam(state.team):state.screen==='mine'&&!state.loading&&state.loaded?ui.myTeam(state.team):state.screen==='members'&&!state.loading&&state.loaded&&state.team?'<button type="button" data-team-action="back">返回戰隊大廳</button>'+ui.publicMembers(state.team):ui.lobby({...state,...state.query}));
  if(state.busy)for(const button of container.querySelectorAll('button'))button.disabled=true;
  if(state.pending){const retry=container.ownerDocument.createElement('button');retry.type='button';retry.dataset.teamAction='retry';retry.textContent='重試上一筆操作';retry.disabled=state.busy||state.loading;container.append(retry);}
  if(state.error){const p=container.ownerDocument.createElement('p');p.setAttribute('role','alert');p.textContent=state.error;container.append(p);}
 }
 const click=async event=>{
  const button=event.target.closest('[data-team-action]');if(!button||!container.contains(button)||button.disabled)return;
  const action=button.dataset.teamAction,id=button.dataset.teamId;
  if(action==='retry')await controller.retryPending();
  else if(action==='tab'&&button.dataset.value==='mine')await controller.mine();
  else if(action==='tab'&&button.dataset.value==='create')await controller.create();
  else if(action==='tab'&&button.dataset.value==='lobby')await controller.search(controller.snapshot().query);
  else if(action==='view')await controller.view(id);
  else if(action==='clear')await controller.clear();
  else if(action==='back')await controller.search(controller.snapshot().query);
  else if(action==='join'||action==='apply')await controller.operate(action,id);
 };
 const submit=async event=>{
  const form=event.target.closest('[data-team-form]');if(!form||!container.contains(form))return;
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
  if(form.dataset.teamForm!=='search')return;
  event.preventDefault();const data=new FormData(form);await controller.search({query:String(data.get('query')||''),mode:String(data.get('mode')||'all'),recruitment:String(data.get('recruitment')||'all')});
 };
 container.addEventListener('click',click);container.addEventListener('submit',submit);void controller.search();
 return {controller,destroy(){controller.dispose();container.removeEventListener('click',click);container.removeEventListener('submit',submit);container.replaceChildren();}};
}
if(typeof module==='object'&&module.exports)module.exports={mount};else root.BXHTeamMount={mount};
})(typeof window==='object'?window:globalThis);
