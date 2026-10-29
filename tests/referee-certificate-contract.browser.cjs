'use strict';
// Real browser UI + real Callable service + in-memory transactional database.
// Every browser request is fulfilled from fixtures; no Firebase project or account is used.
const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os');
const repo=path.resolve(__dirname,'..');
const modulePaths=[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,repo,...(process.env.NODE_PATH||'').split(path.delimiter)].filter(Boolean);
const {chromium}=require(require.resolve('playwright',{paths:modulePaths}));
const {createService}=require(repo+'/referee-certificates/functions/service.cjs');
const {MockDB,fixture}=require(repo+'/referee-certificates/test/mock-db.cjs');
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jNf8AAAAASUVORK5CYII=','base64');
const db=new MockDB({...fixture(),...fixture({uid:'bob',code:'BXH-BBBB'})});
const handle=createService(db,{clock:Date.now}),calls=[];
let dropBackfillReply=true;
const seedFiles={'/domain.js':['modules/referee-license/domain.js','text/javascript'],'/ui.js':['modules/referee-license/ui.js','text/javascript'],'/styles.css':['modules/referee-license/styles.css','text/css'],'/fonts/bxh-kai-subset.ttf':['modules/referee-license/fonts/bxh-kai-subset.ttf','font/ttf']};
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BXH_TEST_BROWSER?{executablePath:process.env.BXH_TEST_BROWSER}:{})});
 try{
  const page=await browser.newPage({viewport:{width:390,height:960}}),errors=[];
  page.setDefaultTimeout(10000);
  page.on('pageerror',e=>errors.push(e.message));
  await page.exposeFunction('fixtureApi',async(payload,actorUid)=>{
   calls.push({actorUid,payload:structuredClone(payload)});
   const result=await handle({auth:{uid:actorUid},data:payload});
   if(payload.action==='saveBackfill'&&dropBackfillReply){dropBackfillReply=false;throw Error('simulated lost reply after server commit');}
   return result;
  });
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin!=='https://referee.fixture.test')return route.abort();
   if(seedFiles[url.pathname]){const [file,type]=seedFiles[url.pathname];return route.fulfill({contentType:type,body:fs.readFileSync(repo+'/'+file)});}
   if(url.pathname!=='/')return route.fulfill({status:404,body:''});
   return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"><style>body{margin:0;padding:16px;background:#151923;color:#eee}button,input,select,textarea{font:inherit}</style><main id="app"></main><script src="/domain.js"></script><script src="/ui.js"></script>'});
  });
  await page.goto('https://referee.fixture.test/');
  await page.evaluate(()=>{
   window.reviewState={uid:'admin',epoch:1,admin:true,view:'admin'};
   window.engagementService={refereeLicense:payload=>window.fixtureApi(payload,reviewState.uid)};
   window.reviewContext=()=>({uid:reviewState.uid,epoch:reviewState.epoch,user:{uid:reviewState.uid,active:true,role:reviewState.admin?'super_admin':'player'},isSuperAdmin:reviewState.admin,currentSession:()=>({uid:reviewState.uid,epoch:reviewState.epoch,isSuperAdmin:reviewState.admin}),rerender:()=>reviewRender(),onRefereeAchievements:()=>{reviewState.view='achievements';reviewRender();return true;}});
   window.reviewRender=()=>{document.querySelector('#app').innerHTML=BXHRefereeLicense[reviewState.view==='admin'?'renderAdmin':reviewState.view==='achievements'?'renderAchievements':'renderDuty'](reviewContext());};
   document.addEventListener('click',e=>{const target=e.target.closest('[data-action]');if(target)BXHRefereeLicense.handleAction(target.dataset.action,target,reviewContext());});
   reviewRender();
  });
  async function select(uid){
   await page.locator('[data-referee-query]').fill(uid);
   await page.locator('[data-referee-form="search"] button[type="submit"]').click();
   await page.locator('[data-action="referee-license-select"][data-uid="'+uid+'"]').click();
   await page.waitForFunction(uid=>document.querySelector('.rl-uid')?.textContent.includes(uid),uid);
  }
  async function success(text){await page.waitForFunction(text=>Array.from(document.querySelectorAll('.rl-success')).some(el=>el.textContent.includes(text)),text);}
  async function chief(){const d=page.locator('.rl-admin-role');if(await d.getAttribute('open')===null)await d.locator('summary').click();await d.locator('[data-action="referee-license-chief"]').click();await success('裁判長指定已更新');}
  await select('alice');
  assert.equal(db.read('refereeCertificates/alice').awardedLevel,1);
  await page.locator('[name="decisions"]').fill('199');
  await page.locator('[name="events"]').fill('3');
  await page.locator('[name="size"]').fill('148');
  await page.locator('[data-referee-form="backfill"] button[type="submit"]').click();
  await page.locator('[data-action="referee-license-retry"]').waitFor();
  assert.equal(db.list('refereeCertificates/alice/records').length,1);
  await page.locator('[data-action="referee-license-retry"]').click();await success('歷史回補已認列');
  const creates=calls.filter(x=>x.payload.action==='saveBackfill');assert.equal(creates.length,2);assert.equal(creates[0].payload.operationId,creates[1].payload.operationId);
  const snapshot=(await handle({auth:{uid:'admin'},data:{action:'get',targetUid:'alice'}})).snapshot;
  assert.equal(snapshot.stats.decisions,200);assert.equal(snapshot.stats.eventCount,4);assert.deepEqual(snapshot.stats.scales,{64:3,96:3,128:3});assert.equal(snapshot.stats.milestones[100],3);assert.equal(snapshot.stats.milestones[200],0);
  assert.equal(snapshot.certificate.awardedLevel,1);assert.equal(snapshot.eligibleLevel,5);
  await page.locator('[data-action="referee-license-grant"]').click();await success('正式階級已授予');assert.equal(db.read('refereeCertificates/alice').awardedLevel,5);
  await page.locator('[data-action="referee-license-revoke"]').click();await success('回補已撤銷');
  assert.equal(db.read('refereeCertificates/alice').awardedLevel,5);assert.ok((await page.locator('#app').innerText()).includes('既有授予仍保留'));
  await page.locator('[data-action="referee-license-restore"]').click();await success('回補已恢復');assert.equal(db.list('refereeCertificates/alice/records').length,1);
  const photo=page.locator('details').filter({has:page.locator('[data-referee-photo-input]')});await photo.locator('summary').click();
  await photo.locator('[data-referee-photo-input]').setInputFiles({name:'one.png',mimeType:'image/png',buffer:PNG});await page.locator('[data-action="referee-license-photo-save"]').waitFor();
  let current=(await handle({auth:{uid:'admin'},data:{action:'get',targetUid:'alice'}})).snapshot;
  await handle({auth:{uid:'admin'},data:{action:'photo',targetUid:'alice',dataUrl:'data:image/png;base64,'+PNG.toString('base64'),expectedRevision:current.revision,operationId:'external_photo_change'}});
  await page.locator('[data-action="referee-license-photo-save"]').click();await page.getByText('資料已更新。請核對最新累積或照片預覽，再重新送出；本次未自動重送。',{exact:true}).waitFor();
  await page.locator('[data-action="referee-license-refresh"]').first().click();
  await page.waitForFunction(()=>!document.querySelector('#app').textContent.includes('正在更新'));
  await page.locator('[data-action="referee-license-photo-save"]').click();await success('裁判照片已更新');assert.ok(db.read('refereeCertificates/alice').photoDataUrl.startsWith('data:image/jpeg;'));
  await chief();assert.equal(db.read('refereeCertificateSystem/chief').uid,'alice');
  await select('bob');await chief();assert.equal(db.read('refereeCertificateSystem/chief').uid,'bob');
  await select('alice');
  assert.equal(await page.locator('[data-action="referee-license-chief"]').textContent(),'指定為唯一裁判長');
  await page.evaluate(()=>{reviewState={uid:'alice',epoch:2,admin:false,view:'duty'};BXHRefereeLicense.resetSession();reviewRender();});
  await page.locator('.rl-certificate').waitFor();assert.ok((await page.locator('.rl-main-rank').innerText()).includes('白金裁判'));
  await page.locator('[data-action="referee-license-show-achievements"]').click();await page.locator('[data-referee-view="achievements"]').waitFor();assert.equal(await page.locator('.rl-achievement.is-unlocked').count(),1);
  await page.evaluate(()=>{reviewState.view='duty';reviewRender();});await page.locator('[data-referee-view="duty"]').waitFor();
  await page.setViewportSize({width:320,height:960});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:path.join(os.tmpdir(),'bxh-referee-contract-320.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS real UI → real service fixture: lost-reply receipt retry, 148 inclusive totals, manual grant, revoke/restore preserving award, photo revision recovery, chief cache handoff, player achievements and 320px layout.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
