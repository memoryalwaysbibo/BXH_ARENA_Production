'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {spawn}=require('node:child_process');
const {chromium}=require(require.resolve('playwright',{paths:[process.cwd(),process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES].filter(Boolean)}));
const server=spawn(process.execPath,['hunter-clash/hc01/local-lab.cjs'],{cwd:path.join(__dirname,'..'),stdio:['ignore','pipe','pipe']});
(async()=>{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('lab-start-timeout')),10000);server.stdout.once('data',()=>{clearTimeout(timer);resolve();});server.once('exit',code=>{clearTimeout(timer);reject(Error('lab-exit-'+code));});});
  const browser=await chromium.launch({headless:true});try{
    const page=await browser.newPage({viewport:{width:1060,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:5198');
    const panel=uid=>page.locator('#'+uid);
    // Wait for each network result independently, rather than a stale success label.
    async function command(uid,op){const response=page.waitForResponse(r=>r.url().endsWith('/command')&&r.request().postDataJSON().operation===op);await panel(uid).locator('[data-op="'+op+'"]').click();const r=await response;assert.equal(r.status(),200);const result=await r.json();await page.waitForFunction(({uid,revision})=>document.querySelector('#'+uid+' .state').textContent.endsWith('版本 '+revision),{uid,revision:result.challenge.revision});}
    await command('A','createChallenge');const payload=await panel('A').locator('textarea').inputValue();assert.match(payload,/^bxh-hc01:/);
    await panel('B').locator('textarea').fill(payload);await command('B','accept');await command('A','getChallenge');
    await command('A','start');await command('B','getChallenge');await command('B','start');await command('A','getChallenge');
    for(const finish of ['extreme','spin']){await panel('A').locator('.finish').selectOption(finish);await command('A','proposeRound');await command('B','getChallenge');await command('B','confirmRound');await command('A','getChallenge');}
    await command('A','confirmFinish');await command('B','getChallenge');await command('B','confirmFinish');await command('A','getChallenge');
    assert.match(await panel('A').locator('.state').textContent(),/完賽紀錄已保存/);assert.equal(await panel('A').locator('.score').textContent(),'4 : 0');assert.deepEqual(errors,[]);
    fs.mkdirSync(path.join(__dirname,'../test-results/hc01'),{recursive:true});
    await page.screenshot({path:path.join(__dirname,'../test-results/hc01/completed.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});await page.reload();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:path.join(__dirname,'../test-results/hc01/mobile.png'),fullPage:true});
    console.log('PASS HC01 local browser pairing, dual starts, two rounds, final confirmations, mobile width and no JS errors. Local memory fixture only.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.kill('SIGTERM'));
