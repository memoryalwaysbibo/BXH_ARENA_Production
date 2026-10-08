'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),{spawn}=require('node:child_process');
const {chromium}=require(require.resolve('playwright',{paths:[process.cwd(),process.env.HC01_PLAYWRIGHT_MODULES,process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES].filter(Boolean)}));
const server=spawn(process.execPath,['hunter-clash/hc01/local-lab.cjs'],{cwd:path.join(__dirname,'..'),stdio:['ignore','pipe','pipe']});
(async()=>{
  const {roomPlayerStats}=await import('../hunter-clash/hc01/cloud/mobile.mjs');
  const fixture={participants:['A','B']};
  const round=(winnerUid,finish,points)=>({winnerUid,finish,points});
  const comeback={winnerUid:'A',rounds:[round('B','extreme',3),round('A','knockout',2),round('A','burst',2)]};
  const stats=roomPlayerStats(fixture,Array(5).fill(comeback),'A');
  assert.equal(stats.leadText,'曾領先 0 場，其中 0 場最後落敗。');
  assert.equal(stats.comebackText,'曾落後 5 場，其中 5 場逆轉獲勝。');
  assert.match(stats.firstText,/0／5 場（0%）/);
  assert.match(stats.positionText,/第 1 回合失分 5／5 場（100%）/);
  assert.match(stats.scoreComment,/擊飛與爆裂取得分數並列/);
  const other=roomPlayerStats(fixture,Array(5).fill(comeback),'B');
  assert.equal(other.leadText,'曾領先 5 場，其中 5 場最後落敗。');
  const sparse=roomPlayerStats(fixture,[comeback],'A');assert.match(sparse.positionText,/資料不足/);
  const mixed=roomPlayerStats(fixture,[{winnerUid:'A',rounds:[...Array(5).fill(round('A','spin',1)),...Array(2).fill(round('A','extreme',3))]}],'A');
  assert.equal(mixed.frequentText,'轉停 5 次');assert.match(mixed.attackText,/極限/);
  for(const [finish,points] of [['extreme',3],['knockout',2],['burst',2],['spin',1]]){
    const sample=roomPlayerStats(fixture,[{winnerUid:'A',rounds:[round('A',finish,points)]}],'A');
    assert.match(sample.scoreComment,/本輪主要得分來自/);assert.equal(sample.attackCount[finish],1);
  }
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
      await page.addInitScript(({uid})=>{window.cameraRequests=0;window.cameraStops=0;Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{window.cameraRequests++;if(uid==='A')throw new DOMException('Denied','NotAllowedError');const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;canvas.getContext('2d').fillRect(0,0,320,240);const stream=canvas.captureStream(5);for(const track of stream.getTracks()){const stop=track.stop.bind(track);track.stop=()=>{window.cameraStops++;stop();};}return stream;}});},{uid});
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
    await A.locator('[data-op="join"]').click();await A.locator('[data-op="scan"]').waitFor({state:'visible'});assert.equal(await A.evaluate(()=>window.cameraRequests),1);assert.equal(await A.locator('[name="pairingCode"]').isVisible(),true);await A.locator('[data-op="back"]').click();assert.equal(await A.locator('.home-actions').isVisible(),true);
    await command(A,'createChallenge');assert.equal(await A.locator('[data-op="cancel"]').textContent(),'返回');await command(A,'cancel');
    assert.equal(await A.locator('.pairing-share').isVisible(),false);assert.equal(await A.evaluate(()=>sessionStorage.getItem('hc01:mobile:last:A')),null);
    await command(A,'createChallenge');await A.screenshot({path:'test-results/hc01/mobile-create.png',fullPage:true});const payload=await A.locator('textarea').inputValue();assert.match(payload,/^bxh-hc01:/);const serial=await A.locator('.pairing-code').textContent();assert.match(serial,/^[2-9A-HJ-NP-Z]{4}$/);assert.equal(await A.locator('.qr canvas,.qr img').count()>0,true);assert.equal(await B.locator('[data-op="stopScan"]').count(),0);assert.equal(await B.locator('[data-op="confirmRound"]').isVisible(),false);await B.locator('[data-op="join"]').click();await B.waitForFunction(()=>document.querySelector('video').srcObject!==null);assert.equal(await B.locator('.camera').isVisible(),true);assert.equal(await B.locator('[data-op="scan"]').isVisible(),false);await B.screenshot({path:'test-results/hc01/mobile-join.png',fullPage:true});await B.locator('[name="pairingCode"]').fill(serial);await command(B,'acceptCode');assert.equal(await B.evaluate(()=>window.cameraStops),1);assert.equal(await B.evaluate(()=>document.querySelector('video').srcObject),null);assert.equal(await B.locator('.pairing-share').isVisible(),false);await A.waitForFunction(()=>document.querySelector('.state').textContent.includes('配對成功'));
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
    // A five-game series reuses one pairing and starts once, then confirms only at the end.
    await A.locator('[name="matchCount"]').fill('5');await command(A,'createChallenge');
    const seriesCode=await A.locator('.pairing-code').textContent();await B.locator('[data-op="join"]').click();await B.locator('[name="pairingCode"]').fill(seriesCode);await command(B,'acceptCode');
    await A.waitForFunction(()=>document.querySelector('.state').textContent.includes('配對成功'));const seriesReady=await command(A,'start');await B.waitForFunction(rev=>document.querySelector('.state').dataset.revision===String(rev),seriesReady.challenge.revision);await command(B,'start');await A.waitForFunction(()=>document.querySelector('.state').textContent==='對戰中');
    for(const finish of ['extreme','spin'])await command(A,'recordRound','[data-op="recordRound"][data-player="0"][data-finish="'+finish+'"]');
    await B.waitForFunction(()=>document.querySelector('.state').textContent.includes('本場結束'));assert.equal(await B.locator('[data-op="nextGame"]').isVisible(),false);assert.equal(await A.locator('[data-op="confirmFinish"]').isVisible(),false);
    await A.locator('.room-analysis summary').click();assert.equal(await A.locator('.room-stat').count(),2);assert.match(await A.locator('.room-stat').first().textContent(),/本輪勝率：100%（1 勝 0 敗）.*評價：資料不足/);assert.match(await A.locator('.room-stat').last().textContent(),/本輪勝率：0%（0 勝 1 敗）.*評價：資料不足/);assert.equal(await A.locator('.room-radar .radar-player').count(),0);assert.match(await A.locator('.room-radar').textContent(),/滿 5 場才顯示初步八角圖/);assert.match(await A.locator('.room-stats-note').textContent(),/暫計.*雙方確認/);
    await command(A,'nextGame');await B.waitForFunction(()=>document.querySelector('.policy').textContent.includes('第 2 / 5 場'));assert.deepEqual(await A.locator('.points').allTextContents(),['0','0']);
    assert.equal(await A.locator('.session-results p').textContent(),'第 1 場：黑爸 4 : 0 小宇');
    for(const finish of ['extreme','spin'])await command(A,'recordRound','[data-op="recordRound"][data-player="1"][data-finish="'+finish+'"]');
    assert.match(await A.locator('.room-stat').first().textContent(),/本輪勝率：50%（1 勝 1 敗）.*評價：資料不足/);
    for(const winner of [0,1,0]){
      await command(A,'nextGame');
      for(const finish of ['extreme','spin'])await command(A,'recordRound','[data-op="recordRound"][data-player="'+winner+'"][data-finish="'+finish+'"]');
    }
    assert.equal(await A.locator('.room-radar .radar-player').count(),1);
    assert.deepEqual(await A.locator('.radar-label').allTextContents(),['極限75%','擊飛0%','爆裂0%','轉停25%','被極限75%','被擊飛0%','被爆裂0%','被轉停25%']);
    assert.match(await A.locator('.room-stat').first().textContent(),/3 勝 2 敗.*評價：初步・極限突擊型/);
    assert.match(await A.locator('.room-stat').first().locator('.room-feedback-metrics').first().textContent(),/主要得分極限 75%（9 分）主要失分被極限 75%（6 分）得分效率60%（12 得分／8 失分）/);
    assert.match(await A.locator('.room-stat').last().locator('.room-feedback-metrics').first().textContent(),/得分效率40%（8 得分／12 失分）/);
    assert.match(await A.locator('.room-feedback-advice').first().textContent(),/回看「被極限」/);
    for(const width of [320,390,430]){await A.setViewportSize({width,height:844});assert.equal(await A.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}await A.setViewportSize({width:390,height:844});
    await A.locator('.radar-tabs button').last().click();assert.equal(await A.locator('.radar-tabs button').last().getAttribute('aria-pressed'),'true');
    assert.equal(await A.locator('.radar-label').first().textContent(),'極限75%');
    const seriesFinal=await command(A,'confirmFinish');await B.waitForFunction(rev=>document.querySelector('.state').dataset.revision===String(rev),seriesFinal.challenge.revision);await command(B,'confirmFinish');
    await A.waitForFunction(()=>document.querySelector('.history-stats').textContent.includes('6 場 · 4 勝 2 敗'));
    await B.waitForFunction(()=>document.querySelector('.history-stats').textContent.includes('6 場 · 2 勝 4 敗'));
    assert.match(await A.locator('.room-stats-note').textContent(),/對戰明細已保存.*沒有另存固定報告/);await A.screenshot({path:'test-results/hc01/mobile-series.png',fullPage:true});
    await A.locator('[data-op="logout"]').click();await A.locator('#login').waitFor({state:'visible'});assert.equal(await A.locator('.history-list').textContent(),'');assert.equal(await A.locator('.qr').textContent(),'');assert.equal(await A.locator('textarea').inputValue(),'');assert.equal(await A.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('hc01:')).length),0);assert.equal(await A.evaluate(()=>localStorage.getItem('hc01:remembered-email')),'A@fixture.invalid');await A.locator('[name="remember"]').uncheck();await A.reload();assert.equal(await A.locator('[name="email"]').inputValue(),'');assert.deepEqual(errors,[]);
    console.log('PASS single-player mobile fixture UI: two sessions, complete match, reload/read recovery, logout cleanup, 390px and no JS errors. Not cloud login or real camera evidence.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.kill('SIGTERM'));
