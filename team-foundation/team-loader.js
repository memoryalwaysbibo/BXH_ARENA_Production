(function(root){
'use strict';
// Candidate flag must be set before this script runs; disabled means no extra requests.
if(root.BXH_TEAM_PREVIEW!==true)return;
const files=['team-api.js','team-ui.js','team-controller.js','team-mount.js','team-host.js','team-ranking.js','team-card.js','team-main-integration.js'];
async function load(){
 for(const file of files){
  if(root.BXH_TEAM_PREVIEW!==true)return;
  await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='team-foundation/'+file+'?v=20261027-team-candidate';script.onload=resolve;script.onerror=()=>reject(Error('team-module-unavailable'));document.head.appendChild(script);});
 }
 if(root.BXH_TEAM_PREVIEW===true&&typeof render==='function')render();
}
void load().catch(()=>{if(root.console?.warn)root.console.warn('戰隊功能暫時無法載入');});
})(window);
