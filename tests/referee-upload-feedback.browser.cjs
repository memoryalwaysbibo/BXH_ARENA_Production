'use strict';
// Real production panel + command bridge, deferred transport only. No external requests.
const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright');
const core=fs.readFileSync('modules/main-app/core.js','utf8');
const helper=core.slice(core.indexOf('const refereeUploads='),core.indexOf('const refereeSeatCommandBusy='));
const bridge=core.slice(core.indexOf('const refereeSeatCommandBusy='),core.indexOf('\nasync function executeRefereeDispatchCommand('));
const panel=core.slice(core.indexOf('function renderRefereeScorePanel('),core.indexOf('\nfunction renderSkippedMatches('));
const permission=core.slice(core.indexOf('function requireStationPermission('),core.indexOf('\nfunction flattenedRefereeStationUids('));
const index=fs.readFileSync('index.html','utf8');
const css=[...index.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"?]+)[^"]*"/g)].map(m=>m[1]).filter(p=>!/^https?:/.test(p)&&fs.existsSync(p)).map(p=>fs.readFileSync(p,'utf8')).join('\n');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
 const out=path.resolve('test-results/referee-upload-feedback');fs.mkdirSync(out,{recursive:true});
 try{for(const width of [320,390,1280]){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>{requests.push(r.request().url());return r.abort();});
  await page.clock.install();
  await page.setContent('<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+css+'</style><main id="app"></main>');
  await page.addScriptTag({content:`
var pendingModal=null,cloudStatus='connected',writes=[],resolveWrite;
var state={id:'lab',cloudCode:'BXH-LAB',startedAt:1,meta:{stations:2,refereeSeatsV1:{version:1,courts:{}}},matches:[1,2].map(n=>({id:'m'+n,station:n,a:{playerId:'選手甲'},b:{playerId:'選手乙'},scoreA:0,scoreB:0,log:[],status:'in_progress'}))};
const currentAuthUid=()=> 'judge',getMatch=id=>state.matches.find(m=>m.id===id),canUseRefereeSeatCommands=()=>true,canOperateStation=()=>true,canOperateMatchStation=()=>true,cloudAvailable=()=>true,refereeFaultWritePending=()=>false,refereeFaultCount=()=>0,refereeFaultLast=()=>null,playerName=x=>x,esc=String,checkWinnerSide=()=>null,refereeViewClass=()=>'',refereeSwapControl=()=>'<div class="ref-vs-mark">VS</div>',matchStatusBarHtml=()=> '進行中',refereeCourtSwapButton=()=>'',stationMutationErrorMessage=r=>r,showToast=()=>{},applyRemoteState=s=>state=s;
const POINT_LABELS={spin:'旋轉＋1',knockout:'擊飛＋2',burst:'爆裂＋2',extreme:'極限＋3'};
window.cloudSync={commitRefereeCommand:r=>{writes.push(r);return new Promise(resolve=>resolveWrite=resolve);},joinRoom:async()=>({ok:false})};
${helper}${bridge}${panel}${permission}
function render(){document.getElementById('app').innerHTML='<div class="court-grid">'+state.matches.map(m=>'<section class="panel court-card referee-workstation" id="court-card-'+m.station+'"><h3>'+m.station+'號台</h3>'+renderRefereeScorePanel(m,m.station)+'</section>').join('')+'</div>';document.querySelectorAll('[data-action="score"]').forEach(b=>b.onclick=()=>executeRefereeSeatCommand(b.dataset.id,{action:'score',side:b.dataset.side,finish:b.dataset.type}));}render();
`});
  const status=page.locator('#court-card-1 .ref-upload-status'),button=page.locator('#court-card-1 [data-action="score"]').first();
  const baseline=await status.boundingBox(),actionBox=await page.locator('#court-card-1 .ref-result-actions').boundingBox();
  await button.click();assert.match(await status.innerText(),/分數上傳中/);assert(await button.isDisabled());assert(await page.locator('#court-card-2 [data-action="score"]').first().isEnabled());
  await page.evaluate(()=>executeRefereeSeatCommand('m1',{action:'score',side:'A',finish:'spin'}));assert.equal(await page.evaluate(()=>writes.length),1);
  await page.clock.fastForward(8001);assert.match(await status.innerText(),/正在等待確認/);assert(await button.isDisabled());
  assert.equal((await status.boundingBox()).height,baseline.height);assert.equal((await page.locator('#court-card-1 .ref-result-actions').boundingBox()).y,actionBox.y);
  if(width===390)await page.screenshot({path:path.join(out,'mobile-waiting.png'),fullPage:true});
  await page.evaluate(()=>resolveWrite({ok:true,state:JSON.parse(JSON.stringify(state))}));await page.waitForFunction(()=>document.querySelector('.ref-upload-status').dataset.phase==='saved');
  assert.match(await status.innerText(),/✓ 分數已儲存/);assert(await button.isEnabled());
  assert.equal((await page.locator('#court-card-1 .ref-result-actions').boundingBox()).y,actionBox.y);
  await page.clock.fastForward(2501);assert.equal(await status.getAttribute('data-phase'),'idle');
  await button.click();await page.evaluate(()=>resolveWrite({ok:false,reason:'deadline-exceeded'}));await page.waitForFunction(()=>document.querySelector('.ref-upload-status').dataset.phase==='unknown');
  assert.match(await status.innerText(),/結果尚未確認/);assert.equal(await page.evaluate(()=>writes.length),2);
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);await page.close();console.log('PASS upload panel '+width+'px: pending/slow/saved/unknown, stable layout, one request, court isolation');
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
