'use strict';
// Real browser UI -> actual Callable handler; serialized in-memory transactions.
// This checks UI/handler composition, not production Auth/App Check or SDK contention.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'.']}));
const {communityFixture}=require('../referee-seats/test-harness.cjs');
const root=path.join(__dirname,'..');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
 try{
 for(const width of [320,390,1440]){
  const h=communityFixture();h.advance(Date.now()-1000);h.docs.get('users/host').role='super_admin';
  for(const uid of ['main','backup'])Object.assign(h.docs.get('users/'+uid),{realName:'同名玩家',gameId:'玩家-'+uid});
  await h.run('host','enable');
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.fulfill({body:'<!doctype html><meta charset="utf-8"><div id="app"></div>',contentType:'text/html'}));
  await page.goto('https://arena.test/');
  await page.exposeFunction('invoke',async(uid,data)=>{try{return {result:await h.handle({auth:{uid},data}),state:JSON.parse(h.doc().data)};}catch(e){return {result:{ok:false,reason:e.message},state:JSON.parse(h.doc().data)};}});
  await page.addStyleTag({content:fs.readFileSync(path.join(root,'modules/main-app/referee-seats.css'),'utf8')});
  for(const name of ['hunter-clash/arena/vendor/qrcode.min.js','modules/main-app/community-referee-invite.js','modules/main-app/referee-seats.js'])await page.addScriptTag({content:fs.readFileSync(path.join(root,name),'utf8')});
  await page.evaluate(st=>{
   window.state=st;window.actor='host';window.toasts=[];window.opens=[];window.qrUrls=[];
   window.cloudSync={manageRefereeSeats:async data=>{const r=await invoke(actor,data);state=r.state;return r.result;}};
   window.render=()=>{
    BXHCommunityRefereeInvite.bind({state:()=>state,uid:()=>actor,inviter:()=>actor==='host',render,toast:m=>toasts.push(m),qr:(id,url,size)=>{qrUrls.push(url);new QRCode(document.getElementById(id),{text:url,width:size,height:size});},open:async(code,station)=>{opens.push({code,station});render();}});
    BXHRefereeSeats.bind({state:()=>state,uid:()=>actor,eligible:()=>true,operator:()=>false,inviter:()=>actor==='host',manager:()=>actor==='host',render,toast:m=>toasts.push(m)});
    document.getElementById('app').innerHTML=BXHCommunityRefereeInvite.renderEntry()||BXHRefereeSeats.render(state,1);
   };render();
  },JSON.parse(h.doc().data));
  const click=action=>page.locator('[data-ref-invite="'+action+'"]').click();
  await page.locator('[data-slot="main"]').click();
  assert(await page.getByRole('button',{name:'名字邀請',exact:true}).isVisible());assert(await page.getByRole('button',{name:'顯示 QR 邀請',exact:true}).isVisible());
  await click('name');await page.locator('#ref-invite-name').fill('同名玩家');await click('search');
  await page.getByRole('button',{name:'同名玩家｜玩家-main',exact:true}).waitFor();
  assert.equal(await page.locator('[data-ref-invite="choose"]').count(),2);
  await page.getByRole('button',{name:'同名玩家｜玩家-main',exact:true}).click();await click('invite');
  await page.waitForFunction(()=>toasts.length>0);assert([...h.docs.keys()].some(k=>k.startsWith('users/main/communityRefereeInbox/')));
  await page.locator('[data-slot="backup1"]').click();await click('qr');
  await page.locator('#ref-invite-qr canvas').waitFor({state:'attached'});
  const url=await page.evaluate(()=>qrUrls.at(-1));assert(url.includes('#referee='));assert(!url.split('#')[0].includes('token='));
  assert(await page.evaluate(()=>document.querySelector('.ref-seat-dialog').scrollWidth<=document.querySelector('.ref-seat-dialog').clientWidth));
  await click('close');
  await page.evaluate(url=>{actor='backup';render();BXHCommunityRefereeInvite.acceptUrl(url);},url);
  await click('inspect');await page.getByRole('button',{name:'確認加入',exact:true}).waitFor();
  assert.equal(h.doc().refereeSeatsV1.courts[1].backup1,null,'preview must not claim');
  assert(await page.getByText('BXH-TEST｜1 號台｜備用裁判 1',{exact:true}).isVisible());
  await click('accept');await page.waitForFunction(()=>opens.length===1);
  assert.equal(h.doc().refereeSeatsV1.courts[1].backup1.uid,'backup');
  // A QR for an ended event has only the result message and confirmation.
  const q=await h.run('host','create-qr',{station:2,slot:'main',expectedCourtRevision:0});h.doc().tournamentPhase='done';
  const finished='https://arena.test/#'+new URLSearchParams({referee:'BXH-TEST',invite:q.requestId,token:q.qrToken});
  await page.evaluate(url=>BXHCommunityRefereeInvite.acceptUrl(url),finished);await click('inspect');await page.getByText('比賽已有結果',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-ref-invite="accept"]').count(),0);await page.getByRole('button',{name:'確認',exact:true}).click();
  assert.equal(await page.evaluate(()=>BXHCommunityRefereeInvite.parseUrl('https://evil.test/#referee=BXH-TEST&invite=x&token='+'X'.repeat(43))),null);
  assert.deepEqual(errors,[]);console.log('PASS name/QR/confirmation/finished at '+width+'px');await page.close();
 }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
