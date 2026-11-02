(function(root){
'use strict';
const allowed=p=>!!p?.uid&&p.active===true&&p.isTestAccount!==true&&['player','staff','admin','super_admin'].includes(p.role);
function create({getIdentity,isEnabled,getSlot,apiFactory,component,hostFactory}){
 let host=null,node=null,uid=null;
 const visible=()=>isEnabled()===true&&allowed(getIdentity());
 function close(){host?.close();host=null;node?.remove();node=null;uid=null;}
 function page(){return visible()?'<section class="panel" aria-label="戰隊"><div id="bxh-team-full-slot"></div></section>':'';}
 function bind(){
  root.BXHTeamAttention?.sync();
  const slot=getSlot();if(!visible()||!slot){close();return;}
  const nextUid=getIdentity().uid;if(host&&uid!==nextUid)close();
  if(!host){node=slot.ownerDocument.createElement('div');uid=nextUid;host=hostFactory({container:node,isEnabled:visible,getIdentity:()=>visible()?getIdentity().uid:null,apiFactory,component});}
  slot.append(node);host.sync();const result=host.open();
  if(!result.ok)node.textContent='戰隊功能暫時無法載入，請稍後再試。';
 }
 return {visible,page,bind,close};
}
if(typeof module==='object'&&module.exports){module.exports={create,allowed};return;}
root.BXHTeamFull=create({getIdentity:()=>{const p=typeof userProfile==='object'?userProfile:null;return p?{uid:typeof currentAuthUid==='function'?currentAuthUid():null,role:p.role,active:p.active,isTestAccount:p.isTestAccount}:null;},isEnabled:()=>root.BXH_TEAM_FULL_ENABLED===true,getSlot:()=>document.getElementById('bxh-team-full-slot'),apiFactory:()=>root.BXHTeamApi.createTeamApiFromEngagement({engagementService:root.engagementService}),component:root.BXHTeamMount,hostFactory:root.BXHTeamHost.createTeamHost});
})(typeof window==='object'?window:globalThis);
