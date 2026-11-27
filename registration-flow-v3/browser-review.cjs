'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright');
const source=fs.readFileSync('modules/main-app/core.js','utf8');
function slice(start,end){
 const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert(a>=0&&b>a);return source.slice(a,b);
}
const panel=slice('let v3ReviewPage=null','function renderAdminRegistrationsTab(){');
const handler=slice('  if(["v3-review-refresh"','  if(action==="load-admin-registrations"){');
(async()=>{
 const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.route('**/*',r=>r.abort());
 await page.setContent('<main id="root"></main>');
 page.setDefaultTimeout(5000);
 await page.addScriptTag({content:`
 const state={cloudCode:'BXH-SYNTH1',registrationFlowVersion:3};
 const currentAuthUid=()=> 'manager',engagementSessionEpoch=1,staffRosterReadOnly=()=>false;
 const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
 const mapRegistrationError=e=>e.message,showToast=()=>{};
 let calls=[],rows=[{uid:'u1',attemptId:'attempt1',sequence:1,displayName:'選手一'},{uid:'u2',attemptId:'attempt2',sequence:2,displayName:'選手二'}],confirmed=0;
 window.engagementService={registrationV3Operation:async p=>{
  calls.push(p);
  if(p.action==='approve'||p.action==='reject'){rows=rows.filter(r=>r.uid!==p.registrationId);if(p.action==='approve')confirmed++;return {ok:true};}
  if(p.action==='syncSummary')return {ok:true};
  return {ok:true,rows:[...rows],summary:{confirmedCount:confirmed,pendingReviewCount:rows.length,availableCount:4-confirmed-rows.length},nextSequence:null};
 }};
 ${panel}
 function render(){document.getElementById('root').innerHTML=renderV3ReviewPanel();}
 function handleAction(action,target){${handler}}
 document.addEventListener('click',e=>{const target=e.target.closest('[data-action]');if(target)handleAction(target.dataset.action,target);});
 window.calls=calls;render();
 `});
 await page.getByRole('button',{name:'讀取待審核'}).click();
 await page.getByText('選手一').waitFor({state:'attached'});await page.getByText('選手二').waitFor({state:'attached'});
 await page.getByRole('button',{name:'通過',exact:true}).first().click();
 await page.getByText('正式正取 1').waitFor({state:'attached'});
 await page.getByRole('button',{name:'不通過',exact:true}).click();
 await page.getByText('目前沒有待審核名單。').waitFor({state:'attached'});
 await page.getByRole('button',{name:'同步正式名單與摘要'}).click();
 await page.waitForFunction(()=>window.calls.some(c=>c.action==='syncSummary'));
 const calls=await page.evaluate(()=>window.calls);
 assert.deepEqual(calls.filter(c=>['approve','reject'].includes(c.action)).map(c=>[c.action,c.registrationId,c.expectedAttemptId]),[['approve','u1','attempt1'],['reject','u2','attempt2']]);
 console.log('PASS V3 mobile browser review panel, approval, rejection and manual sync (mocked callable)');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
