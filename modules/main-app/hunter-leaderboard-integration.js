(function(){
'use strict';
if(window.__BXH_HUNTER_BOARD__||typeof renderLadderLeaderboardPage!=='function'||!window.BXHHunterLeaderboard)return;
window.__BXH_HUNTER_BOARD__=true;
const original=renderLadderLeaderboardPage;
let view='ladder',controller;
const board=()=>controller||(controller=window.BXHHunterLeaderboard.create({
 load:payload=>window.engagementService.tournamentOperation('getHunterLeaderboard',payload),
 identity:()=>currentAuthUid(),onChange:()=>renderPreservingScroll()
}));
const tabs=()=>`<div class="ranking-board-switch" role="group" aria-label="排行榜種類">${[['ladder','天梯榜'],['hunter','獵人榜']].map(([key,title])=>`<button class="btn ${view===key?'btn-primary':'btn-ghost'}" data-action="ranking-board" data-value="${key}" aria-pressed="${view===key}">${title}</button>`).join('')}</div>`;
renderLadderLeaderboardPage=function(adminMode){return tabs()+(view==='hunter'?board().render(esc):original(adminMode));};
document.addEventListener('click',event=>{
 const target=event.target?.closest?.('[data-action]'),action=target?.getAttribute('data-action');
 if(!['ranking-board','hunter-board-refresh','hunter-board-more'].includes(action))return;
 event.preventDefault();event.stopImmediatePropagation();
 if(target.disabled)return;
 if(action==='ranking-board'){
  const key=target.getAttribute('data-value');if(['ladder','hunter'].includes(key)){view=key;renderPreservingScroll();}
 }else if(action==='hunter-board-refresh')void board().refresh();else void board().more();
},true);
})();
