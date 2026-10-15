'use strict';
const {test,expect}=require('@playwright/test');
const fs=require('node:fs');
async function open(page,enabled=true){
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(!['localhost','127.0.0.1'].includes(u.hostname))return route.abort();if(u.pathname==='/modules/cloud/cloud-runtime.js')return route.fulfill({contentType:'text/javascript',body:'// Synthetic service boundary, no Firebase.'});return route.continue()});
 await page.addInitScript(enabled=>{
  window.BXH_FEATURE_FLAGS={uidActiveEvents:enabled};
  const clone=x=>JSON.parse(JSON.stringify(x));
  const f=window.activeFixture={legacy:0,indexReads:0,roomReads:[],state:'pending',memberships:[],rooms:{},error:false,auth:null};
  window.cloudSync={isEnabled:()=>true,connect:async()=>true,queryPublicTournaments:async()=>({ok:true,items:[],fromCache:false,hasPendingWrites:false}),subscribePublicTournaments:()=>()=>{},queryMyRegistrations:async()=>{f.legacy++;return []},getPublicTournamentSummary:async()=>null,queryMyActiveRegistrationHints:async()=>[],
   readMyActiveMemberships:async context=>{f.indexReads++;if(f.error)throw Error('permission-denied');if(f.defer){const result=await new Promise(resolve=>f.release=resolve);return result}return {schemaVersion:1,status:f.state,generation:'g1',revision:1,memberships:clone(f.memberships)}},readMyActivePublicRoom:async code=>{f.roomReads.push(code);if(!f.rooms[code])throw Error('missing');return clone(f.rooms[code])}};
  window.cloudAuth={isReady:()=>true,hasSuperAdmin:async()=>true,onAuthChange:callback=>{f.auth=callback;return ()=>{}},getUserProfile:async uid=>({uid,role:'player',active:true,realName:'隔離測試選手',displayName:'隔離測試選手',email:'fixture@example.invalid'}),touchLastLogin:()=>{},signOutUser:async()=>{}};
  window.engagementService={mailbox:async()=>({ok:true,messages:[],unreadCount:0}),mood:async()=>({ok:true,messages:[]}),courtCall:async()=>({ok:true,rows:[],prepares:[]})};
 },enabled);
 await page.goto('/');await page.waitForFunction(()=>typeof activeFixture.auth==='function');
 await page.evaluate(async()=>{pendingLoginIntent='player';playerActiveTab='registered';await activeFixture.auth({uid:'user-a',email:'fixture@example.invalid'});appPhase='player-center';currentRole='player';render()});
 return errors;
}
test('pending readiness then UID-only rooms, waiting and uncertain identities',async({page},testInfo)=>{
 const errors=await open(page);await expect(page.getByText('你的賽事清單仍在建立或更新，尚不能確認目前是否有賽事。')).toBeVisible();
 await page.evaluate(()=>{
  const member=(code,participants)=>({schemaVersion:1,code,generation:'g1',sourceRevision:'r1',participants});const p=(id,extra={})=>({kind:'self',registrationId:'user-a',registrationStatus:'confirmed',participantId:id,...extra});
  activeFixture.state='ready';activeFixture.memberships=[member('BXH-LIVE',[p('p1'),p('child',{kind:'family',familyPlayerId:'c1'})]),member('BXH-WAIT',[p(null,{registrationStatus:'waitlist'})])];
  activeFixture.rooms={'BXH-LIVE':{visibility:'public',name:'隔離跨日賽事',tournamentPhase:'live',eventDate:'2000-01-01',parsedData:{startedAt:1,meta:{formatType:'double'},players:[{id:'p1',name:'測試本人'}],matches:[{a:{playerId:'p1'},b:{playerId:'p2'},completed:false}]}},'BXH-WAIT':{visibility:'public',name:'隔離待開賽',tournamentPhase:'waiting',parsedData:null}};
 });
 await page.locator('[data-action="active-events-refresh"]').click();await expect(page.getByText('測試本人',{exact:true})).toBeVisible();await expect(page.getByText('公開名單尚未對上可信參賽身分')).toBeVisible();await expect(page.getByText('待開賽／待確認（1）')).toBeVisible();
 expect(await page.evaluate(()=>activeFixture.roomReads)).toEqual(['BXH-LIVE','BXH-WAIT']);expect(await page.evaluate(()=>activeFixture.legacy)).toBe(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);fs.mkdirSync('test-results/active-events',{recursive:true});await page.screenshot({path:`test-results/active-events/${testInfo.project.name}.png`,fullPage:true});expect(errors).toEqual([]);
});
test('failed reads never claim empty, known mutation blocks empty until a receipt',async({page})=>{
 const errors=await open(page);await page.evaluate(()=>{activeFixture.error=true});await page.locator('[data-action="active-events-refresh"]').click();await expect(page.getByText('目前無法確認你的賽事，請稍後重新整理。這不代表你沒有賽事。')).toBeVisible();
 await page.evaluate(()=>{activeFixture.error=false;activeFixture.state='ready'});await page.locator('[data-action="active-events-refresh"]').click();await expect(page.getByText('目前已同步的賽事中，沒有進行中的個人賽程。')).toBeVisible();
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('bxh-active-event-mutation',{detail:{uid:'user-a',epoch:engagementSessionEpoch,code:'BXH-NEW'}})));await expect(page.getByText('剛才的參賽變更仍待索引核對')).toBeVisible();await expect(page.getByText('目前已同步的賽事中，沒有進行中的個人賽程。')).toHaveCount(0);expect(errors).toEqual([]);
});
test('flag disabled preserves legacy registered view and performs no index reads',async({page})=>{
 const errors=await open(page,false);await expect(page.getByText('目前沒有進行中的個人賽程')).toBeVisible();expect(await page.evaluate(()=>activeFixture.legacy)).toBeGreaterThan(0);expect(await page.evaluate(()=>activeFixture.indexReads)).toBe(0);await expect(page.getByText('我的目前賽事')).toHaveCount(0);expect(errors).toEqual([]);
});
test('late previous-account response cannot populate the new account',async({page})=>{
 const errors=await open(page);await page.evaluate(()=>{activeFixture.defer=true});await page.locator('[data-action="active-events-refresh"]').click();await page.waitForFunction(()=>!!activeFixture.release);
 await page.evaluate(async()=>{
  const release=activeFixture.release;activeFixture.defer=false;activeFixture.state='ready';
  await activeFixture.auth(null);pendingLoginIntent='player';playerActiveTab='registered';await activeFixture.auth({uid:'user-b',email:'b@example.invalid'});appPhase='player-center';currentRole='player';render();
  release({schemaVersion:1,status:'ready',generation:'g1',revision:1,memberships:[{schemaVersion:1,code:'BXH-PRIVATE-A',generation:'g1',sourceRevision:'old',participants:[{kind:'self',registrationId:'user-a',participantId:'p1',registrationStatus:'confirmed'}]}]});
 });
 await expect(page.getByText('目前已同步的賽事中，沒有進行中的個人賽程。')).toBeVisible();expect(await page.evaluate(()=>activeFixture.roomReads.includes('BXH-PRIVATE-A'))).toBe(false);expect(errors).toEqual([]);
});
