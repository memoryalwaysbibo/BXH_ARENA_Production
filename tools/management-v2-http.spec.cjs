'use strict';
const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(process.env.BXH_PILOT_ROOT||process.cwd());
const assets=['modules/management-v2/navigation.js','modules/management-v2/adapter.js',
 'modules/management-v2/bootstrap.js','modules/management-v2/styles.css',
 'interface-preference.js','my-interface-ui.js','player-identity-ui.js','interface-preference.css','player-identity-ui.css'];
test.beforeEach(async({context})=>{
 await context.route('**/*',route=>new URL(route.request().url()).origin==='http://127.0.0.1:4183'?route.continue():route.abort());
 await context.addInitScript(()=>{const key='bxh:management-interface';if(localStorage.getItem(key)===null)localStorage.setItem(key,'v2');});
});
for(const role of ['admin','staff'])for(const width of [390,1280]){
 test(`HTTP assets, V1/V2 persistence and remount: ${role} ${width}px`,async({page},info)=>{
  await page.setViewportSize({width,height:844});
  const errors=[],responses=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>responses.push(r));
  const response=await page.goto('/fixture?role='+role);expect(response.status()).toBe(200);
  await expect(page.locator('html')).toHaveAttribute('data-bxh-management-ui','v2');
  await expect(page.locator('[data-management-v2-group]:not(.is-placeholder)')).toHaveCount(role==='admin'?5:3);
  await expect(page.locator('[data-management-v2-group="hunter"]')).toHaveAttribute('aria-disabled','true');
  for(const asset of assets){
   const matches=responses.filter(r=>new URL(r.url()).pathname==='/'+asset);expect(matches).toHaveLength(1);
   expect(matches[0].status()).toBe(200);expect(await matches[0].body()).toEqual(fs.readFileSync(path.join(root,asset)));
  }
  await page.screenshot({path:info.outputPath(`${role}-${width}.png`)});
  await page.locator('[data-management-v2-tab="bracket"]').click();
  await page.locator('[data-management-v2-group="hunter"]').evaluate(el=>el.click());
  expect(await page.evaluate(()=>window.__actions)).toEqual(['bracket']);
  await page.locator('[data-management-v2-group="system"]').click();
  expect(await page.evaluate(()=>window.__actions)).toEqual(['bracket','operations']);
  await page.locator('#bxh-my-interface-entry').click();await page.locator('[data-bxh-interface="v1"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-bxh-management-ui','v1');
  expect(await page.evaluate(()=>localStorage.getItem('bxh:management-interface'))).toBe('v1');
  await page.reload();await expect(page.locator('html')).toHaveAttribute('data-bxh-management-ui','v1');
  await page.locator('#bxh-my-interface-entry').click();await page.locator('[data-bxh-interface="v2"]').click();
  await page.locator('[data-interface-close]').click();await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-bxh-management-ui','v2');
  await page.evaluate(()=>{const h=document.querySelector('#bxh-management-v2-nav');h.replaceWith(h.cloneNode(false));});
  await expect(page.locator('[data-management-v2-tab="bracket"]')).toHaveCount(1);
  await page.locator('[data-management-v2-tab="bracket"]').click();expect(await page.evaluate(()=>window.__actions)).toEqual(['bracket']);
  await expect(page.locator('#kept-header')).toHaveText('BXH ARENA');await expect(page.locator('#kept-content')).toHaveText('CANONICAL CONTENT UNCHANGED');
  expect(errors).toEqual([]);
 });
}
test('migrated smoke page loads via HTTP and all assertions pass',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/tests/management-ui-v2-smoke.html');
 await expect(page.locator('#out')).toContainText('PASS mount child callback');
 const lines=(await page.locator('#out').innerText()).trim().split('\n');expect(lines).toHaveLength(12);
 expect(lines.every(line=>line.startsWith('PASS '))).toBeTruthy();expect(errors).toEqual([]);
});
test('legacy URLs remain byte-identical; real browser HTTP fetch',async({page})=>{
 await page.goto('/fixture');
 for(const file of ['management-ui-v2.js','management-ui-v2-adapter.js','management-ui-v2-bootstrap.js','management-ui-v2.css']){
  const result=await page.evaluate(async name=>{const r=await fetch('/'+name);return {status:r.status,text:await r.text()};},file);
  expect(result.status).toBe(200);expect(result.text).toBe(fs.readFileSync(path.join(root,file),'utf8'));
 }
});
for(const asset of ['navigation.js','adapter.js'])test('missing '+asset+' falls back to V1',async({page})=>{
 await page.route('**/modules/management-v2/'+asset+'?*',route=>route.abort());
 await page.goto('/fixture');await expect(page.locator('html')).toHaveAttribute('data-bxh-management-ui','v1');
 await expect(page.locator('#kept-content')).toHaveText('CANONICAL CONTENT UNCHANGED');
});
