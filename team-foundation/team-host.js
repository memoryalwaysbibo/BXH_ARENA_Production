(function(root){
'use strict';
// Candidate host adapter: caller owns navigation and trusted login state.
function createTeamHost({container,isEnabled,getIdentity,apiFactory,component}){
 if(!container||typeof isEnabled!=='function'||typeof getIdentity!=='function'||typeof apiFactory!=='function'||typeof component?.mount!=='function')throw Error('team-host-dependencies-required');
 let active=null,activeUid=null;
 function close(){if(active){active.destroy();active=null;activeUid=null;}else container.replaceChildren();}
 function open(){
  if(!isEnabled()){close();return {ok:false,reason:'disabled'};}
  const uid=getIdentity();if(typeof uid!=='string'||!uid){close();return {ok:false,reason:'sign-in-required'};}
  if(active&&activeUid!==uid)close();
  if(active)return {ok:true,alreadyOpen:true};
  try{active=component.mount({container,api:apiFactory()});activeUid=uid;return {ok:true};}
  catch(_){close();return {ok:false,reason:'unavailable'};}
 }
 function sync(){if(!isEnabled()||!getIdentity()||active&&activeUid!==getIdentity())close();}
 return {open,close,sync};
}
if(typeof module==='object'&&module.exports)module.exports={createTeamHost};else root.BXHTeamHost={createTeamHost};
})(typeof window==='object'?window:globalThis);
