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
test('direct pending link, exact counts, seven series and no guessed pictures',()=>scenario('direct link and counts',async page=>{
 await page.goto(base+'/bey-catalog.html?view=pending');await ready(page);
 assert.equal(await page.locator('.pending-card').count(),285);assert.equal(await page.locator('#verified-panel').isVisible(),false);
 assert.match(await page.locator('#pending-panel').innerText(),/使用者提供清單，尚未核實/);
 assert.match(await page.locator('.pending-unresolved').innerText(),/BXA-/);assert.equal(await page.locator('.pending-card img').count(),0);
 for(const [series,count] of Object.entries(model.SERIES_COUNTS)){await page.selectOption('#pending-series',series);assert.equal(await page.locator('.pending-card').count(),count);}
 await page.screenshot({path:path.join(output,'pending-desktop.png'),fullPage:true});
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
