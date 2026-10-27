(function(root){
'use strict';
function mount({container,api,ui=root.BXHTeamUI,controllers=root.BXHTeamController}){
 if(!container||!ui||!controllers)throw Error('team-components-required');
 const controller=controllers.createTeamController({api,onChange:render});
 function render(state){
  container.innerHTML='<style>'+ui.css+'</style>'+(state.screen==='members'&&!state.loading&&!state.error&&state.team?'<button type="button" data-team-action="back">返回戰隊大廳</button>'+ui.publicMembers(state.team):ui.lobby({...state,...state.query}));
  if(state.busy)for(const button of container.querySelectorAll('button[data-team-id]'))button.disabled=true;
  if(state.error){const p=container.ownerDocument.createElement('p');p.setAttribute('role','alert');p.textContent=state.error;container.append(p);}
 }
 const click=async event=>{
  const button=event.target.closest('[data-team-action]');if(!button||!container.contains(button)||button.disabled)return;
  const action=button.dataset.teamAction,id=button.dataset.teamId;
  if(action==='view')await controller.view(id);
  else if(action==='clear')await controller.clear();
  else if(action==='back')await controller.search(controller.snapshot().query);
  else if(action==='join'||action==='apply')await controller.operate(action,id);
 };
 const submit=async event=>{
  const form=event.target.closest('[data-team-form="search"]');if(!form||!container.contains(form))return;
  event.preventDefault();const data=new FormData(form);await controller.search({query:String(data.get('query')||''),mode:String(data.get('mode')||'all'),recruitment:String(data.get('recruitment')||'all')});
 };
 container.addEventListener('click',click);container.addEventListener('submit',submit);void controller.search();
 return {controller,destroy(){controller.dispose();container.removeEventListener('click',click);container.removeEventListener('submit',submit);container.replaceChildren();}};
}
if(typeof module==='object'&&module.exports)module.exports={mount};else root.BXHTeamMount={mount};
})(typeof window==='object'?window:globalThis);
