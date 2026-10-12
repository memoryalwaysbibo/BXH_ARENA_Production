'use strict';
const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const {root,source}=require('../fixtures/auto-fill-ui.cjs');
const styles=['modules/main-css/core-competition.css','modules/main-css/auth-player.css','modules/main-css/lobby-community.css','modules/main-css/call-admin-tail.css','modules/mobile-overrides/styles.css'].map(file=>fs.readFileSync(path.join(root,file),'utf8')).join('\n');
// Production render functions; all services and identities are synthetic.
// Every external request is blocked, including Firebase and production assets.
async function setup(page){
 await page.route('**/*',route=>route.abort());
 await page.setContent('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div class="btn-row"><button id="view-registrations">報名管理</button><button id="view-people">人員管理</button></div><main id="app"></main>');
 await page.addStyleTag({content:styles});
 await page.addScriptTag({content:source+`
  window.fixture.errors=[];window.addEventListener('error',event=>fixture.errors.push(event.message));
  document.addEventListener('click',event=>{const target=event.target.closest('[data-action]');if(target&&!target.disabled)handleAction(target.dataset.action,target);});
  document.getElementById('view-registrations').onclick=()=>fixture.setView('registrations');
  document.getElementById('view-people').onclick=()=>fixture.setView('people');
  render();
 `});
}
const toggle=page=>page.getByRole('switch',{name:'自動補位',exact:true});
test.beforeEach(async({page})=>setup(page));
test.afterEach(async({page})=>expect(await page.evaluate(()=>fixture.errors)).toEqual([]));

