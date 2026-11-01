'use strict';
// Real browser + shipped feedback, cloud join method and family chooser.
// All service traffic terminates in this synthetic HTTP fixture, never Firebase.
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..'),read=name=>fs.readFileSync(path.join(root,name),'utf8');
const cloud=read('modules/cloud/cloud-runtime.js'),family=read('family-ui.js');
function helper(name){const start=cloud.indexOf('  function '+name+'('),end=cloud.indexOf('\n  }',start);assert(start>=0&&end>start);return cloud.slice(start,end+4);}
function method(name){const start=cloud.indexOf('    async '+name+'('),end=cloud.indexOf('\n    },',start);assert(start>=0&&end>start);return cloud.slice(start,end+6);}
const chooser=family.slice(family.indexOf('async function chooseFamilyParticipant('),family.indexOf('// v13.40.0',family.indexOf('async function chooseFamilyParticipant(')));
let browser;
before(async()=>{browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});});
after(async()=>{await browser?.close();});
async function fixture(t,options={}){
 const context=await browser.newContext({viewport:options.mobile?{width:390,height:844}:{width:1280,height:800},isMobile:!!options.mobile,deviceScaleFactor:1});
 t.after(()=>context.close());const page=await context.newPage(),errors=[],server={joins:[],reads:0,rows:[],mode:options.mode||'hold',hold:[],committed:new Map()};page.on('pageerror',e=>errors.push(e.message));
 const script=`
 let playerRegistrationFeedback=null,authReady=true,engagementSessionEpoch=1;
 const fixturePageId=crypto.randomUUID();
 let firebaseUser={uid:new URL(location.href).searchParams.get('account')||'user1'};
 const authHandle={currentUser:firebaseUser},fx={doc:()=>null,getDoc:async()=>({exists:()=>true,data:()=>({battleMode:'individual'})})},dbHandle={};
 const currentAuthUid=()=>firebaseUser.uid,userProfile={displayName:'測試玩家'},esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const originalCreate=BXHRegistrationFeedback.create;
 BXHRegistrationFeedback.create=options=>originalCreate({...options,slowMs:600,deadlineMs:1500,readTimeoutMs:250,delays:[3000]});
 window.engagementService={
   family:async()=>({ok:true,profiles:[{id:'child1',name:'測試兒童'}]}),
   familyRegistration:async request=>{
     if(request.action==='preview')return {ok:true,rows:request.childIds.map(id=>({participantName:id||'本人',status:'confirmed'})),allocation:request.childIds.map(id=>({registrationId:id===null?firebaseUser.uid:'family_'+id,status:'confirmed'}))};
     const response=await fetch('/fixture/'+(request.action==='mine'?'mine':'join'),{method:'POST',headers:{'Content-Type':'application/json','X-Fixture-Page':fixturePageId},body:JSON.stringify({...request,fixtureUid:firebaseUser.uid})});
     return response.json();
   }
 };
 ${helper('getPlayerRegistrationFeedback')}
 ${helper('runMyEventsPlayerOperation')}
 ${chooser}
 window.cloudSync={${method('joinTournamentAsPlayer')}, restoreRegistrationFeedback(){getPlayerRegistrationFeedback()?.restore();}};
 window.submissions=[];window.failures=[];
 for(const id of ['lobby','detail','children'])document.getElementById(id).onclick=()=>cloudSync.joinTournamentAsPlayer('BXH-FEED01',true,id==='children'?'children':'self').then(r=>submissions.push(r)).catch(e=>failures.push(e.message));
 cloudSync.restoreRegistrationFeedback();
 `;
 const font=process.env.FEEDBACK_FONT_CSS?fs.readFileSync(process.env.FEEDBACK_FONT_CSS,'utf8'):'';
 const html='<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+font+read('modules/main-app/registration-feedback.css')+read('raffle-claims.css')+'</style><body><h1>報名隔離內測</h1><button id="lobby">大廳報名</button><button id="detail">詳情報名</button><button id="children">替兒童報名</button><script>'+read('modules/main-app/registration-feedback.js')+'</script><script>'+script+'</script></body></html>';
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1')return route.abort();
  if(url.pathname==='/fixture/join'){
   const req=route.request().postDataJSON();server.joins.push(req);
   if(server.mode==='hold'){server.hold.push(route);return;}
   if(server.mode==='empty-drop')return route.abort();
   const ids=req.childIds.map(id=>id===null?req.fixtureUid:'family_'+id);
   if(!server.committed.has(req.operationId)){server.committed.set(req.operationId,true);server.rows=ids.map(registrationId=>({registrationId,status:options.status||'confirmed'}));}
   if(server.mode==='commit-drop')return route.abort();
   return route.fulfill({json:{ok:true,status:options.status||'confirmed',rows:server.rows}});
  }
  if(url.pathname==='/fixture/mine'){server.reads++;if(route.request().headers()['x-fixture-page']===server.ignoreReadsFrom)return route.abort();const req=route.request().postDataJSON();return route.fulfill({json:{ok:true,rows:req.fixtureUid==='user1'?server.rows:[]}});}
  return route.fulfill({contentType:'text/html',body:html});
 });
 await page.goto('http://127.0.0.1:4289/');
 assert.deepEqual(errors,[],'Fixture and shipped scripts must parse without runtime errors');
 t.after(()=>assert.deepEqual(errors,[]));return {page,server,context};
}
async function waitFor(page,fn){await page.waitForFunction(fn,null,{timeout:10000});}
test('desktop lobby and detail clicks coalesce and pending feedback is immediately visible',async t=>{
 const {page,server}=await fixture(t);await page.evaluate(()=>{for(let i=0;i<100;i++)document.getElementById(i%2?'lobby':'detail').click();});
 await waitFor(page,()=>document.querySelector('.registration-feedback-panel')?.textContent.includes('報名送出中'));assert.equal(server.joins.length,1);
 server.rows=[{registrationId:'user1',status:'confirmed'}];await page.getByRole('button',{name:'查詢報名結果'}).click();await waitFor(page,()=>submissions.length===100);
 assert.equal(server.joins.length,1);assert.match(await page.locator('.registration-feedback-panel').innerText(),/正取/);
});
test('a dropped successful HTTP response recovers automatically without a second write',async t=>{
 const {page,server}=await fixture(t,{mode:'commit-drop'});await page.click('#lobby');await waitFor(page,()=>submissions.length===1);
 assert.equal(server.joins.length,1);assert.equal(server.committed.size,1);assert(server.reads>=1);assert.equal(await page.evaluate(()=>submissions[0].recovered),true);
});
test('reload restores a pending request and only reads the result',async t=>{
 const {page,server}=await fixture(t);await page.click('#lobby');await waitFor(page,()=>localStorage.length===1);server.ignoreReadsFrom=await page.evaluate(()=>fixturePageId);server.rows=[{registrationId:'user1',status:'waitlist'}];await page.reload();
 await waitFor(page,()=>document.querySelector('.registration-feedback-panel')?.textContent.includes('備取'));assert.equal(server.joins.length,1);assert.equal(await page.evaluate(()=>localStorage.length),0);
});
test('unconfirmed request can resend its exact original operation, including after reload',async t=>{
 const {page,server}=await fixture(t,{mode:'empty-drop'});await page.click('#detail');await waitFor(page,()=>failures.length===1);assert.equal(server.joins.length,1);
 await page.reload();await waitFor(page,()=>document.querySelector('.registration-feedback-panel')?.textContent.includes('重送原報名'));
 server.mode='commit';await page.getByRole('button',{name:'重送原報名',exact:true}).click();await waitFor(page,()=>document.querySelector('.registration-feedback-panel')?.textContent.includes('狀態已確認'));
 assert.equal(server.joins.length,2);assert.equal(server.joins[0].operationId,server.joins[1].operationId);assert.deepEqual(server.joins[0],server.joins[1]);assert.equal(server.committed.size,1);
});
test('mobile panel stays inside the viewport and presents uncertainty without claiming failure',async t=>{
 const {page}=await fixture(t,{mobile:true,mode:'empty-drop'});await page.click('#lobby');await waitFor(page,()=>failures.length===1);
 const panel=page.locator('.registration-feedback-panel');assert.match(await panel.innerText(),/結果尚未確認/);const box=await panel.boundingBox();assert(box.x>=0&&box.x+box.width<=390&&box.y>=0&&box.y+box.height<=844);
 if(process.env.FEEDBACK_SCREENSHOT){await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:process.env.FEEDBACK_SCREENSHOT});}
});
test('another account cannot restore or read the previous account pending submission',async t=>{
 const {page,server}=await fixture(t);await page.click('#lobby');await waitFor(page,()=>localStorage.length===1);await page.goto('http://127.0.0.1:4289/?account=user2');
 assert.equal(await page.locator('.registration-feedback-panel').isVisible(),false);assert.equal(server.reads,0);assert.equal(server.joins.length,1);
});
test('actual family selection tracks the selected child rather than the parent',async t=>{
 const {page,server}=await fixture(t,{mode:'commit',status:'waitlist'});await page.click('#children');await page.locator('dialog input[value="child1"]').check();await page.locator('dialog').getByRole('button',{name:'報名',exact:true}).click();await waitFor(page,()=>submissions.length===1);
 assert.deepEqual(server.joins[0].childIds,['child1']);assert.deepEqual(server.rows,[{registrationId:'family_child1',status:'waitlist'}]);assert.match(await page.locator('.registration-feedback-panel').innerText(),/備取/);
});
