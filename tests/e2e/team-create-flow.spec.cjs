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
  if(u.pathname==='/modules/cloud/cloud-runtime.js')return route.fulfill({contentType:'text/javascript',body:'// Isolated team preview services.'});
  return route.continue();
 });
 await page.addInitScript(({ui})=>{
  localStorage.setItem('bxh:management-interface',ui);
  window.teamFixture={calls:[],ready:false,created:null,capacity:'open'};
  window.cloudSync={isEnabled:()=>true,connect:async()=>true,
   subscribePublicTournaments:()=>()=>{},queryPublicTournaments:async()=>({ok:true,items:[],fromCache:false,hasPendingWrites:false}),queryMyRegistrations:async()=>[],queryAdminTournaments:async()=>[]};
  window.cloudAuth={isReady:()=>true,hasSuperAdmin:async()=>true,onAuthChange:()=>{teamFixture.ready=true;return ()=>{};},touchLastLogin:()=>{},signOutUser:async()=>{}};
  window.engagementService={mailbox:async()=>({ok:true,messages:[],unreadCount:0}),mood:async()=>({ok:true,messages:[]}),courtCall:async()=>({ok:true,rows:[],prepares:[]}),familyRegistration:async()=>({ok:true,rows:[]}),
   tournamentOperation:async(name,p)=>{
    teamFixture.calls.push({name,p});
    if(name==='teamRead'&&p.action==='list')return {items:[],total:0};
    if(name==='teamRead'&&p.action==='mine')return {team:teamFixture.created,creationCapacity:{status:teamFixture.capacity,activeCount:0,limit:200}};
    if(name==='teamCommand'&&p.action==='create'){teamFixture.created={id:p.teamId,name:p.name,role:'captain',memberCount:1,level:1,capacity:10,totalXp:0,unlockedFrames:[]};return {ok:true};}
    throw Error('Unexpected test request '+name+':'+p.action);
   }};
 },{ui});
 await page.goto('/',{waitUntil:'load'});expect(await page.evaluate(()=>window.BXH_TEAM_FULL_ENABLED)).toBe(true);await page.waitForFunction(()=>window.teamFixture?.ready&&window.BXHTeamFull);
 await page.evaluate(mode=>{
  firebaseUser={uid:'fixture-admin',email:'team@example.invalid'};
  userProfile={role:'super_admin',active:true,realName:'測試管理員',displayName:'測試管理員',email:'team@example.invalid'};
  currentRole=mode==='admin'?'admin':'player';appPhase=mode==='admin'?'app':'player-center';
  activeTab='version';playerActiveTab='home';render();
 },mode);
 return errors;
}

test('create flow reads capacity, submits once, then shows the new captain team',async({page})=>{
 const errors=await open(page);await page.locator('[data-management-v2-group="team"]').click();
 await page.getByRole('button',{name:'建立戰隊',exact:true}).click();
 const form=page.locator('[data-team-form="create"]');await expect(form).toBeVisible();
 await form.locator('[name="name"]').fill('BXH 測試戰隊');await form.getByRole('button',{name:'建立戰隊',exact:true}).click();
 await expect(page.getByRole('heading',{name:'我的戰隊',exact:true})).toBeVisible();
 await expect(page.locator('#bxh-team-full-slot')).toContainText('BXH 測試戰隊');
 const writes=await page.evaluate(()=>teamFixture.calls.filter(c=>c.name==='teamCommand'));
 expect(writes).toHaveLength(1);expect(writes[0].p.action).toBe('create');expect(writes[0].p.requestId).toBeTruthy();expect(writes[0].p.actorUid).toBeUndefined();
 await page.evaluate(()=>render());await expect(page.locator('#bxh-team-full-slot')).toContainText('BXH 測試戰隊');
 expect(await page.evaluate(()=>teamFixture.calls.filter(c=>c.name==='teamCommand').length)).toBe(1);expect(errors).toEqual([]);
});
test('unknown capacity and existing membership do not offer a create form',async({page})=>{
 const errors=await open(page);await page.evaluate(()=>{teamFixture.capacity='unavailable';});
 await page.locator('[data-management-v2-group="team"]').click();await page.getByRole('button',{name:'建立戰隊',exact:true}).click();
 await expect(page.locator('[data-team-form="create"]')).toHaveCount(0);await expect(page.locator('#bxh-team-full-slot')).toContainText('戰隊名額暫時無法確認');
 await page.evaluate(()=>{teamFixture.created={id:'existing',name:'原戰隊',role:'member',memberCount:2};});
 await page.getByRole('button',{name:'重新整理名額'}).click();await expect(page.locator('[data-team-form="create"]')).toHaveCount(0);await expect(page.locator('#bxh-team-full-slot')).toContainText('已有所屬戰隊');expect(errors).toEqual([]);
});