test('shared switch is visible before waitlist on desktop and mobile, outside card controls',async({page})=>{
 await expect(toggle(page)).toBeVisible();await expect(toggle(page)).toHaveAttribute('aria-checked','false');
 expect(await page.evaluate(()=>fixture.calls.length)).toBe(0);
 expect(await toggle(page).evaluate(el=>!!el.closest('details,summary'))).toBe(false);
 expect(await page.locator('button button').count()).toBe(0);
 const box=await toggle(page).boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(page.viewportSize().width+1);
 const overflow=await page.evaluate(()=>Math.max(document.body.scrollWidth,document.documentElement.scrollWidth)-innerWidth);expect(overflow).toBeLessThanOrEqual(4);
 if(page.viewportSize().width<=760){await page.locator('.registration-mobile-card summary').first().click();await expect(page.locator('.registration-mobile-card').first()).toHaveAttribute('open','');await expect(toggle(page)).toBeVisible();}
 await page.locator('#view-people').click();await expect(toggle(page)).toHaveCount(1);await expect(toggle(page)).toHaveAttribute('aria-checked','false');expect(await page.evaluate(()=>fixture.calls.length)).toBe(0);
});
test('explicit click saves once, shows saving without optimistic toggle and updates both views',async({page})=>{
 await page.evaluate(()=>fixture.hold=true);await toggle(page).evaluate(el=>{el.click();el.click();});
 await expect(toggle(page)).toBeDisabled();await expect(toggle(page)).toContainText('儲存中');await expect(toggle(page)).toHaveAttribute('aria-checked','false');expect(await page.evaluate(()=>fixture.calls.length)).toBe(1);
 await expect(page.locator('[data-action="admin-promote-waitlist"]')).toBeDisabled();await expect(page.locator('[data-action="admin-cancel-registration"]').first()).toBeDisabled();
 await page.locator('#view-people').click();await expect(toggle(page)).toContainText('儲存中');await page.evaluate(()=>fixture.resolve());
 await expect(toggle(page)).toBeEnabled();await expect(toggle(page)).toHaveAttribute('aria-checked','true');await expect(page.getByRole('status')).toContainText('已開啟');
 await page.locator('#view-registrations').click();await expect(toggle(page)).toHaveAttribute('aria-checked','true');expect(await page.evaluate(()=>adminRegistrationsCache.map(row=>row.status))).toEqual(['waitlist','waitlist']);
 await page.evaluate(()=>fixture.hold=false);await toggle(page).click();await expect(toggle(page)).toHaveAttribute('aria-checked','false');expect(await page.evaluate(()=>fixture.calls.map(call=>call.enabled))).toEqual([true,false]);
});
test('rejected save keeps committed state and exposes retry without changing the list',async({page})=>{
 await page.evaluate(()=>{state.meta.registrationAutoFillEnabled=true;fixture.fail=true;render();});await toggle(page).click();
 await expect(page.getByRole('status')).toContainText('設定尚未確認');await expect(toggle(page)).toHaveAttribute('aria-checked','true');await expect(toggle(page)).toBeEnabled();expect(await page.evaluate(()=>fixture.records.length)).toBe(0);
 expect(await page.evaluate(()=>adminRegistrationsCache.map(row=>row.registrationId))).toEqual(['first','second']);
 await page.evaluate(()=>fixture.fail=false);await toggle(page).click();await expect(toggle(page)).toHaveAttribute('aria-checked','false');await expect(page.getByRole('status')).toContainText('已關閉');
});
test('room and authentication changes do not apply delayed configure responses',async({page})=>{
 for(const change of ['room','auth']){
  await page.evaluate(change=>{fixture.hold=true;fixture.view='registrations';fixture.testChange=change;render();},change);await toggle(page).click();
  await page.evaluate(()=>{if(fixture.testChange==='room')fixture.setRoom();else firebaseUser={uid:'other-admin'};fixture.resolve(fixture.pending.length-1);});
  await expect(toggle(page)).toBeEnabled();await expect(toggle(page)).toHaveAttribute('aria-checked','false');expect(await page.evaluate(()=>fixture.records.length)).toBe(0);expect(await page.evaluate(()=>fixture.toasts.length)).toBe(0);
 }
});
test('frozen and unauthorized users cannot call configure; assigned staff can',async({page})=>{
 for(const change of [{accountStatus:'frozen'},{role:'player'},{role:'staff'}]){
  await page.evaluate(change=>{userProfile={role:'admin',active:true,...change};render();},change);await expect(toggle(page)).toBeDisabled();await page.evaluate(()=>peopleToggleAutoFill());expect(await page.evaluate(()=>fixture.calls.length)).toBe(0);
 }
 await page.evaluate(()=>{state.assignedStaffUids=[firebaseUser.uid];render();});await expect(toggle(page)).toBeEnabled();
});
test('onsite active hides control and finalized ownership leaves it disabled',async({page})=>{
 await page.evaluate(()=>{state.meta.registrationOnsiteWaitlistEnabled=true;render();});await expect(toggle(page)).toHaveCount(0);
 await page.locator('#view-people').click();await expect(toggle(page)).toHaveCount(0);
 await page.evaluate(()=>{state.onsiteWaitlistFinalized=true;state.onsiteWaitlistServerOwned=true;render();});await expect(toggle(page)).toBeDisabled();await expect(page.locator('.registration-auto-fill-control')).toContainText('無法切換自動補位');
 await page.locator('#view-registrations').click();await expect(toggle(page)).toBeDisabled();expect(await page.evaluate(()=>fixture.calls.length)).toBe(0);
});
test('team, allocation, started and bracket states retain the disabled shared control',async({page})=>{
 for(const mode of ['team','allocation','started','bracket']){
  await page.evaluate(mode=>{state.meta.battleMode=mode==='team'?'team':'individual';state.entrySelection=mode==='allocation'?{mode:'registration',status:'pending',capacity:32}:null;state.startedAt=mode==='started'?1:null;state.bracketSize=mode==='bracket'?32:0;render();},mode);
  await expect(toggle(page)).toBeVisible();await expect(toggle(page)).toBeDisabled();
 }
 expect(await page.evaluate(()=>fixture.calls.length)).toBe(0);
});
