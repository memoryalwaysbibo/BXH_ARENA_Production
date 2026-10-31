'use strict';
const fs=require('node:fs'),http=require('node:http'),assert=require('node:assert/strict');const {chromium}=require('playwright');
(async()=>{
 const server=http.createServer((_,r)=>r.end('<!doctype html><meta charset="utf-8"><style>body{margin:12px}button{white-space:normal;max-width:100%}section{white-space:pre-wrap;overflow-wrap:anywhere}</style><main id="app"></main><p id="notice"></p>'));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});await page.goto('http://127.0.0.1:'+server.address().port);
  for(const path of ['admin-override.js','admin-checkin.js'])await page.addScriptTag({content:fs.readFileSync('modules/main-app/'+path,'utf8')});
  const core=fs.readFileSync('modules/main-app/core.js','utf8'),start=core.indexOf('// Admin attendance changes use'),end=core.indexOf('let bracketCommitContext=null;',start);assert(start>0&&end>start);
  await page.addScriptTag({content:`
   let state={id:'r',cloudCode:'BXH-TEST01',players:[{id:'p',name:'甲選手',checkedIn:false}],meta:{checkinClosedEarly:true}},userProfile={active:true,role:'admin'},uid='u',modal=null,calls=0,fail=false,records=0;
   const adminOverrideContext=()=>({actorUid:uid,roomId:state.id,code:state.cloudCode}),currentAuthUid=()=>uid;
   const canOfferAdminOperationalOverride=()=>BXHAdminOverride.allowed(userProfile)&&!state.startedAt,bracketCommitBlocked=()=>false;
   let adminOperationalOverrideBusy=false;const esc=x=>x;
   const serverState=structuredClone(state);
   window.cloudSync={adminOverrideCheckin:async d=>{calls++;if(!serverState.adminOperationOverrides?.some(r=>r.id===d.operationId)){serverState.players[0].checkedIn=d.checkedIn;serverState.adminOperationOverrides=[{id:d.operationId,actorUid:'u',playerId:'p',checkedIn:d.checkedIn}];}if(fail)throw Error('lost-ack');return {ok:true};},readBracketFromServer:async()=>fail?{ok:false}:{ok:true,data:structuredClone(serverState),publicData:{players:structuredClone(serverState.players)}}};
   async function saveRecord(){records++;}function showToast(s){document.querySelector('#notice').textContent=s;}function openModal(m){modal=m;render();}
   ${core.slice(start,end)}
   function render(){document.querySelector('#app').innerHTML=adminCheckinButtonHtml(state.players[0])+(modal?'<section role="dialog"><h2>'+modal.title+'</h2><p>'+modal.message+'</p><button id="confirm">'+modal.confirmLabel+'</button></section>':'');}
   document.addEventListener('click',e=>{if(e.target.dataset.action==='admin-force-checkin')offerAdminCheckin('p');if(e.target.id==='confirm'){const m=modal;modal=null;m.onConfirm();render();}});
   window.fixture={stats:()=>({calls,records,checked:state.players[0].checkedIn,audits:serverState.adminOperationOverrides?.length||0,busy:adminCheckinController().status().busy}),lose:()=>fail=true,restore:()=>fail=false,revoke:()=>{userProfile.role='staff';render();},admin:()=>{userProfile.role='super_admin';render();}};render();
  `});
  await page.getByRole('button',{name:'管理員強制報到',exact:true}).click();await page.getByRole('dialog').waitFor();assert.equal((await page.evaluate(()=>fixture.stats())).calls,0);
  await page.evaluate(()=>fixture.revoke());await page.getByRole('button',{name:'我已核對，強制執行'}).click();await page.waitForTimeout(50);assert.equal((await page.evaluate(()=>fixture.stats())).calls,0);assert.equal(await page.locator('[data-action="admin-force-checkin"]').count(),0);
  await page.evaluate(()=>fixture.admin());await page.getByRole('button',{name:'管理員強制報到',exact:true}).click();await page.evaluate(()=>fixture.lose());await page.getByRole('button',{name:'我已核對，強制執行'}).click();
  await page.waitForFunction(()=>fixture.stats().calls===1&&!fixture.stats().busy);await page.getByText('報到覆核尚未確認成功',{exact:false}).waitFor();assert.equal((await page.evaluate(()=>fixture.stats())).checked,false);
  await page.evaluate(()=>fixture.restore());await page.getByRole('button',{name:'核實／重試報到操作',exact:true}).click();await page.getByRole('heading',{name:'核實／重試同一筆報到'}).waitFor();await page.getByRole('button',{name:'我已核對，強制執行'}).click();
  await page.getByText('管理員報到覆核已完成，雲端名單與紀錄已確認',{exact:true}).waitFor();const stats=await page.evaluate(()=>fixture.stats());assert.equal(stats.checked,true);assert.equal(stats.audits,1);assert.equal(stats.records,1);await page.getByRole('button',{name:'管理員強制取消報到',exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  console.log('PASS actual admin check-in bridge: confirmation, revoked role, unknown acknowledgement, same operation retry, audit readback, mobile width');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
