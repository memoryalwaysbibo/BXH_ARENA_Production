'use strict';
const {test,expect}=require('@playwright/test');
test.use({serviceWorkers:'block',reducedMotion:'reduce'});
// The actual reviewed frontend candidate and normal guest route are exercised.
// Only the cloud boundary is controlled; no old lab module/overlay or external request.
test('official guest summary page withdraws reset immediately and falls back to complete R1',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{const u=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(u.hostname))return route.abort('blockedbyclient');if(u.pathname==='/modules/cloud/cloud-runtime.js')return route.fulfill({contentType:'text/javascript',body:'// controlled cloud boundary'});return route.continue();});
 await page.addInitScript(()=>{
  const card=(id,phase)=>({id,name:'Official candidate '+id,title:'Official candidate '+id,visibility:'public',publishedAt:1,eventAuthority:'official',tournamentPhase:phase,eventDate:'2099-11-28',startAt:'12:00',hostName:'Fixture host',registrationStatus:'open',registrationEnabled:true,capacity:20,confirmedCount:1});
  const A=card('BXH-R2FIRST','live'),B=card('BXH-R2SECOND','waiting'),C={...card('BXH-R1FULL','waiting'),code:'BXH-R1FULL'};
  const f=window.r2OfficialFixture={cards:[A,B],version:1,requests:[],stopped:0,r1Watches:0,r1Reads:0,hold:false};
  const fresh=()=>({ok:true,items:[C],fromCache:false,hasPendingWrites:false,requiresLifecycleReconcile:false});
  window.cloudSync={isEnabled:()=>true,connect:async()=>true,watchArenaHomeR2Version(next,fail){f.next=next;f.fail=fail;queueMicrotask(()=>next({version:f.version,previous:null,fromCache:false,hasPendingWrites:false}));return()=>f.stopped++;},
   async readArenaHomeR2(q){f.requests.push(q);if(q.mode==='detail')return {kind:'detail',card:{...A,parsedData:{players:[{id:'p1',name:'Public roster fixture',checkedIn:true}]}}};if(f.hold)return new Promise(resolve=>{f.release=()=>resolve({kind:'first',version:f.version,cards:f.cards});});return {kind:'first',version:f.version,cards:f.cards};},
   subscribePublicTournaments(cb){f.r1Watches++;queueMicrotask(()=>cb(fresh()));return()=>{};},async queryPublicTournaments(){f.r1Reads++;return fresh();}};
  window.cloudAuth={isReady:()=>true,hasSuperAdmin:async()=>true,onAuthChange:()=>()=>{},signOutUser:async()=>{}};
  f.withdraw=()=>{f.cards=[B];f.version=2;f.hold=true;f.next({version:2,previous:null,fromCache:false,hasPendingWrites:false});};
 });
 await page.goto('/',{waitUntil:'load'});
 await page.waitForFunction(()=>typeof handleAction==='function'&&window.BXHHomepageR2?.enabled===true);
 await page.evaluate(()=>{lobbySectionExpanded={live:true,registration:true,waiting:true,settling:true,ended:true};handleAction('select-role-guest',{getAttribute:()=>null});});
 await expect(page.locator('[data-lobby-code="BXH-R2FIRST"]')).toBeVisible();
 await expect(page.locator('[data-lobby-code="BXH-R2SECOND"]')).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>r2OfficialFixture.requests.filter(q=>q.mode==='detail').length)).toBeGreaterThan(0);
 expect(await page.evaluate(()=>[r2OfficialFixture.r1Watches,r2OfficialFixture.r1Reads])).toEqual([0,0]);
 await page.evaluate(()=>r2OfficialFixture.withdraw());
 await expect(page.locator('[data-lobby-code="BXH-R2FIRST"]')).toHaveCount(0);
 await expect(page.getByText('正在確認最新賽事摘要……')).toBeVisible();
 await page.waitForFunction(()=>typeof r2OfficialFixture.release==='function');
 await page.evaluate(()=>{r2OfficialFixture.hold=false;r2OfficialFixture.release();});
 await expect(page.locator('[data-lobby-code="BXH-R2SECOND"]')).toBeVisible();
 await expect(page.locator('[data-lobby-code="BXH-R2FIRST"]')).toHaveCount(0);
 await page.locator('[data-action="homepage-r2-full-list"]').click();
 await expect(page.locator('[data-lobby-code="BXH-R1FULL"]')).toBeVisible();
 await expect(page.locator('[data-lobby-code="BXH-R2SECOND"]')).toHaveCount(0);
 expect(await page.evaluate(()=>r2OfficialFixture.stopped)).toBeGreaterThan(0);
 expect(errors).toEqual([]);
});
