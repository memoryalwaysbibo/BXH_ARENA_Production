(function(){
'use strict';
// Explicit candidate flag; production defaults to disabled.
if(window.BXH_TEAM_PREVIEW!==true||!Array.isArray(PLAYER_TABS)||typeof render!=='function'||typeof renderPlayerHomeTab!=='function'||!window.BXHTeamHost||!window.BXHTeamMount||!window.BXHTeamApi)return;
if(PLAYER_TABS.some(([key])=>key==='teams'))return;
PLAYER_TABS.push(['teams','戰隊']);
const originalRender=render,originalHome=renderPlayerHomeTab;
let teamNode=null,host=null;
function reset(){if(host)host.close();host=null;teamNode=null;}
renderPlayerHomeTab=function(p){
 if(appPhase==='player-center'&&playerActiveTab==='teams'&&currentRole==='player')return '<div id="bxh-team-host-slot"></div>';
 return originalHome(p);
};
render=function(){
 const active=appPhase==='player-center'&&playerActiveTab==='teams'&&currentRole==='player'&&!!currentAuthUid()&&window.BXH_TEAM_PREVIEW===true;
 if(!active&&host)reset();
 originalRender();
 if(!active)return;
 const slot=document.getElementById('bxh-team-host-slot');if(!slot)return;
 if(!teamNode){
  teamNode=document.createElement('div');
  host=window.BXHTeamHost.createTeamHost({container:teamNode,isEnabled:()=>window.BXH_TEAM_PREVIEW===true,getIdentity:()=>currentAuthUid(),apiFactory:()=>window.BXHTeamApi.createTeamApiFromEngagement({engagementService:window.engagementService}),component:window.BXHTeamMount});
 }
 slot.append(teamNode);host.sync();const result=host.open();
 if(!result.ok)teamNode.textContent=result.reason==='sign-in-required'?'請先登入。':'戰隊功能暫時無法載入，請稍後再試。';
};
window.BXHTeamOpenPublic=function(teamId){
 if(window.BXH_TEAM_PREVIEW!==true||currentRole!=='player'||!currentAuthUid()||(teamId!==null&&teamId!==undefined&&!/^[A-Za-z0-9_-]{1,128}$/.test(teamId)))return false;
 appPhase='player-center';playerActiveTab='teams';render();
 if(!host||typeof host.navigate!=='function')return false;
 void host.navigate(teamId||null);return true;
};
})();
