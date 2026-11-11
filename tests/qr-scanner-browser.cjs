'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright':'playwright');
const core=fs.readFileSync(__dirname+'/../modules/main-app/core.js','utf8');
const scanner=core.slice(core.indexOf('function setQrScannerStatus('),core.indexOf('/* ==== registration QR deep-link'));
const modal=core.slice(core.indexOf('function qrScannerModalMarkup(){'),core.indexOf('\nfunction ',core.indexOf('function syncQrScannerModal(){')+30));
const read=p=>fs.readFileSync(__dirname+'/../'+p,'utf8');
const fn=name=>{const start=core.indexOf('function '+name+'(');assert(start>=0);const end=core.indexOf('\nfunction ',start+10);return core.slice(start,end).split("\nlet moodState=")[0];};
const styles=['modules/main-css/core-competition.css','modules/main-css/auth-player.css','modules/main-css/player-center-hunter.css','modules/main-css/lobby-community.css','modules/main-css/call-admin-tail.css','modules/main-css/tail-p7.css','modules/mobile-overrides/styles.css','client-entrance-theme.css','modules/main-css/player-entry-skins.css','modules/main-css/player-qr-checkin.css'].map(read).join('\n');
const fixture=`
let userProfile={active:true},firebaseUser={uid:'review'},currentRole='player',guestReadOnlyMode=false,appPhase='player-center',playerActiveTab='home',LOGO_SRC='';
const esc=s=>String(s),mailboxContext=()=>({messages:[],open:false});
const hunterClashEntry={visible:()=>false};
window.BXHTeamAdminPreview={visible:()=>false};
const playerVisibleTabs=()=>[['home','賽事大廳'],['registered','我的賽程'],['host','我的房間'],['profile','獵人檔案'],['ladder','排行榜']];
const topbarConnectionRailHtml=()=>'',accountEquippedTitleHtml=()=>'',mailboxButtonHtml=()=>'',accountMenuHtml=()=>'',accountMenuOverlayHtml=()=>'';
const renderPlayerNavHtml=()=>'<nav class="player-tabs">'+playerVisibleTabs().map(([k,l])=>'<button class="player-tab-btn" data-action="review-tab" data-tab="'+k+'">'+l+'</button>').join('')+'</nav>';
const content=()=>'<section class="panel"><h1>'+playerActiveTab+'</h1><div style="height:1300px">賽事內容</div><button id="last-content" class="btn">頁面最後一個操作</button></section>';
const renderMoodStation=()=>'',renderTournamentLobby=content,renderPlayerRegisteredTab=content,renderPlayerCommunityHostTab=content,renderPlayerProfileTab=content,renderLadderLeaderboardPage=content;
const renderModal=()=>'',renderCloudJoinModal=()=>cloudJoinModalOpen?'<div class="modal-overlay"><div class="modal-box">手動輸入</div></div>':'',renderEventEntryModal=()=>'',renderSwitchTournamentModal=()=>'',renderAdminTournamentListModal=()=>'',renderPlayerProfileEditModal=()=>'',renderPlayerProfileReminder=()=>'';
let qrScannerOpen=false,qrScannerStatus='',qrScannerStream=null,qrScannerVideoElement=null,qrScannerFrame=null,qrScannerBusy=false,cloudJoinModalOpen=false;
const normalizeRoomCodeInput=v=>v,isValidRoomCode=()=>true,normalizeTournamentEntryType=v=>v,showToast=()=>{},replaceTournamentEntryInUrl=()=>{},routeTournamentEntry=()=>{};
window.jsQR=()=>null;
window.BXHQrCheckin={parseUrl:()=>null};
`;
async function reviewPlayerEntry(browser){for(const [width,height] of [[320,700],[390,844],[430,932],[844,390],[1280,900]]){
const page=await browser.newPage({viewport:{width,height}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+styles+'</style><div id="app"></div>');
const scanner=core.slice(core.indexOf('function setQrScannerStatus('),core.indexOf('/* ==== registration QR deep-link'));
const modal=core.slice(core.indexOf('function qrScannerModalMarkup(){'),core.indexOf('\nfunction renderCloudJoinModal('));
const actions=core.slice(core.indexOf('  if(action==="open-qr-scanner"){'),core.indexOf('  if(action==="event-entry-close"){'));
await page.addScriptTag({content:fixture+'\n'+fn('renderPlayerQrCheckinEntry')+'\n'+fn('renderPlayerHomeTab')+'\n'+fn('renderPlayerCenterLoggedIn')+'\n'+scanner+'\n'+modal+`\nfunction render(){syncQrScannerModal();document.getElementById('app').innerHTML=renderPlayerCenterLoggedIn();}function handleAction(action){${actions}}document.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(!b)return;if(b.dataset.action==='review-tab'){playerActiveTab=b.dataset.tab;render();return;}if(e.target.closest('.modal-box')&&b.classList.contains('modal-overlay'))return;handleAction(b.dataset.action);});render();`});
for(const tab of ['home','registered','host','profile','ladder']){
await page.evaluate(tab=>{playerActiveTab=tab;render();window.scrollTo(0,0)},tab);
const btn=page.getByRole('button',{name:'掃描 QR 報到',exact:true});
assert.equal(await btn.evaluateAll(buttons=>buttons.filter(b=>b.getClientRects().length).length),width<=899?1:tab==='home'?1:0);
if(width<=899){
for(const bottom of [false,true]){await page.evaluate(b=>window.scrollTo(0,b?document.documentElement.scrollHeight:0),bottom);const r=await page.locator('.player-qr-checkin-dock button').evaluate(b=>{const r=b.getBoundingClientRect();return {visible:r.top>=0&&r.bottom<=innerHeight,tap:b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),width:r.width,height:r.height}});assert(r.visible&&r.tap&&r.width>=44&&r.height>=44,JSON.stringify(r));}
const last=await page.locator('#last-content').boundingBox(),dock=await page.locator('.player-qr-checkin-dock').boundingBox();assert(last.y+last.height<=dock.y,'last content must clear dock');
}
}
if(width<=899){await page.locator('.player-qr-checkin-dock button').click();await page.locator('#qr-scanner-portal .modal-box').waitFor();const layers=await page.evaluate(()=>{const b=document.querySelector('.player-qr-checkin-dock button'),r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))});assert.equal(layers,false,'modal must cover dock');await page.getByRole('button',{name:'改用手動輸入／返回',exact:true}).click();assert.equal(await page.locator('#qr-scanner-portal').count(),0);}
assert.deepEqual(errors,[]);console.log('PASS '+width+'x'+height+' all five player tabs, scrolling, final content clearance, modal layering');await page.close();
}}

