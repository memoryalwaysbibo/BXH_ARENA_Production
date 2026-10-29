(function(root){
'use strict';
// The full flow is staged independently from the deployed read-only preview.
if(root.BXH_TEAM_FULL_ENABLED!==true)return;
const files=['team-api.js','emblem-presets.js','team-ui.js','team-emblem.js','team-controller.js','team-mount.js','team-host.js','team-full-integration.js'];
async function load(){
 for(const file of files){
  if(root.BXH_TEAM_FULL_ENABLED!==true)return;
  await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='team-foundation/'+file+'?v=20261029-team-lobby-simple-1';script.onload=resolve;script.onerror=()=>reject(Error('team-module-unavailable'));document.head.append(script);});
 }
 if(root.BXH_TEAM_FULL_ENABLED===true&&typeof render==='function')render();
}
void load().catch(()=>root.console?.warn('戰隊功能暫時無法載入'));
})(window);
