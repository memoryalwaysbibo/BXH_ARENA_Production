'use strict';
const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');
const {chromium,expect:baseExpect}=require('@playwright/test');
const expect=baseExpect.configure({timeout:15000});
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');
const {getFirestore}=require('firebase-admin/firestore');
const {createServer}=require('../frontend/serve.cjs');
const {assertIsolated,PROJECT}=require('./preflight.cjs');
assertIsolated(process.env);
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8180'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9098')throw Error('emulators-required');
let app,auth,db,browser,server,contexts=[];
const roles={'ui-a':'staff','ui-b':'staff','ui-witness':'staff','ui-admin':'admin','ui-outsider':'staff'};
async function clear(){const r=await fetch('http://127.0.0.1:8180/emulator/v1/projects/'+PROJECT+'/databases/(default)/documents',{method:'DELETE'});assert.equal(r.ok,true);}
before(async()=>{
  process.env.METADATA_SERVER_DETECTION='none';app=initializeApp({projectId:PROJECT},'hc-browser-test');auth=getAuth(app);db=getFirestore(app);
  for(const uid of Object.keys(roles))await auth.createUser({uid,email:uid+'@hc-test.invalid',password:'sandbox-browser-123'});
  server=createServer();await new Promise(r=>server.listen(5199,'127.0.0.1',r));
  browser=await chromium.launch({headless:true});
});
beforeEach(async()=>{
  for(const context of contexts)await context.close();contexts=[];
  await clear();await db.doc('hcConfig/runtime').set({enabled:true,environment:'sandbox'});
  for(const [uid,role]of Object.entries(roles))await db.doc('hcActors/'+uid).set({role,active:true});
  await db.doc('hcChallenges/ui-c1').set({challengeId:'ui-c1',environment:'sandbox',status:'in_progress',revision:0,
    participants:['ui-a','ui-b'],verificationActorUid:'ui-witness',riskReviewerUid:'ui-admin',settlementActorUid:'ui-admin',privateNote:'must-not-expose'});
  await db.doc('users/ui-a').set({lifetime:444});
});
after(async()=>{
  for(const c of contexts)await c.close();if(browser)await browser.close();
  if(server)await new Promise(r=>server.close(r));if(db){await clear();await db.terminate();}if(app)await deleteApp(app);
});
async function pageFor(uid){
  const context=await browser.newContext({viewport:{width:390,height:844}});contexts.push(context);
  const page=await context.newPage();await page.goto('http://127.0.0.1:5199');
  await page.getByLabel('電子郵件').fill(uid+'@hc-test.invalid');await page.getByLabel('密碼',{exact:true}).fill('sandbox-browser-123');
  await page.getByRole('button',{name:'登入',exact:true}).click();await expect(page.getByRole('status')).toContainText('登入成功');
  assert.equal(await page.getByLabel('密碼',{exact:true}).inputValue(),'');
  await page.getByLabel('挑戰編號').fill('ui-c1');await page.getByRole('button',{name:'讀取最新狀態'}).click();
  return page;
}
async function refresh(page){await page.getByRole('button',{name:'讀取最新狀態'}).click();await expect(page.getByRole('status')).toHaveText('已讀取最新狀態。');}
async function action(page,name){page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name,exact:true}).click();await expect(page.getByRole('status')).toHaveText('操作已完成，已讀取最新狀態。',{timeout:15000});}
async function prepare(){
  const participant=await pageFor('ui-a');await expect(participant.locator('#summary')).toContainText('進行中');
  await action(participant,'提交結果');
  const witness=await pageFor('ui-witness');await expect(witness.locator('#summary')).toContainText('結果已提交');
  await action(witness,'開始認證');await action(witness,'確認結果');
  const admin=await pageFor('ui-admin');await expect(admin.locator('#summary')).toContainText('已認證');
  await expect(admin.getByRole('button',{name:'執行結算'})).toBeDisabled();
  await admin.getByLabel('審查理由').fill('Browser checked score and witness');await action(admin,'放行風險');
  return {participant,witness,admin};
}
test('mobile browser completes participant, witness and admin workflow with one settlement',async()=>{
  const {participant,witness,admin}=await prepare();
  await action(admin,'執行結算');await expect(admin.locator('#summary')).toContainText('已結算');
  await expect(admin.getByRole('button',{name:'執行結算'})).toBeDisabled();
  await refresh(participant);await refresh(witness);
  assert.equal((await db.collection('hcSettlementLedger').get()).size,1);
  assert.equal((await db.collection('hcAuditEvents').get()).size,4);
  assert.deepEqual((await db.doc('users/ui-a').get()).data(),{lifetime:444});
  assert.equal(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(await admin.evaluate(()=>localStorage.length+sessionStorage.length),0);
  await admin.screenshot({path:'/tmp/hc00-internal-ui-mobile.png',fullPage:true});
});
test('lost settlement response can replay original request without duplicate effects',async()=>{
  const {admin}=await prepare();let lost=false;
  await admin.route('**/hcSandboxCommand',async route=>{
    const body=route.request().postDataJSON();
    if(body.data.operation==='settle'&&!lost){lost=true;await route.fetch();await route.abort();}
    else await route.continue();
  });
  admin.once('dialog',dialog=>dialog.accept());await admin.getByRole('button',{name:'執行結算'}).click();
  await expect(admin.getByRole('status')).toContainText('操作結果尚未確認',{timeout:15000});
  await refresh(admin);await expect(admin.locator('#summary')).toContainText('已結算');
  await admin.getByRole('button',{name:'重送上一筆操作'}).click();
  await expect(admin.getByRole('status')).toHaveText('操作已完成，已讀取最新狀態。',{timeout:15000});
  assert.equal((await db.collection('hcSettlementLedger').get()).size,1);
  const stats=(await db.collection('hcSandboxStats').get()).docs.map(d=>d.data());stats.forEach(s=>assert.equal(s.matches,1));
});
test('browser confirms cancellation, rejects unrelated account and closes revoked role',async()=>{
  const page=await pageFor('ui-a');await expect(page.locator('#summary')).toContainText('進行中');
  page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'提交結果',exact:true}).click();
  assert.equal((await db.collection('hcResults').get()).size,0);
  await expect(page.getByRole('button',{name:'確認結果',exact:true})).toBeDisabled();
  const outsider=await pageFor('ui-outsider');await expect(outsider.getByRole('status')).toContainText('沒有操作');
  await expect(outsider.getByRole('button',{name:'提交結果',exact:true})).toBeDisabled();
  await db.doc('hcActors/ui-a').update({active:false});
  page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'提交結果',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('沒有操作');
  await expect(page.getByRole('button',{name:'提交結果',exact:true})).toBeDisabled();
  assert.equal((await db.collection('hcRequests').get()).size,0);
});
test('read projection omits private fields; stale browser cannot overwrite another submission',async()=>{
  const first=await pageFor('ui-a'),second=await pageFor('ui-b');await expect(second.locator('#summary')).toContainText('進行中');
  await action(first,'提交結果');
  second.once('dialog',dialog=>dialog.accept());await second.getByRole('button',{name:'提交結果',exact:true}).click();
  await expect(second.getByRole('status')).toContainText('已有新版本');
  await expect(second.getByRole('button',{name:'提交結果',exact:true})).toBeDisabled();
  const responsePromise=second.waitForResponse(r=>r.url().endsWith('/hcSandboxCommand'));
  await refresh(second);const body=await (await responsePromise).json();
  assert.equal(JSON.stringify(body).includes('privateNote'),false);
  assert.equal((await db.collection('hcResults').get()).size,1);
});
test('acknowledged settlement with failed status refresh asks to reload without resubmitting',async()=>{
  const {admin}=await prepare();let lost=false;
  await admin.route('**/hcSandboxCommand',async route=>{
    if(route.request().postDataJSON().data.operation==='getChallenge'&&!lost){lost=true;await route.abort();}
    else await route.continue();
  });
  admin.once('dialog',dialog=>dialog.accept());await admin.getByRole('button',{name:'執行結算'}).click();
  await expect(admin.getByRole('status')).toContainText('操作已確認，但讀取最新狀態失敗',{timeout:15000});
  await expect(admin.getByRole('button',{name:'重送上一筆操作'})).toBeHidden();
  await refresh(admin);await expect(admin.locator('#summary')).toContainText('已結算');
  assert.equal((await db.collection('hcSettlementLedger').get()).size,1);
});
