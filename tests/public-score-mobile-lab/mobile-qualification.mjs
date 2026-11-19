// Runnable on a host where supported Chromium sandbox launch is permitted.
// No sandbox disabling, alternate binary, remote browser, or production endpoints.
import {createRequire} from 'node:module';import http from 'node:http';import fs from 'node:fs';import assert from 'node:assert/strict';
import {seed,publish,commit} from './mobile-fixture.mjs';
const require=createRequire(import.meta.url),{chromium}=require('playwright');
const server=http.createServer((req,res)=>{
 if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');return res.end(fs.readFileSync(new URL('./mobile-bundle.js',import.meta.url)));}
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:16px;font:18px sans-serif}nav{display:flex;gap:8px;flex-wrap:wrap}button{min-height:48px;font:inherit}#score{font-size:48px}</style><nav><button data-route="spectator">觀戰</button><button data-route="referee">裁判</button><button data-route="registration">報名</button></nav><div id="status"></div><div id="source"></div><div id="score"></div><script type="module" src="/bundle.js"></script>`);
});
let browser;
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 browser=await chromium.launch({channel:'chrome',headless:true,chromiumSandbox:true});
 for(const viewport of [{width:390,height:844},{width:844,height:390}]){
  const room='mobile96-'+viewport.width;await seed(room);
  const context=await browser.newContext({viewport,isMobile:true,hasTouch:true});
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  const page=await context.newPage();await page.goto('http://127.0.0.1:'+server.address().port+'/?room='+room);
  console.log('browser viewport',viewport);
  await page.waitForFunction(()=>window.lab?.ready&&lab.states.at(-1)?.state==='live');
  assert.equal(await page.evaluate(()=>lab.metrics().active),2);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  // Actual DOM button/router navigation, not production ARENA UI.
  await page.getByRole('button',{name:'裁判',exact:true}).click();await page.waitForFunction(()=>lab.metrics().active===0);
  const idle=await page.evaluate(()=>lab.metrics().callbacks);await publish(room,s=>s.matches[0].scoreA++);await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>lab.metrics().callbacks),idle);assert.equal(await page.locator('#score').textContent(),'');
  await page.getByRole('button',{name:'觀戰',exact:true}).click();await page.waitForFunction(()=>lab.spectator.snapshot()?.revision===1);
  // DOM pagehide/pageshow dispatch is synthetic; NOT actual mobile OS suspend.
  await page.evaluate(()=>dispatchEvent(new Event('pagehide')));assert.equal(await page.evaluate(()=>lab.metrics().active),0);
  await publish(room,s=>s.matches[0].scoreA++);
  await page.evaluate(()=>dispatchEvent(new Event('pageshow')));await page.waitForFunction(()=>lab.spectator.snapshot()?.revision===2);
  await context.setOffline(true);await page.evaluate(()=>dispatchEvent(new Event('pagehide')));await publish(room,s=>s.matches[0].scoreA++);await context.setOffline(false);
  await page.evaluate(()=>dispatchEvent(new Event('pageshow')));await page.waitForFunction(()=>lab.spectator.snapshot()?.revision===3);
  await publish(room,s=>s.matches[0].scoreA++,{bad:true});await page.waitForFunction(()=>lab.states.at(-1)?.state==='fallback');await page.waitForFunction(()=>document.querySelector('#score').textContent==='4');
  await page.screenshot({path:`mobile-${viewport.width}x${viewport.height}.png`});
  await commit([['labRooms/'+room,{visibility:'private'}]]);await page.waitForFunction(()=>lab.metrics().active===0&&document.querySelector('#score').textContent==='');
  await page.evaluate(()=>lab.binding.dispose());await context.close();
 }
 console.log(JSON.stringify({passed:true,viewports:['390x844','844x390'],actualBrowser:true,productionUI:false,pagehidePageshow:'synthetic DOM events, not OS suspension',wireBytes:null}));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
