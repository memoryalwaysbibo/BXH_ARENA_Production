(function(){
'use strict';
if(window.__BXH_HUNTER_BOARD__||typeof renderLadderLeaderboardPage!=='function'||!window.BXHHunterLeaderboard)return;
window.__BXH_HUNTER_BOARD__=true;
const original=renderLadderLeaderboardPage;
let view='ladder',controller,teamController;
const teamVisible=()=>window.BXH_TEAM_FULL_ENABLED===true&&!!currentAuthUid()&&typeof userProfile==='object'&&userProfile?.active===true&&userProfile.isTestAccount!==true&&['player','staff','admin','super_admin'].includes(userProfile.role);
const teamBoard=()=>teamController||(teamController=window.BXHTeamLeaderboard.create({loadMembers:teamId=>window.engagementService.tournamentOperation('teamRead',{action:'members',teamId}),load:query=>window.engagementService.tournamentOperation('teamRead',{action:'ranking',query}),identity:()=>teamVisible()?currentAuthUid():null,onChange:()=>renderPreservingScroll()}));
const board=()=>controller||(controller=window.BXHHunterLeaderboard.create({
 load:payload=>window.engagementService.tournamentOperation('getHunterLeaderboard',payload),
 identity:()=>currentAuthUid(),onChange:()=>renderPreservingScroll()
}));
const tabs=()=>`<div class="ranking-board-switch" role="group" aria-label="排行榜種類">${[['ladder','天梯榜'],['hunter','獵人榜'],...(teamVisible()?[['team','戰隊榜']]:[])].map(([key,title])=>`<button class="btn ${view===key?'btn-primary':'btn-ghost'}" data-action="ranking-board" data-value="${key}" aria-pressed="${view===key}">${title}</button>`).join('')}</div>`;
renderLadderLeaderboardPage=function(adminMode){if(view==='team'&&!teamVisible())view='ladder';teamController?.state();return tabs()+(view==='team'?teamBoard().render(esc):view==='hunter'?board().render(esc):original(adminMode));};
document.addEventListener('toggle',event=>{const row=event.target;if(row.matches?.('details[data-team-board-id]')&&teamVisible()&&view==='team')void teamBoard().expand(row.getAttribute('data-team-board-id'),row.open);},true);
document.addEventListener('click',event=>{
 const target=event.target?.closest?.('[data-action]'),action=target?.getAttribute('data-action');
 if(!['ranking-board','hunter-board-refresh','hunter-board-more','team-board-refresh','team-board-next','team-board-previous','team-board-members-retry'].includes(action))return;
 event.preventDefault();event.stopImmediatePropagation();
 if(target.disabled)return;
 if(action==='ranking-board'){
  const key=target.getAttribute('data-value');if(['ladder','hunter',...(teamVisible()?['team']:[])].includes(key)){view=key;renderPreservingScroll();}
 }else if(action.startsWith('team-board-')){if(!teamVisible()||view!=='team')return;if(action==='team-board-members-retry')void teamBoard().expand(target.getAttribute('data-team-id'),true,true);else if(action==='team-board-next')void teamBoard().next();else if(action==='team-board-previous')void teamBoard().previous();else void teamBoard().refresh();}else if(action==='hunter-board-refresh')void board().refresh();else void board().more();
},true);
})();
