'use strict';
/* Real-browser, same-origin, read-only QA. Browser launch is a release gate;
 * a restricted local executor may not run this suite. The root CI container
 * uses the same launcher convention as the existing public catalog suite. */
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const os=require('node:os');
const {chromium}=require('playwright');
const {RUNTIME_FILES}=require('../scripts/package-bey-catalog-public.cjs');
const model=require('../modules/bey-catalog/catalog-pending-model.js');
const candidatePolicy=require('../modules/bey-catalog/catalog-candidate-policy.js');
const candidateCount=JSON.parse(fs.readFileSync(path.resolve(__dirname,'..',candidatePolicy.dataURL),'utf8')).entries.length;
const ROOT=path.resolve(__dirname,'..');
const output=path.resolve(process.env.PUBLIC_CATALOG_QA_OUTPUT_DIR||path.join(os.tmpdir(),'bxh-pending-browser'));
const allowed=new Set(RUNTIME_FILES.map(f=>'/'+f));
const dataPath='/'+model.DATA_URL.replace(/^\.\//,'');
let browser,server,base,mode='valid',pendingRequests=0;
const report={scope:'Isolated pending inventory browser QA; no authentication or production writes',status:'not_run',cases:[]};
function save(){fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'pending-browser-qa-report.json'),JSON.stringify(report,null,2)+'\n');}
before(async()=>{
 save();
 try {
  const executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),args:['--no-sandbox']});
  server=http.createServer((req,res)=>{
   const pathname=new URL(req.url,'http://127.0.0.1').pathname;
   if(req.method!=='GET'||!allowed.has(pathname)){res.writeHead(404).end();return;}
   res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
   res.setHeader('Content-Type',pathname.endsWith('.html')?'text/html; charset=utf-8':pathname.endsWith('.css')?'text/css':pathname.endsWith('.js')?'text/javascript':pathname.endsWith('.json')?'application/json':'image/webp');
   if(pathname===dataPath){pendingRequests++;if(mode==='error'){res.writeHead(503).end();return;}if(mode==='stale'){res.end('{}');return;}}
   res.end(fs.readFileSync(path.join(ROOT,pathname)));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
  report.status='running';report.browser=browser.version();save();
 }catch(error){report.status='blocked';report.reason=String(error);save();throw error;}
});
after(async()=>{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));if(report.status==='running')report.status=report.cases.every(c=>c.status==='passed')?'passed':'failed';save();});
async function scenario(name,fn,viewport={width:1280,height:900}){
 const context=await browser.newContext({viewport});const page=await context.newPage();const errors=[];mode='valid';pendingRequests=0;
 await context.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
 page.on('pageerror',error=>errors.push(String(error)));
 try{await fn(page);assert.deepEqual(errors,[]);report.cases.push({name,status:'passed'});}catch(error){report.cases.push({name,status:'failed',reason:String(error)});throw error;}finally{await context.close();save();}
}
const ready=page=>page.locator('#pending-panel[data-state="ready"]').waitFor();
test('direct pending link, exact counts, seven series and labeled candidate pictures',()=>scenario('direct link and counts',async page=>{
 await page.goto(base+'/bey-catalog.html?view=pending');await ready(page);
 assert.equal(await page.locator('.pending-card').count(),285);assert.equal(await page.locator('#verified-panel').isVisible(),false);
 assert.match(await page.locator('#pending-panel').innerText(),/使用者提供清單，尚未核實/);
 assert.match(await page.locator('.pending-unresolved').innerText(),/BXA-/);await page.waitForFunction(()=>document.getElementById('candidate-status').textContent.startsWith('已配'));assert.equal(await page.locator('.pending-card img').count(),candidateCount);assert.equal(await page.locator('.pending-card .manual-image-handoff').count(),await page.locator('.pending-card').count());
 assert.equal(await page.locator('.pending-card button').filter({hasText:/核實|錯誤/}).count(),0);
 for(const [series,count] of Object.entries(model.SERIES_COUNTS)){await page.selectOption('#pending-series',series);assert.equal(await page.locator('.pending-card').count(),count);}
 await page.screenshot({path:path.join(output,'pending-desktop.png'),fullPage:false});
}));
test('duplicate package codes retain separate stable rows and search configuration',()=>scenario('search and duplicates',async page=>{
 await page.goto(base+'/bey-catalog.html?view=pending');await ready(page);
 for(const code of ['BXA-03','BXA-04','BXA-05']){await page.fill('#pending-search',code);assert.equal(await page.locator('.pending-card').count(),2);const ids=await page.locator('.pending-card').evaluateAll(cards=>cards.map(c=>c.dataset.suppliedId));assert.equal(new Set(ids).size,2);}
 await page.fill('#pending-search','3-60F');assert.ok(await page.locator('.pending-card').count()>0);
 await page.fill('#pending-search','<img src=x onerror=alert(1)>');assert.equal(await page.locator('.pending-card').count(),0);assert.match(await page.locator('#pending-results').innerText(),/沒有符合/);
 await page.click('#pending-reset');assert.equal(await page.locator('.pending-card').count(),285);assert.equal(await page.locator('#pending-search').evaluate(e=>document.activeElement===e),true);
}));
test('repeated views and Back/Forward preserve filters without refetch or verified data changes',()=>scenario('history and separation',async page=>{
 await page.goto(base+'/bey-catalog.html');await page.locator('body[data-catalog-state="ready"]').waitFor();assert.equal(pendingRequests,0);
 await page.click('[data-catalog-view="pending"]');await ready(page);await page.fill('#pending-search','BXA-03');
 await page.click('[data-catalog-view="verified"]');assert.equal(await page.locator('#catalog-product-count').innerText(),'9');assert.equal(await page.locator('#catalog-part-count').innerText(),'47');
 await page.goBack();assert.equal(await page.locator('#pending-panel').isVisible(),true);assert.equal(await page.locator('.pending-card').count(),2);
 await page.goForward();assert.equal(await page.locator('#verified-panel').isVisible(),true);await page.click('[data-catalog-view="pending"]');assert.equal(pendingRequests,1);
}));
test('network and stale snapshot failures are visible, isolated and recoverable',()=>scenario('failure retry',async page=>{
 mode='error';await page.goto(base+'/bey-catalog.html?view=pending');await page.locator('#pending-panel[data-state="error"]').waitFor();assert.equal(await page.locator('.pending-card').count(),0);
 mode='stale';await page.click('#pending-retry');await page.locator('#pending-panel[data-state="error"]').waitFor();assert.equal(await page.locator('.pending-card').count(),0);
 mode='valid';await page.click('#pending-retry');await ready(page);assert.equal(await page.locator('.pending-card').count(),285);
}));
for(const width of [320,375,390])test('mobile '+width+'px is readable and keyboard controls remain accessible',()=>scenario('mobile '+width,async page=>{
 await page.goto(base+'/bey-catalog.html?view=pending');await ready(page);await page.selectOption('#pending-series','BXA');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
 await page.locator('#pending-reset').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('.pending-card').count(),285);
 await page.fill('#pending-search','BXA-03');await page.screenshot({path:path.join(output,'pending-mobile-'+width+'.png'),fullPage:true});
},{width,height:844}));
test('candidate tamper isolates images and retry preserves current search',()=>scenario('candidate tamper and retry',async page=>{
 const pattern='**/'+candidatePolicy.dataURL.replace(/^\.\//,'');let broken=true;
 await page.route(pattern,route=>broken?route.fulfill({status:200,contentType:'application/json',body:'{}'}):route.continue());
 await page.goto(base+'/bey-catalog.html?view=pending');await ready(page);
 await page.waitForFunction(()=>document.getElementById('candidate-status').textContent.includes('暫時無法'));
 assert.equal(await page.locator('.pending-card').count(),285);assert.equal(await page.locator('.pending-card img').count(),0);
 await page.fill('#pending-search','BX-01');broken=false;await page.click('#candidate-retry');
 await page.waitForFunction(()=>document.getElementById('candidate-status').textContent.startsWith('已配'));
 assert.equal(await page.locator('.pending-card').count(),1);assert.equal(await page.locator('.pending-card img').count(),1);
}));
test('failed candidate image remains explicitly unverified',()=>scenario('candidate image failure',async page=>{
 await page.route('**/assets/bey-catalog/candidates/*',route=>route.fulfill({status:404,body:''}));
 await page.goto(base+'/bey-catalog.html?view=pending');await ready(page);
 await page.waitForFunction(()=>document.getElementById('candidate-status').textContent.startsWith('已配'));
 await page.fill('#pending-search','BX-01');await page.locator('.candidate-image img[hidden]').waitFor({state:'attached'});
 assert.match(await page.locator('.candidate-image figcaption').innerText(),/載入失敗/);
 assert.equal(await page.locator('.pending-card .manual-image-handoff').count(),await page.locator('.pending-card').count());
 assert.equal(await page.locator('.pending-card button').filter({hasText:/核實|錯誤/}).count(),0);
}));

test('product reference never claims the supplied custom assembly is confirmed',()=>scenario('product reference wording',async page=>{
 await page.goto(base+'/bey-catalog.html?view=pending');await ready(page);
 await page.waitForFunction(()=>document.getElementById('candidate-status').textContent.startsWith('已配'));
 for(const code of ['UX-10-02','UX-10-03']){
  await page.fill('#pending-search',code);assert.equal(await page.locator('.pending-card').count(),1);
  assert.equal(await page.locator('.candidate-image figcaption').innerText(),'同商品參考圖，尚未確認本款配置');
 }
}));
for(const width of [1280,375])test('loaded candidate cards fit '+width+'px and produce bounded visual evidence',()=>scenario('candidate visual evidence '+width,async page=>{
 await page.goto(base+'/bey-catalog.html?view=pending');await ready(page);
 await page.waitForFunction(()=>document.getElementById('candidate-status').textContent.startsWith('已配'));
 for(const [code,label] of [['BX-01','exact'],['UX-10-02','reference']]){
  await page.fill('#pending-search',code);const figure=page.locator('.candidate-image');
  await figure.scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>{const img=document.querySelector('.pending-card img');return img&&img.complete&&img.naturalWidth>0;});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  assert.equal(await page.locator('.pending-card img').getAttribute('loading'),'lazy');
  await page.screenshot({path:path.join(output,'candidate-'+label+'-'+width+'.png'),fullPage:false});
 }
},{width,height:900}));
test('manual image handoff is keyboard-accessible, row-specific and has clipboard-denial fallback',()=>scenario('manual image handoff fallback',async page=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('clipboard denied');}}}));
 const writes=[];page.on('request',r=>{if(r.method()!=='GET')writes.push(r.method()+' '+r.url());});
 await page.goto(base+'/bey-catalog.html?view=pending');await ready(page);
 await page.waitForFunction(()=>document.getElementById('candidate-status').textContent.startsWith('已配'));
 await page.fill('#pending-search','BXA-03');const cards=page.locator('.pending-card');assert.equal(await cards.count(),2);
 const templates=[];
 for(let i=0;i<2;i++){
  const card=cards.nth(i),summary=card.locator('summary');await summary.focus();await page.keyboard.press('Enter');
  assert.equal(await card.locator('details').getAttribute('open'),'');
  const input=card.locator('textarea');assert.equal(await input.getAttribute('readonly'),'');
  const value=await input.inputValue(),id=await card.getAttribute('data-supplied-id');assert.ok(value.includes(id));assert.match(value,/型號：BXA-03/);templates.push(value);
  await card.locator('button').focus();await page.keyboard.press('Enter');
  await page.waitForFunction(id=>{const e=document.querySelector('[data-supplied-id="'+id+'"] [role=status]');return e&&e.textContent.includes('已選取');},id);
  assert.equal(await input.evaluate(e=>e.selectionEnd-e.selectionStart),value.length);
  assert.match(await card.innerText(),/此頁目前不會上傳或儲存圖片/);
 }
 assert.notEqual(templates[0],templates[1]);assert.equal(await page.locator('input[type=file], form').count(),0);assert.deepEqual(writes,[]);
 await page.screenshot({path:path.join(output,'manual-image-handoff.png'),fullPage:false});
},{width:375,height:900}));
test('manual image handoff reports success only after exact template copy',()=>scenario('manual image handoff copy',async page=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__manualCopied=text;}}}));
 await page.goto(base+'/bey-catalog.html?view=pending');await ready(page);
 await page.waitForFunction(()=>document.getElementById('candidate-status').textContent.startsWith('已配'));
 await page.fill('#pending-search','BX-01');await page.locator('.manual-image-handoff summary').click();await page.locator('.manual-image-handoff button').click();
 await page.waitForFunction(()=>document.querySelector('.manual-image-handoff [role=status]').textContent.startsWith('已複製'));
 assert.equal(await page.evaluate(()=>window.__manualCopied),await page.locator('.manual-image-handoff textarea').inputValue());
 assert.equal(await page.locator('.pending-card button').filter({hasText:/核實|錯誤/}).count(),0);
}));
