'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),{spawn}=require('node:child_process');
const {chromium}=require(require.resolve('playwright',{paths:[process.cwd(),process.env.HC01_PLAYWRIGHT_MODULES,process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES].filter(Boolean)}));
const server=spawn(process.execPath,['hunter-clash/hc01/local-lab.cjs'],{cwd:path.join(__dirname,'..'),stdio:['ignore','pipe','pipe']});
(async()=>{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('lab-start-timeout')),10000);server.stdout.once('data',()=>{clearTimeout(timer);resolve();});server.once('exit',code=>{clearTimeout(timer);reject(Error('lab-exit-'+code));});});
  const browser=await chromium.launch({headless:true});try{
    const pages=[];const errors=[];
    for(const uid of ['A','B']){
      const page=await browser.newPage({viewport:{width:390,height:844}});pages.push(page);page.on('pageerror',e=>errors.push(e.message));
      // Fixture replaces bootstrap only. This tests mobile UI; it is not cloud Auth/App Check evidence.
      await page.route('**/cloud/boot.mjs',route=>route.fulfill({contentType:'text/javascript',body:`import{mountMobile}from'/cloud/mobile.mjs';
        const auth={currentUser:null};let callback;const runtime={auth,
          watch(fn){callback=fn;queueMicrotask(()=>fn(null));return()=>{};},
          async login(email,password){if(email!==${JSON.stringify(uid+'@fixture.invalid')}||password!=='fixture')throw Error('invalid');auth.currentUser={uid:${JSON.stringify(uid)}};callback(auth.currentUser);},
          async logout(){auth.currentUser=null;callback(null);},
          async transport(operation,input,{uid,signal}){const r=await fetch('/command',{method:'POST',headers:{'Content-Type':'application/json',authorization:'Bearer '+uid},body:JSON.stringify({operation,input}),signal});const b=await r.json();if(!r.ok){const e=Error(b.error);e.definitive=true;throw e;}return b;}};
        mountMobile(document.querySelector('main'),runtime);`}));
      await page.goto('http://127.0.0.1:5198/cloud/index.html');await page.locator('[name="playerName"]').fill(uid==='A'?'黑爸':'小宇');await page.locator('[name="email"]').fill(uid+'@fixture.invalid');await page.locator('[name="password"]').fill('fixture');if(uid==='A')await page.locator('[name="remember"]').check();await page.locator('#login button').click();await page.locator('#match').waitFor({state:'visible'});assert.equal(await page.locator('[name="password"]').inputValue(),'');
    }
    const[A,B]=pages;
    fs.mkdirSync('test-results/hc01',{recursive:true});
    for(const width of [320,390,430]){await A.setViewportSize({width,height:844});assert.equal(await A.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
    await A.setViewportSize({width:390,height:844});
    assert.equal(await A.locator('#who').textContent(),'黑爸');
    assert.equal(await A.locator('.more-actions').isVisible(),false);
    await A.screenshot({path:'test-results/hc01/mobile-home.png',fullPage:true});
    async function command(page,op,selector){const response=page.waitForResponse(r=>r.url().endsWith('/command')&&r.request().postDataJSON().operation===op);await page.locator(selector||'[data-op="'+op+'"]').click();const r=await response;assert.equal(r.status(),200);const b=await r.json();if(op==='cancel')await page.locator('.home-actions').waitFor({state:'visible'});else await page.waitForFunction(rev=>document.querySelector('.state').dataset.revision===String(rev),b.challenge.revision);return b;}
    await A.locator('[data-op="join"]').click();await A.locator('[data-op="back"]').click();assert.equal(await A.locator('.home-actions').isVisible(),true);
    await command(A,'createChallenge');assert.equal(await A.locator('[data-op="cancel"]').textContent(),'返回');await command(A,'cancel');
    assert.equal(await A.locator('.pairing-share').isVisible(),false);assert.equal(await A.evaluate(()=>sessionStorage.getItem('hc01:mobile:last:A')),null);
    await command(A,'createChallenge');await A.screenshot({path:'test-results/hc01/mobile-create.png',fullPage:true});const payload=await A.locator('textarea').inputValue();assert.match(payload,/^bxh-hc01:/);const serial=await A.locator('.pairing-code').textContent();assert.match(serial,/^[2-9A-HJ-NP-Z]{4}$/);assert.equal(await A.locator('.qr canvas,.qr img').count()>0,true);assert.equal(await B.locator('[data-op="stopScan"]').isVisible(),false);assert.equal(await B.locator('[data-op="confirmRound"]').isVisible(),false);await B.locator('[data-op="join"]').click();await B.screenshot({path:'test-results/hc01/mobile-join.png',fullPage:true});await B.locator('[name="pairingCode"]').fill(serial);await command(B,'acceptCode');assert.equal(await B.locator('.pairing-share').isVisible(),false);await A.waitForFunction(()=>document.querySelector('.state').textContent.includes('配對成功'));
    assert.equal(await A.locator('.join-panel').isVisible(),false);assert.equal(await A.locator('[data-op="start"]').textContent(),'確認開賽');const ready=await command(A,'start');await B.waitForFunction(rev=>document.querySelector('.state').dataset.revision===String(rev),ready.challenge.revision);await command(B,'start');await A.waitForFunction(()=>document.querySelector('.state').textContent.includes('對戰中'));
    for(const page of pages)assert.deepEqual(await page.locator('.player-score h3').allTextContents(),['黑爸','小宇']);
    await A.locator('[data-op="exchange"]').click();
    assert.deepEqual(await A.locator('.player-score h3').allTextContents(),['小宇','黑爸']);
    assert.deepEqual(await B.locator('.player-score h3').allTextContents(),['黑爸','小宇']);
    const exchanged=await command(A,'recordRound','[data-op="recordRound"][data-player="0"][data-finish="spin"]');
    assert.equal(exchanged.challenge.score.a,1);assert.equal(exchanged.challenge.score.b,0);
    assert.deepEqual(await A.locator('.points').allTextContents(),['0','1']);
    await command(A,'undoRound');await A.locator('[data-op="exchange"]').click();
    for(const width of [320,390,430]){await A.setViewportSize({width,height:844});assert.equal(await A.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
    await A.setViewportSize({width:390,height:844});
    await A.screenshot({path:'test-results/hc01/mobile-scoring.png',fullPage:true});
    for(const finish of ['extreme','spin']){const result=await command(A,'recordRound','[data-op="recordRound"][data-player="0"][data-finish="'+finish+'"]');await B.waitForFunction(rev=>document.querySelector('.state').dataset.revision===String(rev),result.challenge.revision);assert.equal(await B.locator('[data-op="confirmRound"]').isVisible(),false);}
    const firstConfirm=await command(A,'confirmFinish');await B.waitForFunction(rev=>document.querySelector('.state').dataset.revision===String(rev),firstConfirm.challenge.revision);
    await command(B,'dispute');await A.waitForFunction(()=>document.querySelector('.state').textContent==='請核對比分');
    assert.equal(await A.locator('.home-actions').isVisible(),false);
    assert.equal(await A.locator('[data-op="confirmFinish"]').isVisible(),false);
    assert.equal(await B.locator('[data-op="undoRound"]').isVisible(),false);
    await command(A,'undoRound');assert.equal(await A.locator('.points').first().textContent(),'3');
    await command(A,'recordRound','[data-op="recordRound"][data-player="0"][data-finish="spin"]');
    await A.screenshot({path:'test-results/hc01/mobile-score-review.png',fullPage:true});
    const reviewed=await command(A,'resumeReview');await B.waitForFunction(rev=>document.querySelector('.state').dataset.revision===String(rev),reviewed.challenge.revision);
    const final=await command(A,'confirmFinish');assert.equal(await A.locator('.state').textContent(),'等待對方確認中');assert.equal(await A.locator('.confirmation-wait').isVisible(),true);assert.equal(await A.locator('[data-op="dispute"]').isVisible(),false);assert.equal(await A.locator('[data-op="undoRound"]').isVisible(),false);assert.equal(await A.locator('[data-op="cancel"]').isVisible(),false);await B.waitForFunction(rev=>document.querySelector('.state').dataset.revision===String(rev),final.challenge.revision);await command(B,'confirmFinish');await A.waitForFunction(()=>document.querySelector('.state').textContent.includes('完賽紀錄已保存'));
    await A.waitForFunction(()=>document.querySelector('.history-stats').textContent.includes('1 勝 0 敗'));
    await B.waitForFunction(()=>document.querySelector('.history-stats').textContent.includes('0 勝 1 敗'));
    for(const page of pages)await page.locator('#history summary').click();
    assert.equal(await A.locator('.history-match strong').textContent(),'黑爸 vs 小宇');assert.equal(await B.locator('.history-match strong').textContent(),'小宇 vs 黑爸');
    assert.equal(await A.locator('.history-match span').textContent(),'勝 4 : 0');assert.equal(await B.locator('.history-match span').textContent(),'敗 0 : 4');
    await A.screenshot({path:'test-results/hc01/mobile-history.png',fullPage:true});
    // Session reload restores only challenge ID, then reads current service state after login.
    await A.reload();assert.equal(await A.locator('[name="playerName"]').inputValue(),'黑爸');assert.equal(await A.locator('[name="email"]').inputValue(),'A@fixture.invalid');assert.equal(await A.locator('[name="remember"]').isChecked(),true);assert.equal(await A.locator('[name="password"]').inputValue(),'');await A.locator('[name="password"]').fill('fixture');await A.locator('#login button').click();await A.waitForFunction(()=>document.querySelector('.state').textContent.includes('完賽紀錄已保存'));
    for(const page of pages)assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    fs.mkdirSync('test-results/hc01',{recursive:true});await A.screenshot({path:'test-results/hc01/mobile-internal-test.png',fullPage:true});
    // A two-game series reuses one pairing and starts once, then confirms only at the end.
    await A.locator('[name="matchCount"]').fill('2');await command(A,'createChallenge');
    const seriesCode=await A.locator('.pairing-code').textContent();await B.locator('[data-op="join"]').click();await B.locator('[name="pairingCode"]').fill(seriesCode);await command(B,'acceptCode');
    await A.waitForFunction(()=>document.querySelector('.state').textContent.includes('配對成功'));const seriesReady=await command(A,'start');await B.waitForFunction(rev=>document.querySelector('.state').dataset.revision===String(rev),seriesReady.challenge.revision);await command(B,'start');await A.waitForFunction(()=>document.querySelector('.state').textContent==='對戰中');
    for(const finish of ['extreme','spin'])await command(A,'recordRound','[data-op="recordRound"][data-player="0"][data-finish="'+finish+'"]');
    await B.waitForFunction(()=>document.querySelector('.state').textContent.includes('本場結束'));assert.equal(await B.locator('[data-op="nextGame"]').isVisible(),false);assert.equal(await A.locator('[data-op="confirmFinish"]').isVisible(),false);
    await command(A,'nextGame');await B.waitForFunction(()=>document.querySelector('.policy').textContent.includes('第 2 / 2 場'));assert.deepEqual(await A.locator('.points').allTextContents(),['0','0']);
    assert.equal(await A.locator('.session-results p').textContent(),'第 1 場：黑爸 4 : 0 小宇');
    for(const finish of ['extreme','spin'])await command(A,'recordRound','[data-op="recordRound"][data-player="1"][data-finish="'+finish+'"]');
    const seriesFinal=await command(A,'confirmFinish');await B.waitForFunction(rev=>document.querySelector('.state').dataset.revision===String(rev),seriesFinal.challenge.revision);await command(B,'confirmFinish');
    await A.waitForFunction(()=>document.querySelector('.history-stats').textContent.includes('3 場 · 2 勝 1 敗'));
    await B.waitForFunction(()=>document.querySelector('.history-stats').textContent.includes('3 場 · 1 勝 2 敗'));
    await A.screenshot({path:'test-results/hc01/mobile-series.png',fullPage:true});
    await A.locator('[data-op="logout"]').click();await A.locator('#login').waitFor({state:'visible'});assert.equal(await A.locator('.history-list').textContent(),'');assert.equal(await A.locator('.qr').textContent(),'');assert.equal(await A.locator('textarea').inputValue(),'');assert.equal(await A.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('hc01:')).length),0);assert.equal(await A.evaluate(()=>localStorage.getItem('hc01:remembered-email')),'A@fixture.invalid');await A.locator('[name="remember"]').uncheck();await A.reload();assert.equal(await A.locator('[name="email"]').inputValue(),'');assert.deepEqual(errors,[]);
    console.log('PASS single-player mobile fixture UI: two sessions, complete match, reload/read recovery, logout cleanup, 390px and no JS errors. Not cloud login or real camera evidence.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.kill('SIGTERM'));
