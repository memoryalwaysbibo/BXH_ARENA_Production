'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(require.resolve('playwright',{paths:[process.env.NODE_PATH||'.']}));
const {fixture,hostScenario}=require('./probe.cjs'),{harness}=require('./host-harness.cjs');
const root=path.resolve(__dirname,'../../..');
(async()=>{const browser=await chromium.launch({headless:true});let checks=0;
 try{for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
  const context=await browser.newContext({viewport,serviceWorkers:'block'}),page=await context.newPage();
  await page.route('https://settlement.fixture.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Isolated settlement app functions</title>'}));
  await page.goto('https://settlement.fixture.test/');
  await page.addScriptTag({content:'(function(){const module={exports:{}};'+fs.readFileSync(path.join(root,'referee-seats/functions/bucket-state.cjs'),'utf8')+';globalThis.BXHMatchBuckets=module.exports;})();'});
  await page.addScriptTag({path:path.join(root,'modules/scoring/four-court-settlement.js')});
  await page.evaluate(f=>{globalThis.__settlementCompleted=f;},fixture());
  for(const options of [{},{mode:'lost'},{mode:'pending'},{mode:'error'},{switchRoom:true},{switchUser:true},{storageFail:true}]){
   const payload=await hostScenario(options),result=await page.evaluate('('+harness.toString()+')('+JSON.stringify(payload.src)+','+JSON.stringify(payload.fixture)+','+JSON.stringify(payload.options)+')');
   assert.equal(result.cloudWrites,0);assert.equal(result.legacy,0);
   assert.equal(result.ok,!(options.mode==='pending'||options.mode==='error'||options.switchRoom||options.switchUser));checks++;
  }
  // Reload does not depend on in-memory callable receipts or local storage.
  await page.reload();
  await page.addScriptTag({content:'(function(){const module={exports:{}};'+fs.readFileSync(path.join(root,'referee-seats/functions/bucket-state.cjs'),'utf8')+';globalThis.BXHMatchBuckets=module.exports;})();'});
  await page.addScriptTag({path:path.join(root,'modules/scoring/four-court-settlement.js')});
  const p=await hostScenario();const result=await page.evaluate('('+harness.toString()+')('+JSON.stringify(p.src)+','+JSON.stringify(p.fixture)+','+JSON.stringify(p.options)+')');assert(result.ok);assert.equal(result.calls,0);checks++;
  await context.close();
 }}finally{await browser.close();}
 console.log(JSON.stringify({browserChecks:checks,productionRequests:0,productionWrites:0,scope:'Chromium actual archive functions and cloud adapter; fixture SDK/auth, not full-host or real authentication'}));
})().catch(e=>{console.error(e);process.exitCode=1;});
