'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const core=fs.readFileSync(__dirname+'/../modules/main-app/core.js','utf8');
const scannerParser=core.slice(core.indexOf('function parseScannedTournamentEntry('),core.indexOf('function setQrScannerStatus('));
const scannerAccept=core.slice(core.indexOf('async function acceptScannedQrValue('),core.indexOf('async function startQrScanner('));
const playwrightModule=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright';
const {chromium}=require(playwrightModule);
(async()=>{
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox']});
let passed=0;
async function scenario(name,config,run){
 const page=await browser.newPage({viewport:{width:390,height:844}});
 const src=fs.readFileSync(__dirname+'/../modules/main-app/qr-checkin.js','utf8');
 const loginNotice=fs.readFileSync(__dirname+'/../index.html','utf8').match(/<section id="qr-checkin-login-notice"[\s\S]*?<\/section>/)?.[0];
 assert.ok(loginNotice,'Production shell QR login notice is required');
 const fixture=`<!doctype html><meta charset="utf-8">${loginNotice}<div id="app"></div><script>
 window.calls=[];window.scanResponse=${JSON.stringify(config.response||{ok:true,name:'選手甲',eventName:'測試賽',code:'BXH-ABC123',currentAt:1800000000000})};window.uid=${JSON.stringify(config.uid===undefined?'u1':config.uid)};
 window.room={cloudCode:'BXH-ABC123',meta:{name:'測試賽'},players:[{id:'p1',name:'選手甲',checkedIn:false}]};
 window.engagementService={async tournamentOperation(name,d){calls.push(d);if(d.action==='scan'){${config.delay?'await new Promise(r=>window.finishScan=r);':''}if(scanResponse.error)throw Error(scanResponse.error);return scanResponse;}if(d.action==='status')return {ok:true,enabled:false};if(d.action==='history')return {ok:true,records:[]};return {ok:true};}};
 </script><script>${src}</script><script>
 let qrScannerOpen=false,firebaseUser=window.uid?{uid:window.uid}:null,userProfile={active:true},currentRole='player',guestReadOnlyMode=false,appPhase='player-center';
 function stopQrScanner(){} function setQrScannerStatus(){} function showToast(){} function normalizeRoomCodeInput(v){return String(v||'').trim().toUpperCase();} function isValidRoomCode(v){return /^BXH-[A-Z0-9]{4,16}$/.test(v);} function normalizeTournamentEntryType(v){return v||'event';}
 function replaceTournamentEntryInUrl(){} async function routeTournamentEntry(code,entry){window.routed={code,entry};}
 ${scannerParser}
 ${scannerAccept}
 function render(){BXHQrCheckin.bind({uid:()=>window.uid,state:()=>room,render,toast(){},qr(){},applyRemote(){}});if(!window.uid){document.querySelector('#app').innerHTML='<button>登入</button>';return;}document.querySelector('#app').innerHTML=BXHQrCheckin.renderEntry()||BXHQrCheckin.button();document.querySelector('#app').insertAdjacentHTML('beforeend',BXHQrCheckin.renderModal());}render();
 </script>`;
 await page.route('https://arena.test/**',route=>route.fulfill({contentType:'text/html',body:fixture}));
 await page.goto('https://arena.test/'+(config.manager?'':'?checkin=BXH-ABC123&checkinToken=test'));
 try{await run(page);console.log('PASS '+name);passed++;}finally{await page.close();}
}
try{
 await scenario('正取掃碼直接報到，完成後移除URL憑證',{},async p=>{await p.getByRole('heading',{name:'報到成功',exact:true}).waitFor();assert.equal(await p.evaluate(()=>calls.filter(c=>c.action==='scan').length),1);assert.equal(new URL(p.url()).searchParams.has('checkinToken'),false);});
 await scenario('未登入不提交，登入後自動接續',{uid:null},async p=>{await p.getByText(/請先登入/).waitFor();assert.equal(await p.evaluate(()=>calls.length),0);await p.evaluate(()=>{uid='u1';render();});await p.getByRole('heading',{name:'報到成功',exact:true}).waitFor();});
 await scenario('等待伺服器提交期間不顯示成功',{delay:true},async p=>{await p.getByRole('heading',{name:'正在確認報到…'}).waitFor();assert.equal(await p.getByRole('heading',{name:'報到成功',exact:true}).count(),0);await p.evaluate(()=>finishScan());await p.getByRole('heading',{name:'報到成功',exact:true}).waitFor();});
 await scenario('備取拒絕並提示現場工作人員',{response:{error:'not-confirmed'}},async p=>{await p.getByRole('heading',{name:'報到尚未完成'}).waitFor();await p.getByText(/不在正取名單/).waitFor();});
 await scenario('重複掃描呈現已完成與原始紀錄',{response:{ok:true,already:true,name:'選手甲',currentAt:1800000000000}},async p=>{await p.getByRole('heading',{name:'您已完成報到'}).waitFor();await p.getByText(/台灣時間/).waitFor();});
 await scenario('過期QR可重新掃描，沒有假成功',{response:{error:'qr-expired'}},async p=>{await p.getByText(/QR 已過期/).waitFor();assert.equal(await p.getByRole('heading',{name:'報到成功',exact:true}).count(),0);});
 await scenario('登出後丟棄舊帳號的回覆',{delay:true},async p=>{await p.getByRole('heading',{name:'正在確認報到…'}).waitFor();await p.evaluate(()=>{uid=null;render();finishScan();});await p.getByText(/請先登入/).waitFor();assert.equal(await p.getByText('選手甲',{exact:true}).count(),0);});
 await scenario('手機管理窗口載入狀態與異動紀錄',{manager:true},async p=>{await p.getByRole('button',{name:'現場報到 QR／紀錄'}).click();await p.getByRole('button',{name:'開始報到'}).waitFor({state:'visible'});await p.waitForFunction(()=>calls.some(c=>c.action==='history'));await p.getByText('最近 100 筆報到異動').waitFor();await p.getByRole('button',{name:'關閉',exact:true}).click();assert.equal(await p.getByRole('dialog').count(),0);});
 await scenario('站內掃報到QR沿用登入，不重新載入或找房間',{manager:true},async p=>{await p.evaluate(()=>{window.sessionMarker='retained';return acceptScannedQrValue('https://arena.test/?checkin=BXH-ABC123&checkinToken=in-app');});await p.getByRole('heading',{name:'報到成功',exact:true}).waitFor();assert.equal(await p.evaluate(()=>sessionMarker),'retained');assert.equal(await p.evaluate(()=>calls.filter(c=>c.action==='scan').length),1);assert.equal(await p.evaluate(()=>window.routed),undefined);});
 await scenario('站內掃描仍保留既有找房間路由',{manager:true},async p=>{await p.evaluate(()=>acceptScannedQrValue('BXH-ABC123'));assert.deepEqual(await p.evaluate(()=>window.routed),{code:'BXH-ABC123',entry:'event'});assert.equal(await p.evaluate(()=>calls.length),0);});
 console.log('Browser scenarios: '+passed+' passed');
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
