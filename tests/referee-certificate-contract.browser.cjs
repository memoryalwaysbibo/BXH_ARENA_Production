'use strict';
// Actual browser + actual service, all data mocked locally. Every network route is intercepted.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'..');
const {chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||repo]}));
const {createService}=require('../referee-certificates/functions/service.cjs');
const {MockDB,fixture}=require('../referee-certificates/test/mock-db.cjs');
const db=new MockDB({...fixture(),'refereeCertificateSystem/numbering':{lastIssuedNumber:18}}),handle=createService(db),calls=[];
let drop=true;
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.BXH_TEST_BROWSER,args:['--no-sandbox']});
 try{
  const page=await browser.newPage({viewport:{width:390,height:900}});page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.exposeFunction('fixtureApi',async(data,uid)=>{calls.push({uid,data});const r=await handle({auth:{uid},data});if(data.action==='grant'&&drop){drop=false;throw Error('lost response after approval commit');}return r;});
  await page.route('**/*',route=>{
   const url=new URL(route.request().url());if(url.origin!=='https://cert.fixture.test')return route.abort();
   if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><main id="app"></main><link rel="stylesheet" href="/styles.css"><script src="/domain.js"></script><script src="/ui.js"></script>'});
   const names={'/domain.js':'domain.js','/ui.js':'ui.js','/styles.css':'styles.css'};
   return names[url.pathname]?route.fulfill({contentType:url.pathname.endsWith('.css')?'text/css':'text/javascript',body:fs.readFileSync(repo+'/modules/referee-license/'+names[url.pathname])}):route.fulfill({status:404,body:''});
  });
  await page.goto('https://cert.fixture.test/');
  await page.evaluate(()=>{
   window.actor='admin';window.view='admin';window.epoch=1;
   window.engagementService={refereeLicense:data=>fixtureApi(data,actor)};
   window.ctx=()=>({uid:actor,epoch,isSuperAdmin:actor==='admin',currentSession:()=>({uid:actor,epoch,isSuperAdmin:actor==='admin'}),rerender:()=>draw()});
   window.draw=()=>document.querySelector('#app').innerHTML=BXHRefereeLicense[view==='admin'?'renderAdmin':'renderDuty'](ctx());
   document.addEventListener('click',e=>{const el=e.target.closest('[data-action]');if(el)BXHRefereeLicense.handleAction(el.dataset.action,el,ctx());});draw();
  });
  await page.locator('[data-referee-query]').fill('alice');await page.locator('[data-referee-form="search"] button').click();await page.locator('[data-action="referee-license-select"]').click();
  await page.locator('[data-referee-approval="personId"]').waitFor();assert.equal(db.read('refereeCertificates/alice'),undefined);
  await page.locator('[data-referee-approval="personId"]').fill('person-alice');await page.locator('[data-referee-approval="basis"]').fill('explicitly verified same natural person');
  await page.locator('[data-action="referee-license-grant"]').click();await page.locator('[data-action="referee-license-retry"]').waitFor();
  assert.equal(db.read('refereeCertificates/alice').number,'R000019');assert.equal(db.read('refereeCertificates/alice').awardedLevel,1);
  await page.locator('[data-action="referee-license-retry"]').click();await page.locator('.rl-success').waitFor();
  assert.equal(db.list('refereeCertificates/alice/audit').length,1);const grants=calls.filter(x=>x.data.action==='grant');assert.equal(grants[0].data.operationId,grants[1].data.operationId);
  await page.locator('[name="sourceKey"]').fill('match:BXH-AAAA:m0');await page.locator('[name="basis"]').fill('verified responsible referee, not merely the operator');await page.locator('[data-referee-form="backfill"] button[type="submit"]').click();
  await page.waitForFunction(()=>document.querySelector('.rl-admin-totals')?.textContent.replace(/\s/g,'').includes('判決1'));
  assert.equal((await handle({auth:{uid:'alice'},data:{action:'get'}})).snapshot.stats.decisions,1);
  await page.locator('[data-referee-approval="basis"]').fill('qualification paused');await page.locator('[data-action="referee-license-qualification"]').click();
  await page.getByRole('button',{name:'恢復資格',exact:true}).waitFor();assert.equal(db.read('refereeCertificates/alice').qualificationStatus,'disabled');
  await page.locator('[data-referee-approval="basis"]').fill('qualification restored');await page.getByRole('button',{name:'恢復資格',exact:true}).click();await page.getByRole('button',{name:'停用資格',exact:true}).waitFor();
  assert.equal(db.read('refereeCertificates/alice').number,'R000019');assert.equal(db.read('users/alice').role,'player');
  await page.evaluate(()=>{actor='alice';epoch++;view='duty';draw();});await page.locator('.rl-certificate').waitFor();assert.equal(await page.locator('[data-action="referee-license-grant"]').count(),0);
  assert.deepEqual(errors,[]);console.log('PASS actual browser/service: pure get, zero-experience L1 explicit approval, lost reply retry, recognition, disable/restore, unchanged role, private duty');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