(async()=>{
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  try{
    await reviewPlayerEntry(browser);
    const page=await browser.newPage({viewport:{width:430,height:932}});
    await page.route('https://arena.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width"><div id="app"></div>'}));
    await page.goto('https://arena.test/');
    await page.addScriptTag({content:`
      let qrScannerOpen=true,qrScannerStatus='',qrScannerStream=null,qrScannerVideoElement=null,qrScannerFrame=null,qrScannerBusy=false;
      const esc=String;let mediaCalls=0,stops=0,pixel=0;
      const camera=document.createElement('canvas');camera.width=640;camera.height=480;
      function paint(){const c=camera.getContext('2d');c.fillStyle=pixel++%2?'#e22':'#2e2';c.fillRect(0,0,640,480);requestAnimationFrame(paint);}paint();
      Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>{
        mediaCalls++;const stream=camera.captureStream(20);
        for(const track of stream.getTracks()){const stop=track.stop.bind(track);track.stop=()=>{stops++;stop();};}
        return stream;
      }}});
      window.jsQR=()=>null;window.BarcodeDetector=undefined;
      ${scanner}
      ${modal}
      function render(){syncQrScannerModal();document.querySelector('#app').innerHTML='<p>background update '+Date.now()+'</p>'+renderQrScannerModal();}
      window.fixture={render,close(){stopQrScanner();qrScannerOpen=false;render();},open(){qrScannerOpen=true;qrScannerAttempted=false;render();},stats:()=>({mediaCalls,stops,status:qrScannerStatus})};
      render();
    `});
    await page.waitForFunction(()=>{const v=document.querySelector('#qr-scanner-video');return v?.readyState>=2&&v.videoWidth>0&&!v.paused;});
    const original=await page.locator('#qr-scanner-video').elementHandle();
    await page.evaluate(async()=>{for(let i=0;i<30;i++){fixture.render();await new Promise(r=>setTimeout(r,15));}});
    assert.equal(await original.evaluate(v=>v===document.querySelector('#qr-scanner-video')&&v.isConnected&&!v.paused),true);
    assert.equal((await page.evaluate(()=>fixture.stats())).mediaCalls,1);
    assert.equal(await page.locator('#app #qr-scanner-video').count(),0);
    await page.evaluate(()=>fixture.close());assert.equal(await page.locator('#qr-scanner-portal').count(),0);
    assert.equal((await page.evaluate(()=>fixture.stats())).stops,1);
    await page.evaluate(()=>fixture.open());
    await page.waitForFunction(()=>{const v=document.querySelector('#qr-scanner-video');return v?.readyState>=2&&v.videoWidth>0&&!v.paused;});
    assert.equal((await page.evaluate(()=>fixture.stats())).mediaCalls,2);
    await page.evaluate(()=>fixture.close());
    console.log('PASS QR camera preview survives 30 app renders and closes/reopens with real canvas MediaStream');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
