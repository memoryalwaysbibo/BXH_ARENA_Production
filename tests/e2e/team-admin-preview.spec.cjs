'use strict';
const {test,expect}=require('@playwright/test');
// Shipped application, menus and page module; only identity/cloud services are
// synthetic. This never contacts Firebase or changes production team data.
test.use({serviceWorkers:'block',contextOptions:{reducedMotion:'reduce'}});
async function open(page,mode='admin',ui='v2'){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{
  const u=new URL(route.request().url());
  if(!['localhost','127.0.0.1'].includes(u.hostname))return route.abort('blockedbyclient');
  // Exercise the retained read-only fallback with the full feature disabled.
  if(u.pathname==='/index.html'||u.pathname==='/')return route.fetch().then(async r=>route.fulfill({response:r,body:(await r.text()).replace('window.BXH_TEAM_FULL_ENABLED = true;','window.BXH_TEAM_FULL_ENABLED = false;')}));
  if(u.pathname==='/modules/cloud/cloud-runtime.js')return route.fulfill({contentType:'text/javascript',body:'// Isolated team preview services.'});
  return route.continue();
 });
 await page.addInitScript(({ui})=>{
  localStorage.setItem('bxh:management-interface',ui);
  window.teamFixture={calls:[],ready:false};
  window.cloudSync={isEnabled:()=>true,connect:async()=>true,
   subscribePublicTournaments:()=>()=>{},queryPublicTournaments:async()=>({ok:true,items:[],fromCache:false,hasPendingWrites:false}),queryMyRegistrations:async()=>[],queryAdminTournaments:async()=>[]};
  window.cloudAuth={isReady:()=>true,hasSuperAdmin:async()=>true,onAuthChange:()=>{teamFixture.ready=true;return ()=>{};},touchLastLogin:()=>{},signOutUser:async()=>{}};
  window.engagementService={mailbox:async()=>({ok:true,messages:[],unreadCount:0}),mood:async()=>({ok:true,messages:[]}),courtCall:async()=>({ok:true,rows:[],prepares:[]}),familyRegistration:async()=>({ok:true,rows:[]}),
   tournamentOperation:async(name,p)=>{
    teamFixture.calls.push({name,p});
    if(name!=='teamPreviewRead'||!['list','ranking','members'].includes(p.action))throw Error('Unexpected mutation');
    return p.action==='members'?{name:'BXH 測試戰隊',members:[{name:'測試隊長',role:'captain'}]}:{items:[{id:'fixture-team',name:'BXH 測試戰隊',strength:123}],total:1};
   }};
 },{ui});
 await page.goto('/',{waitUntil:'load'});await page.waitForFunction(()=>window.teamFixture?.ready);
 await page.evaluate(mode=>{
  firebaseUser={uid:'fixture-admin',email:'team@example.invalid'};
  userProfile={role:'super_admin',active:true,realName:'測試管理員',displayName:'測試管理員',email:'team@example.invalid'};
  currentRole=mode==='admin'?'admin':'player';appPhase=mode==='admin'?'app':'player-center';
  activeTab='version';playerActiveTab='home';render();
 },mode);
 return errors;
}
test('management primary menu opens an inline read-only team page and removes it on exit',async({page})=>{
 const errors=await open(page);
 const group=page.locator('[data-management-v2-group="team"]');await expect(group).toBeVisible();
 expect(await page.evaluate(()=>teamFixture.calls.length)).toBe(0);
 await group.click();const teamPage=page.getByRole('region',{name:'戰隊管理員唯讀預覽'});
 await expect(teamPage.getByRole('button',{name:'BXH 測試戰隊',exact:true})).toBeVisible();
 await expect(page.locator('#app main [data-team-admin-preview-page]')).toBeVisible();
 await teamPage.getByRole('button',{name:'戰隊排行',exact:true}).click();
 await teamPage.getByRole('button',{name:'BXH 測試戰隊',exact:true}).click();
 await expect(teamPage.getByText('測試隊長｜隊長')).toBeVisible();
 await page.evaluate(()=>render());await expect(teamPage.getByText('測試隊長｜隊長')).toBeVisible();
 expect(await page.evaluate(()=>teamFixture.calls.map(x=>x.p.action))).toEqual(['list','ranking','members']);
 await page.locator('[data-management-v2-group="event"]').click();await expect(teamPage).toHaveCount(0);
 expect(await page.locator('aside[aria-label="戰隊管理員預覽"]').count()).toBe(0);
 await page.evaluate(()=>{userProfile.role='admin';render();});await expect(group).toHaveCount(0);
 expect(errors).toEqual([]);
});
test('legacy management and player primary tabs route to teams; ordinary players cannot enter',async({page})=>{
 const errors=await open(page,'admin','v1');
 await page.locator('nav.tabs [data-tab="team-preview"]').click();
 await expect(page.locator('[data-team-admin-preview-page]')).toBeVisible();
 await page.evaluate(()=>{appPhase='player-center';currentRole='player';playerActiveTab='home';render();});
 await page.locator('.player-shell [data-tab="team-preview"]').click();
 await expect(page.locator('.player-main [data-team-admin-preview-page]')).toBeVisible();
 const panel=page.locator('[data-team-admin-preview-page]');
 await panel.getByRole('button',{name:'戰隊排行',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>teamFixture.calls.at(-1).p.action)).toBe('ranking');
 await page.evaluate(()=>{userProfile.role='player';render();});
 await expect(page.locator('[data-tab="team-preview"]')).toHaveCount(0);await expect(panel).toHaveCount(0);
 const count=await page.evaluate(()=>teamFixture.calls.length);
 await page.evaluate(()=>{playerActiveTab='team-preview';render();});await expect(panel).toHaveCount(0);
 expect(await page.evaluate(()=>teamFixture.calls.length)).toBe(count);expect(errors).toEqual([]);
});
