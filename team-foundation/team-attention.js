(function(root){
'use strict';
function create({identity,read,onChange,clock=Date.now}){
 let owner=null,pending=false,last=-Infinity,interval=60000,flight=null;
 function sync(){const uid=identity();if(uid!==owner){owner=uid;pending=false;last=-Infinity;flight=null;onChange(false);}return uid;}
 async function refresh(force=false){const uid=sync();if(!uid||flight||!force&&clock()-last<interval)return;const ticket={};flight=ticket;last=clock();try{const r=await read();if(sync()!==uid||flight!==ticket)return;const leader=['captain','deputy'].includes(r?.team?.role);interval=leader?60000:300000;pending=leader&&r.team.hasPendingApplications===true;onChange(pending);}catch(_){/* A failed read must not erase a known unresolved reminder. */}finally{if(flight===ticket)flight=null;}}
 return {sync,refresh,pending:()=>{sync();return pending;}};
}
if(typeof module==='object'&&module.exports){module.exports={create};return;}
function identity(){const p=typeof userProfile==='object'?userProfile:null;return root.BXH_TEAM_FULL_ENABLED===true&&p?.active===true&&p.isTestAccount!==true&&['player','staff','admin','super_admin'].includes(p.role)&&typeof currentAuthUid==='function'?currentAuthUid():null;}
const selectors='[data-action="player-switch-tab"][data-tab="team-preview"],[data-action="switch-tab"][data-tab="team-preview"],[data-management-v2-tab="team-preview"],[data-management-v2-group="team"],[data-team-action="tab"][data-value="mine"],[data-team-action="applications"]';
function paint(){const pending=attention.pending();for(const button of document.querySelectorAll(selectors)){let badge=button.querySelector('[data-team-pending-badge]');if(pending&&!badge){badge=document.createElement('span');badge.setAttribute('data-team-pending-badge','');badge.setAttribute('role','status');badge.setAttribute('aria-label','有待審核的戰隊加入申請');badge.textContent=' ❗';button.append(badge);}else if(!pending)badge?.remove();}}
let notified=false;
const attention=create({identity,read:()=>root.engagementService.tournamentOperation('teamRead',{action:'mine'}),onChange:pending=>{paint();if(pending&&!notified){notified=true;void root.BXHMailbox?.loadMailbox?.(true);}else if(!pending)notified=false;}});
root.BXHTeamAttention={sync(){attention.sync();paint();if(!document.hidden)void attention.refresh();},refresh:()=>{if(!document.hidden)return attention.refresh(true);}};
setInterval(()=>{if(!document.hidden)void attention.refresh();},60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)root.BXHTeamAttention.refresh();});
})(typeof window==='object'?window:globalThis);
