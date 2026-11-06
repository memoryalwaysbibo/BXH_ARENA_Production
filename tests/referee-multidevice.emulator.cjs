'use strict';
// Full shipped frontend in 12 independent browser contexts; real Firestore
// transactions via the unchanged scoring service. Auth/callable transport is
// explicitly simulated with one fixed UID per page. Never production Firebase.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium,webkit,devices}=require('playwright');
const device=process.env.BXH_TEST_DEVICE||'desktop',mobile=device!=='desktop',activation=mobile?'tap':'click';
if(!['desktop','iphone','android'].includes(device))throw Error('Unknown BXH_TEST_DEVICE');
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {createScoringHandler}=require('../referee-seats/functions/scoring-service.cjs');
const C=require('../referee-seats/functions/core.cjs');
const root=path.resolve(process.env.BXH_TEST_REPO||'.'),code='BXH-DOM12',projectId='demo-bxh-dom12';
assert(/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''),'loopback emulator required');
const admin=initializeApp({projectId},'referee-dom12'),db=getFirestore(admin),score=createScoringHandler(db),pages=[],errors=[],results=[];
let browser,unsubscribe,delivery=Promise.resolve(),calls=0,hold=null,release=null;
const clone=x=>JSON.parse(JSON.stringify(x));
const model={version:1,revision:1,courts:{},requests:{}};
const players=Array.from({length:24},(_,i)=>({id:'p'+i,name:'Player '+i}));
for(let i=1;i<=12;i++)model.courts[i]={revision:1,main:{uid:'judge'+i,name:'Judge '+i},backup1:null,backup2:null};
const state={id:'dom12',cloudCode:code,createdBy:'host',meta:{name:'DOM 12 court lab',eventAuthority:'official',formatType:'roundrobin',ladderMode:'general',stations:12,scoringMode:'standard',refereeSeatsV1:model,assignedStaffUids:Array.from({length:12},(_,i)=>'judge'+(i+1)),...C.project(model,'host',12)},bracketSize:24,startedAt:1,players,updatedAt:1,matches:Array.from({length:12},(_,i)=>({id:'m'+(i+1),station:i+1,bracket:'RR',round:0,indexInRound:i,seq:i,a:{type:'player',playerId:'p'+i*2},b:{type:'player',playerId:'p'+(i*2+1)},scoreA:0,scoreB:0,log:[],faultActions:[],completed:false,status:'in_progress',refereeSeatScoreRevision:0})),courtAssignments:Object.fromEntries(Array.from({length:12},(_,i)=>['court'+(i+1),{currentMatchId:'m'+(i+1),queue:[]}]))};
async function read(){return JSON.parse((await db.doc('tournaments/'+code).get()).data().data);}
async function flush(){await delivery;const latest=await read();await Promise.all(pages.map(p=>p.waitForFunction(at=>state.updatedAt>=at,latest.updatedAt)));}
(async()=>{
 try{
 await Promise.all([db.doc('tournaments/'+code).set({createdBy:'host',eventAuthority:'official',assignedStaffUids:state.meta.assignedStaffUids,refereeSeatsV1:model,data:JSON.stringify(state),updatedAt:1}),db.doc('publicTournaments/'+code).set({visibility:'public',bracketView:JSON.stringify(state)}),db.doc('systemConfig/refereeSeatsV1').set({enabled:true,perCourtScoringVerified:true}),...state.meta.assignedStaffUids.map(uid=>db.doc('users/'+uid).set({active:true,role:'staff',realName:uid}))]);
 browser=await (device==='iphone'?webkit:chromium).launch({headless:true,...(device==='iphone'?{}:{executablePath:process.env.BXH_TEST_BROWSER})});
 for(let station=1;station<=12;station++){
  const uid='judge'+station,context=await browser.newContext({... (device==='iphone'?devices['iPhone 14']:device==='android'?devices['Pixel 7']:{viewport:{width:1280,height:900}}),serviceWorkers:'block'}),page=await context.newPage();pages.push(page);page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push({station,message:e.message}));
  await page.exposeFunction('__readRoom',read);
  await page.exposeFunction('__commit',async data=>{calls++;if(hold)await hold;try{return await score({auth:{uid},data});}catch(e){return {ok:false,reason:e.message};}});
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());if(u.origin!=='https://referee.fixture.test')return route.abort();
   if(u.pathname==='/modules/cloud/cloud-runtime.js')return route.fulfill({contentType:'text/javascript',body:'/* simulated transport; emulator service on driver */'});
   const file=path.resolve(root,'.'+(u.pathname==='/'?'/index.html':decodeURIComponent(u.pathname)));
   if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
   return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream'});
  });
  await page.addInitScript(()=>{
   window.cloudAuth={isReady:()=>true,hasSuperAdmin:async()=>true,onAuthChange:cb=>{window.__authCallback=cb;return ()=>{};},getUserProfile:async()=>null,touchLastLogin:()=>{}};
   window.cloudSync={isEnabled:()=>true,connect:async()=>true,queryPublicTournaments:async()=>[],subscribePublicTournaments:()=>()=>{},subscribeRefereeSeats:(code,cb)=>{window.__seatCallback=cb;return ()=>{};},joinRoom:async()=>({ok:true,data:await window.__readRoom()}),commitRefereeCommand:data=>window.__commit(data),pushUpdate:()=>{throw Error('unexpected whole-room write');}};
   window.engagementService={mailbox:async()=>({ok:true,messages:[],unreadCount:0}),mood:async()=>({ok:true,messages:[]}),familyRegistration:async()=>({ok:true,rows:[]})};
  });
  await page.goto('https://referee.fixture.test/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof window.__authCallback==='function').catch(async e=>{console.error('BOOT',await page.evaluate(()=>({phase:typeof appPhase,render:typeof render,ready:window.cloudAuth?.isReady(),callback:typeof window.__authCallback,body:document.body.textContent.slice(-350)})));throw e;});
  await page.evaluate(({initial,uid})=>{firebaseUser={uid,email:uid+'@example.invalid'};userProfile={uid,active:true,role:'staff',realName:uid};state=initial;currentRole='admin';appPhase='app';activeTab='referee';cloudStatus='connected';render();},{initial:clone(state),uid});
  await page.locator('#court-card-'+station+' [data-action="score"]').first().waitFor();
 }
 unsubscribe=db.doc('tournaments/'+code).onSnapshot(snapshot=>{const remote=JSON.parse(snapshot.data().data);delivery=delivery.then(()=>Promise.all(pages.map(p=>p.evaluate(remote=>applyRemoteState(remote),remote))));});
 await flush();
 const first=pages[0];await first.evaluate(()=>{window.__localCourt=document.getElementById('court-card-1');window.__localButton=__localCourt.querySelector('[data-action="score"]');window.__mutations=0;new MutationObserver(r=>__mutations+=r.length).observe(__localCourt,{subtree:true,childList:true,attributes:true,characterData:true});__localButton.focus();});
 for(let i=1;i<12;i++){await pages[i].locator('#court-card-'+(i+1)+' [data-action="score"][data-side="A"][data-type="spin"]')[activation]();await pages[i].waitForFunction(id=>getMatch(id).scoreA===1,'m'+(i+1));}
 await flush();
 const unchanged=await first.evaluate(()=>({same:__localCourt===document.getElementById('court-card-1'),mutations:__mutations,focus:document.activeElement===__localButton}));results.push({scenario:'11 other devices commit via real transactions',...unchanged});
 if(process.env.BXH_EXPECT_STABLE!=='0'){assert.equal(unchanged.same,true);assert.equal(unchanged.mutations,0);assert.equal(unchanged.focus,true);}
 // Hold the callable response and double activate: the production busy guard
 // must submit exactly once, even with DOM nodes retained.
 hold=new Promise(r=>release=r);const before=calls;
 const doubleTarget=first.locator('#court-card-1 [data-action="score"][data-side="A"][data-type="spin"]');
 if(mobile){await doubleTarget.scrollIntoViewIfNeeded();const box=await doubleTarget.boundingBox();await first.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);await first.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);}else await doubleTarget.click({clickCount:2});
 assert.equal(calls,before+1);release();hold=null;await first.waitForFunction(()=>getMatch('m1').scoreA===1);await flush();
 await first.locator('#court-card-1 [data-action="undo-score"]')[activation]();await first.waitForFunction(()=>getMatch('m1').scoreA===0);await flush();
 assert((await read()).matches.slice(1).every(m=>m.scoreA===1));results.push({scenario:'local double click and undo',passed:true});
 // Real connection gate: no transaction is allowed while offline.
 await first.context().setOffline(true);const offlineCalls=calls;
 await first.locator('#court-card-1 [data-action="score"][data-side="A"][data-type="spin"]')[activation]();assert.equal(calls,offlineCalls);
 await first.context().setOffline(false);await first.evaluate(()=>{cloudStatus='connected';render();});
 // View switching uses the actual routed action, followed by another score.
 await first.locator('[data-action="switch-tab"][data-tab="live"]')[activation]();await first.locator('[data-action="switch-tab"][data-tab="referee"]')[activation]();
 await first.locator('#court-card-1 [data-action="score"][data-side="A"][data-type="spin"]')[activation]();await first.waitForFunction(()=>getMatch('m1').scoreA===1);await flush();
 // A real, unsent result confirmation survives other-court transactions.
 await first.locator('#court-card-1 [data-action="score"][data-side="A"][data-type="extreme"]')[activation]();
 await first.locator('#modal-confirm-btn').waitFor();await first.evaluate(()=>{window.__pendingConfirm=document.getElementById('modal-confirm-btn');});
 await Promise.all([pages[1].locator('#court-card-2 [data-action="score"][data-side="B"][data-type="spin"]')[activation](),pages[2].locator('#court-card-3 [data-action="score"][data-side="B"][data-type="spin"]')[activation]()]);
 await pages[1].waitForFunction(()=>getMatch('m2').scoreB===1);await pages[2].waitForFunction(()=>getMatch('m3').scoreB===1);await flush();
 if(process.env.BXH_EXPECT_STABLE!=='0')assert.equal(await first.evaluate(()=>document.getElementById('modal-confirm-btn')===__pendingConfirm),true);
 assert.equal(await first.evaluate(()=>pendingModal.matchId),'m1');
 await first.locator('#modal-cancel-btn')[activation]();
 assert.equal((await read()).matches[0].completed,false);results.push({scenario:'concurrent two-court transactions retain unsent result confirmation',passed:true});
 // Revocation is committed on the authoritative room and pushed to every page.
 const remote=await read(),revoked=clone(model);revoked.revision++;revoked.courts[1].revision++;revoked.courts[1].main=null;remote.meta={...remote.meta,refereeSeatsV1:revoked,...C.project(revoked,'host',12)};remote.updatedAt=Date.now();
 await db.doc('tournaments/'+code).update({refereeSeatsV1:revoked,data:JSON.stringify(remote),updatedAt:remote.updatedAt});await flush();
 assert.equal(await first.locator('#court-card-1 [data-action="score"]').first().isDisabled(),true);
 assert.equal(await first.locator('#court-card-1 [data-action="confirm-result"]').isDisabled(),true);
 const denied=await score({auth:{uid:'judge1'},data:{code,operationId:'revoked-operation-1234',action:'score',station:1,matchId:'m1'}}).then(()=>false,e=>e.message==='station-not-assigned');assert(denied);results.push({scenario:'offline/recovery, tab switch, authoritative seat revocation',passed:true});
 assert.deepEqual(errors,[]);const layout=await first.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth}));if(mobile)assert(layout.width<=layout.viewport,'referee screen must not overflow horizontally');const report={root,device,layout,results,calls,errors};const out=path.resolve(process.env.BXH_TEST_OUTPUT||'test-results/referee-multidevice');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));await first.screenshot({path:path.join(out,'referee-after-revocation.png')});console.log(JSON.stringify(report,null,2));
 }finally{unsubscribe?.();await delivery.catch(()=>{});if(browser)await browser.close();await deleteApp(admin);}
})().catch(e=>{console.error(e);console.error(JSON.stringify({results,errors}));process.exitCode=1;});
