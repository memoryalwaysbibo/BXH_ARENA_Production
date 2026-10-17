'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const runtime=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
const {chromium}=require(runtime?runtime+'/playwright':'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox']});
 const core=fs.readFileSync(process.env.ROSTER_CORE_PATH||__dirname+'/../modules/main-app/core.js','utf8');
 const start=core.indexOf('function renderPeopleManagement(){'),end=core.indexOf('\nfunction renderBxhEventTemplateSettingsSection',start);
 assert.ok(start>=0&&end>start);const renderPeople=core.slice(start,end);
 const module=fs.readFileSync(__dirname+'/../modules/main-app/roster-view.js','utf8');
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.setContent('<!doctype html><meta charset="utf-8"><style>input,select{max-width:100%;box-sizing:border-box}.people-col-source{display:none}table{width:100%}</style><div id="app"></div>');
 await page.addScriptTag({content:module});
 await page.addScriptTag({content:`
 window.state={id:'local',cloudCode:'BXH-TEST12',meta:{checkinRequired:true,registrationCapacity:160},players:[{id:'xie',name:'謝一',checkedIn:false},{id:'wang',name:'王一',checkedIn:false},{id:'chen',name:'陳一',checkedIn:true}]};
 let firebaseUser={uid:'manager'},peopleRosterSection='pending',peopleRosterBusy=false,adminRosterCode='BXH-TEST12',adminRegistrationsError='',adminRegistrationsCache=[],adminRegistrationsLoading=false;
 const onlineRows=[{registrationId:'online-wait',displayName:'謝候補'}],localRows=[{id:'local-wait',name:'王候補',source:'manual'}];
 function bracketCommitStatusHtml(){return '';}function bracketCommitBlocked(){return false;}
 function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
 function peopleRosterMutationLocked(){return false}function peopleRegistrationSelectionManaged(){return false}function canManageRegistrationRoster(){return true}function isCommunityQuickRegistration(){return false}
 function peopleOnlineWaitlistRows(){return onlineRows}function peopleRegistrationIdOf(r){return r.registrationId}function peopleLocalWaitlist(){return localRows}function peopleWaitlistShadow(){return null}
 function participantDisplayName(p){return p.name}function peopleOnsiteWaitlistAvailable(){return false}function peopleOnsiteWaitlistManaged(){return false}
 function renderStaffAssignmentPanel(){return ''}function renderRefereeStationAssignmentPanel(){return ''}function entryRosterValid(){return true}function renderEntrySelection(){return ''}
 const BATTLE_MODE_LABELS={},FORMAT_LABELS={};
 ${renderPeople}
 function renderPreservingScroll(){document.querySelector('#app').innerHTML=renderPeopleManagement();}
 renderPreservingScroll();
 `});
 const names=()=>page.locator('tbody tr:visible .people-col-name').allTextContents();
 assert.deepEqual((await names()).map(s=>s.trim()),['謝一','王一']);
 const original=await page.evaluate(()=>JSON.stringify(state));
 await page.getByLabel('名單排序',{exact:true}).selectOption('stroke');
 assert.deepEqual((await names()).map(s=>s.trim()),['王一','謝一']);
 assert.match(await page.locator('tbody tr:visible').first().innerText(),/02/);
 assert.equal(await page.locator('tbody tr:visible').first().locator('[data-action="toggle-checkin-btn"]').getAttribute('data-id'),'wang');
 await page.getByLabel('姓名搜尋',{exact:true}).fill('謝');
 assert.deepEqual((await names()).map(s=>s.trim()),['謝一']);
 await page.getByLabel('姓名搜尋',{exact:true}).fill('沒有人');
 await page.getByText('找不到符合姓名的選手',{exact:true}).waitFor({state:'visible'});
 await page.getByRole('button',{name:'清除搜尋',exact:true}).click();
 assert.equal((await names()).length,2);
 await page.evaluate(()=>{peopleRosterSection='confirmed';renderPreservingScroll();});
 await page.getByLabel('姓名搜尋',{exact:true}).fill('陳');assert.deepEqual((await names()).map(s=>s.trim()),['陳一']);
 await page.evaluate(()=>{peopleRosterSection='waitlist';renderPreservingScroll();});
 await page.getByRole('button',{name:'清除搜尋',exact:true}).click();
 assert.deepEqual((await names()).map(s=>s.trim()),['王候補','謝候補']);
 const local=page.locator('tbody tr:visible').first();assert.match(await local.innerText(),/備02/);
 assert.equal(await local.locator('[data-action="people-promote-waitlist"]').getAttribute('data-local-id'),'local-wait');
 await page.getByLabel('名單排序',{exact:true}).selectOption('original');assert.deepEqual((await names()).map(s=>s.trim()),['謝候補','王候補']);
 await page.getByLabel('姓名搜尋',{exact:true}).fill('謝');
 await page.evaluate(()=>{state.cloudCode='BXH-OTHER1';renderPreservingScroll();});
 assert.equal(await page.getByLabel('姓名搜尋',{exact:true}).inputValue(),'');assert.equal(await page.getByLabel('名單排序',{exact:true}).inputValue(),'original');
 assert.equal(await page.evaluate(()=>{const copy=JSON.parse(JSON.stringify(state));copy.cloudCode='BXH-TEST12';return JSON.stringify(copy)}),original);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
 await browser.close();console.log('PASS actual personnel renderer: pending, confirmed, mixed waitlist, IDs/ranks, search, reset and mobile width');
})().catch(e=>{console.error(e);process.exit(1)});
