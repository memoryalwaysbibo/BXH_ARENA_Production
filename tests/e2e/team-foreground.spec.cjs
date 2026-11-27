'use strict';
const fs=require('node:fs'),path=require('node:path');
const {test,expect}=require('@playwright/test');
const root=path.resolve(__dirname,'../..');
const core=fs.readFileSync(path.join(root,'modules/main-app/core.js'),'utf8');
const start=core.indexOf('function renderPlayerCenterLoggedIn(){');
if(start<0)throw Error('ordinary player entry missing');
const end=core.indexOf('\n}',start);
if(end<0)throw Error('ordinary player entry incomplete');
const shell=core.slice(start,end+2);

// Actual candidate shell and team modules, isolated synthetic identity and
// response service. Browser DOM interactions, controlled visibility events;
// no production backend, credentials, player data or network requests.
test('ordinary player team ranking coalesces foreground updates',async({page})=>{
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>route.abort());
 await page.setContent('<div id="app"></div>');
 await page.addScriptTag({content:`
let userProfile={active:true,role:'player'},appPhase='player-center',playerActiveTab='home',activeTab='home';
const currentAuthUid=()=> 'fixture',esc=String,LOGO_SRC='',mailboxContext=()=>({messages:[],open:false});
let calls=[],now=100000,hidden=false;
Date.now=()=>now;Object.defineProperty(document,'hidden',{get:()=>hidden});
function away(ms){hidden=true;document.dispatchEvent(new Event('visibilitychange'));now+=ms;hidden=false;document.dispatchEvent(new Event('visibilitychange'))}
function renderLadderLeaderboardPage(){return '<div>天梯榜 fixture</div>'}
window.BXH_TEAM_FULL_ENABLED=true;window.BXHHunterLeaderboard={};
window.engagementService={tournamentOperation:async(action,payload)=>{
 if(action!=='teamRead')throw Error('unexpected fixture operation');
 calls.push(payload.action);
 return payload.action==='members'?{id:'t1',members:[{name:'fixture member'}]}:{items:[{id:'t1',name:'Fixture Team',captainName:'Fixture',rank:1,strength:25,memberCount:1,level:1}],total:21,excluded:0,partial:false,offset:payload.query.offset,limit:20};
}};
const playerVisibleTabs=()=>[['home','大廳'],['ladder','排行榜']];
const renderPlayerHomeTab=()=>'<div>大廳 fixture</div>';
for(const name of ['topbarConnectionRailHtml','accountEquippedTitleHtml','mailboxButtonHtml','accountMenuHtml','renderPlayerNavHtml','accountMenuOverlayHtml','renderPlayerQrCheckinEntry','renderModal','renderCloudJoinModal','renderEventEntryModal','renderQrScannerModal','renderSwitchTournamentModal','renderAdminTournamentListModal','renderPlayerProfileEditModal','renderPlayerProfileReminder'])window[name]=()=> '';
function renderPreservingScroll(){document.querySelector('#app').innerHTML=renderPlayerCenterLoggedIn()}
document.addEventListener('click',e=>{const t=e.target.closest('[data-action="player-switch-tab"]');if(t){playerActiveTab=t.dataset.tab;renderPreservingScroll()}});
`+shell});
 for(const file of ['team-leaderboard.js','hunter-leaderboard-integration.js']){
  await page.addScriptTag({content:fs.readFileSync(path.join(root,'modules/main-app',file),'utf8')});
 }
 await page.evaluate(()=>renderPreservingScroll());
 const count=()=>page.evaluate(()=>calls.filter(x=>x==='ranking').length);
 await page.getByRole('button',{name:'排行榜',exact:true}).click();
 await page.getByRole('button',{name:'戰隊榜',exact:true}).click();
 await expect(page.getByText('Fixture Team',{exact:true})).toBeVisible();
 expect(await count()).toBe(1);
 await page.evaluate(()=>away(1000));expect(await count()).toBe(1);
 await page.evaluate(()=>away(31000));await expect.poll(count).toBe(2);
 await expect(page.getByRole('button',{name:'重新整理',exact:true})).toBeEnabled();
 await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));expect(await count()).toBe(2);
 await page.getByRole('button',{name:'下一頁'}).click();await expect(page.getByText('第 2 頁',{exact:true})).toBeVisible();
 await page.evaluate(()=>away(31000));expect(await count()).toBe(3);
 await page.getByRole('button',{name:'上一頁'}).click();await expect(page.getByText('第 1 頁',{exact:true})).toBeVisible();
 await page.locator('details[data-team-board-id] summary').click();await expect(page.getByText('fixture member',{exact:true})).toBeVisible();
 await page.evaluate(()=>away(31000));expect(await count()).toBe(4);
 await page.getByRole('button',{name:'大廳',exact:true}).click();await page.evaluate(()=>away(31000));expect(await count()).toBe(4);
 await page.getByRole('button',{name:'排行榜',exact:true}).click();
 await page.getByRole('button',{name:'重新整理',exact:true}).click();await expect.poll(count).toBe(5);
 expect(errors).toEqual([]);
});
