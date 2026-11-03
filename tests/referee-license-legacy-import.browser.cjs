'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const {setup,hash}=require('./referee-license-legacy-fixture.cjs');
const root=path.resolve(__dirname,'..'),core=fs.readFileSync(path.join(root,'modules/referee-license/legacy-import.js'),'utf8');
const expected=require('../modules/referee-license/legacy-import.js').EXPECTED_SHA;
(async()=>{
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><main id="view"></main>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,...(fs.existsSync('/usr/bin/chromium')?{executablePath:'/usr/bin/chromium'}:{})});
 try{
  async function pageFor(x,mobile=false,call=x.call){
   const context=await browser.newContext(mobile?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{});
   const page=await context.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
   await page.exposeFunction('mockCall',call);await page.evaluate(owner=>{window.actor=owner;window.epoch=0;window.admin=true;window.BXH_REFEREE_CERTIFICATES_V1=true;window.engagementService={refereeLicense:window.mockCall};},x.owner);
   await page.addScriptTag({path:path.join(root,'modules/referee-license/domain.js')});
   const bytes=Buffer.from(JSON.stringify(x.plan));
   // Synthetic plan pin for this isolated test only. Production keeps the exact owner file SHA.
   await page.addScriptTag({content:core.replace(expected,hash(bytes))});
   await page.addScriptTag({path:path.join(root,'modules/referee-license/ui.js')});
   await page.evaluate(()=>{
    window.ctx=()=>({uid:actor,epoch,isSuperAdmin:admin,currentSession:()=>({uid:actor,epoch,isSuperAdmin:admin}),rerender:()=>draw()});
    window.draw=()=>document.querySelector('#view').innerHTML=BXHRefereeLicense.renderAdmin(ctx());
    document.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b)BXHRefereeLicense.handleAction(b.dataset.action,b,ctx());});draw();
   });
   return {page,context,bytes};
  }
  const x=setup(),{page,context,bytes}=await pageFor(x,true);
  assert.equal(await page.locator('[data-referee-legacy-import]').count(),1);
  await page.locator('[data-referee-legacy-file]').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{}')});
  await page.getByText('這不是本次核對完成的原始計畫，請選擇原本下載的 referee-backfill-plan.json。').waitFor();assert.equal(x.mutations(),0);
  await page.locator('[data-referee-legacy-file]').setInputFiles({name:'plan.json',mimeType:'application/json',buffer:bytes});
  await page.locator('[data-action="referee-license-legacy-run"]').waitFor();assert.equal(await page.locator('.rl-legacy-preview .rl-spread').count(),18);
  await page.locator('[data-action="referee-license-legacy-run"]').click();
  await page.locator('[data-action="referee-license-legacy-download"]').waitFor({timeout:30000});
  assert.match(await page.locator('[data-referee-legacy-import]').innerText(),/20批、1966場已回讀確認/);assert.equal(x.mutations(),20);
  await page.evaluate(()=>{BXHRefereeLicense.resetSession();epoch++;draw();});
  assert.equal(await page.locator('[data-action="referee-license-legacy-run"]').count(),0);assert.equal(await page.locator('[data-action="referee-license-legacy-download"]').count(),1);
  await page.evaluate(()=>{admin=false;epoch++;BXHRefereeLicense.resetSession();draw();});
  assert.equal(await page.locator('[data-referee-legacy-import]').count(),0);await context.close();
  const y=setup();let release,started;const pending=new Promise(r=>started=r),gate=new Promise(r=>release=r);
  const r=await pageFor(y,false,async d=>{const result=await y.call(d);if(d.action==='saveBackfill'){started();await gate;}return result;});
  await r.page.locator('[data-referee-legacy-file]').setInputFiles({name:'plan.json',mimeType:'application/json',buffer:r.bytes});
  await r.page.locator('[data-action="referee-license-legacy-run"]').click();await pending;
  await r.page.evaluate(()=>{actor='another-user';admin=false;epoch++;BXHRefereeLicense.resetSession();draw();});y.setActor('another-user');release();
  await r.page.waitForFunction(()=>Object.keys(localStorage).some(k=>k.startsWith('bxh-referee-legacy-apply-')&&JSON.parse(localStorage.getItem(k)).status==='outcome-unknown'));
  assert.equal(y.mutations(),1);assert.equal(await r.page.locator('[data-referee-legacy-import]').count(),0);await r.context.close();
  console.log('PASS mobile import preview, wrong file, 20 batches, persistent result, player exclusion, logout after commit stops without retry');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
