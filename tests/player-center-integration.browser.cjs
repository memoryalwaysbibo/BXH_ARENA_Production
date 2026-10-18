'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'.']}));
const core=fs.readFileSync('modules/main-app/core.js','utf8');
function fn(name){const a=core.indexOf('function '+name+'(');return core.slice(a,core.indexOf('\n}',a)+2);}
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BXH_TEST_BROWSER?{executablePath:process.env.BXH_TEST_BROWSER}:{})});
 try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<style>:root{--panel-1:#171b22;--panel-2:#20262e;--panel-3:#272f39;--border:#3c4655;--border-soft:#343f4c;--muted:#a9b5c3;--white:#edf2f8;--accent:#7ed6a7;--gold:#e5c479}body{background:var(--panel-1);color:var(--white);font:14px system-ui;margin:0}.panel{padding:16px;margin-bottom:16px;background:var(--panel-2);border:1px solid var(--border);border-radius:12px}.btn{padding:10px;background:var(--panel-3);color:var(--white);border:1px solid var(--border);border-radius:8px}.btn-primary{background:var(--accent);color:#10201a}.btn-row{display:flex;flex-wrap:wrap;gap:6px}.hunter-section-head{display:flex;justify-content:space-between;align-items:center}.hint,.label{color:var(--muted);font-size:12px}.value{font-size:22px}.stat-box{text-align:center}.badge{padding:4px 8px;background:var(--panel-3)}</style><main class="player-main" id="app"></main>');
 await page.addStyleTag({content:fs.readFileSync('modules/main-css/player-center-hunter.css','utf8')});
 for(const file of ['domain-utils','hunter-utils'])await page.addScriptTag({content:fs.readFileSync('modules/main-app/'+file+'.js','utf8')});
 await page.addScriptTag({content:`Object.assign(window,BXHHunterUtils);const hunterRecordEventKey=BXHDomainUtils.hunterRecordEventKey;
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let playerProfileSection='overview',playerProfileSectionUid='self',playerCenterPeriod='season',playerCenterLadderRequestedUid='self';
 const currentAuthUid=()=> 'self',ROLE_ICON_PLAYER='黑',effectiveGameId=p=>p.gameId,playerDerivedId=()=> 'SAMPLE',hunterSeasonStartMs=()=>Date.parse('2026-10-01');
 const hunterProfileLoading=false,hunterProfileError=null,myLadderProfileCache={seasonPoints:286,careerPoints:920},myLadderProfileLoading=false;
 const myRegistrationsTournamentInfo={E1:{phase:'done'}};const schedulePhase=i=>i.phase||'waiting';
 const hunterRecordCardHtml=r=>'<div class="hunter-record-card">第 '+r.round+' 輪 · '+esc(r.opponent.name)+' · '+(r.isWin?'勝':'敗')+'</div>';
 const renderPlayerRegisteredTab=()=>'<details class="panel"><summary>下週主題賽 · 本人正取</summary><p>已報名 · 報到尚未開放</p></details>';
 const hunterProfileCache={records:[1,2,3].map(i=>({eventCode:'E1',eventName:'手機版面驗收示意賽事',eventDate:'2026-10-18',matchId:'m'+i,completedAt:Date.parse('2026-10-18')+i,isWin:i!==3,round:i,opponent:{name:'對手 '+i}})),skipped:[]};
 ${['playerCenterEventGroups','playerCenterDataNotice','playerCenterEventHtml','renderPlayerCenterCareer','renderPlayerCenterOverview','renderPlayerProfileTab'].map(fn).join('\n')}
 const userProfile={gameId:'黑爸',realName:'吳健凱'};function render(){document.getElementById('app').innerHTML=renderPlayerProfileTab(userProfile);}const renderPreservingScroll=render;
 document.addEventListener('click',e=>{const target=e.target.closest('[data-action]');if(!target)return;const action=target.dataset.action;
 ${core.slice(core.indexOf('  if(action==="profile-section"){'),core.indexOf('  if(action==="test-ladder-toggle"){'))}
 });render();`});
 for(const width of [320,390,430,768]){
  await page.setViewportSize({width,height:1000});
  await page.getByRole('button',{name:'生涯',exact:true}).click();assert.ok((await page.locator('.player-center-metrics').textContent()).includes('2–1'));
  await page.getByRole('tab',{name:'生涯紀錄',exact:true}).click();await page.locator('.player-center-event>summary').click();assert.equal(await page.locator('.player-center-event[open] .hunter-record-card').count(),3);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'career overflow '+width);
  await page.getByRole('tab',{name:'個人總覽',exact:true}).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'overview overflow '+width);
 }
 await page.setViewportSize({width:390,height:1100});await page.screenshot({path:'/tmp/bxh-player-center-mobile.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS real profile render, action handlers, period switch and event expansion at 320/390/430/768px');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
