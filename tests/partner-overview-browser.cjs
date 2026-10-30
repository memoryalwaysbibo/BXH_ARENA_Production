'use strict';
// Isolated browser acceptance: real overview/management renderer and production
// CSS, synthetic contracts only; every browser network request is aborted.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium,expect}=require('@playwright/test');
const root=path.resolve(__dirname,'..');
const output=path.join(root,'test-results/partner-overview');
fs.mkdirSync(output,{recursive:true});
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const css=[...index.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"?]+)[^"]*"/g)]
  .map(m=>m[1]).filter(p=>!/^https?:|^\/\//.test(p)&&fs.existsSync(path.join(root,p)))
  .map(p=>fs.readFileSync(path.join(root,p),'utf8')).join('\n');
const core=fs.readFileSync(path.join(root,'modules/main-app/core.js'),'utf8');
const start=core.indexOf('function renderTournamentManagementTab(){');
const end=core.indexOf('function renderAdminTournamentListModal(){',start);
assert(start>=0&&end>start,'real management renderer not found');
const renderSource=core.slice(start,end);
const results=[];

async function mount(page){
  await page.route('**/*',route=>route.abort());
  await page.setContent('<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>活動主辦介面驗收（示範資料）</title><body><div id="app"><main><p class="hint">活動主辦介面驗收 · 以下均為示範資料</p><div id="surface"></div></main></div></body></html>');
  await page.addStyleTag({content:css});
  await page.evaluate(()=>{
    window.actor='host';window.activeMode='partner_organizer';
    window.userProfile={active:true,role:'player',partnerOrganizer:{status:'active',scope:'contract',organizationId:'demo-org',organizationName:'測試廠商',planCode:'A1',orderCode:'DEMO-CONTRACT-001',startsAtMs:Date.now()-86400000,expiresAtMs:Date.now()+30*86400000}};
    window.currentAuthUid=()=>window.actor;
    window.partnerOrganizerGrant=()=>window.activeMode==='partner_organizer'?window.BXHPartnerOrganizer?.grant(window.userProfile):null;
    window.isPartnerOrganizerMode=()=>!!window.partnerOrganizerGrant();
    window.hasAdminAccess=()=>true;window.isAdminTierOrAbove=()=>false;window.canCreateOfficialTournament=()=>true;
    window.firebaseUser={uid:'host'};window.state={};
    window.adminTournamentListLoaded=true;window.adminTournamentListBusy=false;window.adminTournamentListError='';window.adminTournamentListFilter='all';window.adminTournamentListItems=[];
    window.esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    window.registrationStatusLabel=()=>'';
    window.mock={calls:0,used:2,fail:false,pending:false};
    window.engagementService={getPartnerContract:async()=>{
      window.mock.calls++;
      if(window.mock.pending)return new Promise(resolve=>window.mock.resolveOld=resolve);
      if(window.mock.fail)throw Error('permission-denied');
      return {orderCode:'DEMO-CONTRACT-001',targetUid:'host',status:'active',includedEvents:10,usedEvents:window.mock.used,organizationName:'測試廠商',planCode:'A1',terms:'示範合約條款：合作期間內共十場。\n<script>window.unsafeContract=true</script>\n此為驗收資料，並非正式合約。'};
    }};
  });
  await page.addScriptTag({path:path.join(root,'partner-organizer-ui.js')});
  await page.addScriptTag({content:renderSource+'\nwindow.render=()=>{document.querySelector("#surface").innerHTML=renderTournamentManagementTab();};window.render();'});
}
async function snapshot(page,name){
  await page.screenshot({path:path.join(output,name+'.png'),fullPage:true});
}
async function testViewport(browser,width){
  const page=await browser.newPage({viewport:{width,height:900}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  try{
    await mount(page);
    const panel=page.getByRole('region',{name:'我的合作方案'});
    await expect(panel.getByText('8 場',{exact:true})).toBeVisible();
    assert.equal(await page.evaluate(()=>window.mock.calls),1);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'horizontal overflow at '+width);
    await snapshot(page,'contract-'+width);
    await panel.getByRole('button',{name:'查看合約',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'我的合作合約'});
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('<script>window.unsafeContract=true</script>');
    assert.equal(await page.evaluate(()=>window.unsafeContract),undefined);
    assert.equal(await dialog.locator('input,textarea,script').count(),0);
    const box=await dialog.boundingBox();assert(box.x>=0&&box.x+box.width<=width+1,'dialog overflows at '+width);
    await snapshot(page,'contract-dialog-'+width);
    await page.keyboard.press('Tab');await expect(dialog.getByRole('button',{name:'關閉'})).toBeFocused();
    await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
    await page.evaluate(()=>{window.mock.used=3;window.dispatchEvent(new Event('bxh-partner-room-created'));});
    await expect(panel.getByText('7 場',{exact:true})).toBeVisible();
    await page.evaluate(()=>window.mock.fail=true);
    await panel.getByRole('button',{name:'重新整理場次'}).click();
    await expect(panel.getByText(/目前無法讀取合作合約/)).toBeVisible();
    await expect(panel.getByRole('button',{name:'查看合約',exact:true})).toBeDisabled();
    assert.equal(await page.evaluate(()=>window.BXHPartnerOrganizer.remainingRooms('DEMO-CONTRACT-001')),null);
    await snapshot(page,'read-error-'+width);
    await page.evaluate(()=>window.mock.fail=false);
    await panel.getByRole('button',{name:'重新整理場次'}).click();await expect(panel.getByText('7 場',{exact:true})).toBeVisible();
    await page.evaluate(()=>{window.mock.used=10;});await panel.getByRole('button',{name:'重新整理場次'}).click();
    await expect(panel.getByText('場次已用完',{exact:true})).toBeVisible();await expect(panel.getByText('0 場',{exact:true})).toBeVisible();
    await snapshot(page,'exhausted-'+width);
    await page.evaluate(()=>{window.userProfile.partnerOrganizer.scope='manual';delete window.userProfile.partnerOrganizer.orderCode;window.render();});
    await expect(panel.getByText('手動授權',{exact:true})).toBeVisible();await expect(panel.getByText(/場次額度未設定/)).toBeVisible();
    await expect(panel.getByRole('button',{name:'查看合約',exact:true})).toHaveCount(0);
    await snapshot(page,'manual-'+width);
    // A previous account's delayed contract may not appear after a mode change.
    await page.evaluate(()=>{window.userProfile.partnerOrganizer.scope='contract';window.userProfile.partnerOrganizer.orderCode='DEMO-CONTRACT-001';window.mock.pending=true;window.render();});
    await page.waitForFunction(()=>typeof window.mock.resolveOld==='function');
    await page.evaluate(()=>{window.activeMode='player';window.render();window.mock.resolveOld({orderCode:'DEMO-CONTRACT-001',targetUid:'host',status:'active',includedEvents:999,usedEvents:0});});
    await expect(panel).toHaveCount(0);assert.equal(await page.getByText('999 場',{exact:true}).count(),0);
    assert.deepEqual(errors,[]);results.push({viewport:width,status:'passed'});
  }catch(error){await snapshot(page,'failure-'+width);throw error;}
  finally{await page.close();}
}
(async()=>{
  const browser=await chromium.launch({headless:true});
  try{for(const width of [1440,390,360,320])await testViewport(browser,width);}
  finally{await browser.close();fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));}
  console.log('PASS partner overview browser acceptance:',results.map(x=>x.viewport).join(', '));
})().catch(error=>{console.error(error);process.exitCode=1;});
