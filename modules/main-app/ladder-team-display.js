(function(root){
'use strict';
function create({read,identity,onChange}){
 let snapshots=new WeakMap(),epoch=0,preference=null;
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function state(){const uid=identity();if(preference?.uid!==uid)preference={uid,status:'idle',showTeam:true,error:''};return preference;}
 function invalidate(){epoch++;snapshots=new WeakMap();}
 function ensure(snapshot,rows){
  if(!snapshot||!Array.isArray(rows))return;
  let entries=snapshots.get(snapshot);if(!entries){entries=new Map();snapshots.set(snapshot,entries);}
  const ids=[...new Set(rows.map(p=>p.uid).filter(Boolean))].filter(uid=>!entries.has(uid));
  const ticket=epoch;
  for(let start=0;start<ids.length;start+=50){
   const chunk=ids.slice(start,start+50);chunk.forEach(uid=>entries.set(uid,null));
   void Promise.resolve().then(()=>read({action:'teams',uids:chunk})).then(result=>{
    if(ticket!==epoch||result?.ok!==true||result.version!==1||!result.teams)return;
    for(const uid of chunk){const team=result.teams[uid];entries.set(uid,team&&typeof team.name==='string'&&team.name.trim()?{name:team.name.trim().slice(0,100)}:null);}
    onChange(snapshot);
   }).catch(()=>{/* Display failures never block names, points or titles; board refresh retries. */});
  }
 }
 function lineHtml(snapshot,uid){const team=snapshots.get(snapshot)?.get(uid);return team?'<span class="ladder-player-team" title="'+escape(team.name)+'">（'+escape(team.name)+'）</span>':'';}
 async function loadPreference(){
  const s=state();if(!s.uid||s.status==='loading'||s.status==='saving')return;
  s.status='loading';s.error='';
  try{const result=await read({action:'settings'});if(state()!==s)return;if(result?.ok!==true||typeof result.showTeam!=='boolean')throw Error('invalid-response');s.showTeam=result.showTeam;s.status='ready';}
  catch(_){if(state()===s){s.status='error';s.error='戰隊顯示設定讀取失敗，請重試。';}}
  if(state()===s)onChange();
 }
 async function savePreference(value){
  const s=state();if(s.status!=='ready')return;
  s.status='saving';s.error='';onChange();
  try{const result=await read({action:'save',showTeam:value});if(state()!==s)return;if(result?.ok!==true||result.showTeam!==value)throw Error('invalid-response');s.showTeam=value;s.status='ready';invalidate();}
  catch(_){if(state()===s){s.error='儲存尚未確認，請重新讀取設定後再試。';s.status='error';}}
  if(state()===s)onChange();
 }
 function preferenceHtml(){
  const s=state();if(!s.uid)return '';
  if(s.status==='idle'){s.status='queued';void Promise.resolve().then(()=>{if(state()===s)void loadPreference();});}
  return '<div class="ladder-team-preference"><label style="display:flex;align-items:center;gap:10px;margin-top:16px"><input style="width:18px;height:18px;flex:none" type="checkbox" data-ladder-team-display '+(s.showTeam?'checked ':'')+(s.status!=='ready'?'disabled ':'')+'> 顯示戰隊名稱（天梯榜）</label><p class="hint">'+escape(s.error||(s.status==='saving'?'儲存中…':s.status==='ready'?'變更後自動儲存。無戰隊時自動收起，加入後依此設定顯示。':'正在讀取戰隊顯示設定…'))+'</p>'+(s.status==='error'?'<button type="button" class="btn btn-ghost btn-sm" data-ladder-team-retry>重新讀取</button>':'')+'</div>';
 }
 return {ensure,lineHtml,preferenceHtml,loadPreference,savePreference,invalidate};
}
if(typeof module==='object'&&module.exports){module.exports={create};return;}
root.BXHLadderTeamDisplay=create({
 read:payload=>root.engagementService.ladderTeamDisplay(payload),
 identity:()=>typeof currentAuthUid==='function'?currentAuthUid():'',
 onChange:snapshot=>{if(snapshot&&typeof ladderPublicData!=='undefined'&&snapshot!==ladderPublicData)return;if(typeof renderPreservingScroll==='function')renderPreservingScroll();else if(typeof render==='function')render();}
});
document.addEventListener('change',event=>{if(event.target?.matches?.('[data-ladder-team-display]'))void root.BXHLadderTeamDisplay.savePreference(event.target.checked);});
document.addEventListener('click',event=>{if(event.target?.closest?.('[data-ladder-team-retry]')){event.preventDefault();void root.BXHLadderTeamDisplay.loadPreference();}});
// Re-read current membership after returning to the app or a successful team operation.
function refresh(){root.BXHLadderTeamDisplay.invalidate();if(document.querySelector('.ladder-rank-board-v2')&&typeof renderPreservingScroll==='function')renderPreservingScroll();}
root.addEventListener('bxh-team-changed',refresh);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
})(typeof window!=='undefined'?window:globalThis);
