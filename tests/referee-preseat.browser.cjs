'use strict';
// Production rendering and confirmation snippets, real seat UI and seat engine;
// transport is simulated. No production account, Firebase or external writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(require.resolve('playwright',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'.']}));
const repo=path.join(__dirname,'..'),core=fs.readFileSync(path.join(repo,'modules/main-app/core.js'),'utf8');
function fn(name){const start=core.indexOf('function '+name+'('),end=core.indexOf('\nfunction ',start+1);assert(start>=0);return core.slice(start,end<0?undefined:end);}
const index=fs.readFileSync(path.join(repo,'index.html'),'utf8');
const styles=[...index.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"?]+)[^"]*"/g)].map(m=>m[1]).filter(p=>!/^https?:/.test(p)&&fs.existsSync(path.join(repo,p))).map(p=>fs.readFileSync(path.join(repo,p),'utf8')).join('\n');
const confirmStart=core.indexOf('  if(action==="modal-confirm"){',core.indexOf('function handleAction('));
const confirmEnd=core.indexOf('// v13.14.2',confirmStart);
const ackStart=core.indexOf('  const modalConfirmBtn = document.getElementById("modal-confirm-btn");',core.indexOf('function bindDynamicInputs('));
const ackEnd=core.indexOf('  const ta = document.getElementById("player-textarea");',ackStart);
assert(confirmStart>0&&confirmEnd>confirmStart&&ackStart>0&&ackEnd>ackStart);
const productionFunctions=['canUseRefereeSyncRecovery','refereeSyncRecoveryControlsHtml','refereeWorkstationHeader','refereeWaitingControls','renderWaitingRefereeCourt','renderReferee','courtForceExitConfirmation','renderModal','openModal','closeModal'].map(fn).join('\n');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:1});
  const page=await context.newPage(),errors=[],external=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>{external.push(r.request().url());return r.abort();});
  await page.setContent('<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+styles+'</style><div id="app"></div></html>');
  await page.addScriptTag({content:fs.readFileSync(path.join(repo,'modules/main-app/referee-seats.js'),'utf8')});
  await page.addScriptTag({content:`
    var state={id:'fixture',cloudCode:'BXH-TEST',meta:{stations:6,refereeSeatsV1:{version:1,revision:1,courts:{},requests:{}}},matches:[],bracketSize:0};
    var pendingModal=null,courtRetirementBusy=false,executed=[],seatWrites=[],toasts=[];
    const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const refereeBracketRoundtripNav=()=>'',courtAtmosphereStyle=()=>'',refereeDisplayForStation=()=> '測試裁判',refereeStationStatus=()=>({label:'等待中',cls:'waiting'}),stationCompletedCount=()=>0,refereeStationRestrictionEnabled=()=>true,canForceExitCourt=()=>true,canManageCourtRetirement=()=>true;
    const playerName=id=>({a:'測試選手甲',b:'測試選手乙'})[id]||id,showToast=m=>toasts.push(m),executeCourtForceAction=change=>executed.push(change),shouldBindLobbyInput=()=>true;
    ${productionFunctions}
    function handleAction(action){
      if(action==='modal-cancel'){closeModal();return;}
      ${core.slice(confirmStart,confirmEnd)}
    function bindConfirmation(){${core.slice(ackStart,ackEnd)}}
    function render(){
      BXHRefereeSeats.bind({state:()=>state,uid:()=>'judge',eligible:()=>true,operator:()=>true,manager:()=>true,render,toast:showToast});
      document.getElementById('app').innerHTML=(state.bracketSize?renderWaitingRefereeCourt(1):renderReferee())+renderModal();
      bindConfirmation();
      document.querySelector('[data-action="court-force-exit"]')?.addEventListener('click',()=>openModal(courtForceExitConfirmation({kind:'force-exit',station:1,matchId:'m'}, {a:{playerId:'a'},b:{playerId:'b'},scoreA:3,scoreB:2})));
    }
    window.cloudSync={manageRefereeSeats:async data=>{
      seatWrites.push(data);
      const court=state.meta.refereeSeatsV1.courts[data.station]||{revision:0};
      court[data.slot]=data.action==='leave'?null:{uid:'judge',name:'測試裁判'};
      court.revision++;state.meta.refereeSeatsV1.courts[data.station]=court;
      return {ok:true};
    }};
    render();
  `});
  assert.equal(await page.locator('.ref-seat-button').count(),18);
  assert.equal(await page.locator('.ref-waiting-controls button:not(:disabled)').count(),0);
  await page.locator('[data-station="1"][data-slot="main"]').tap();
  await page.waitForFunction(()=>state.meta.refereeSeatsV1.courts[1]?.main?.uid==='judge');
  assert.equal(await page.locator('.ref-seat-button.mine').count(),1);
  assert.equal(await page.locator('.ref-waiting-controls button:not(:disabled)').count(),0);
  for(const width of [320,390,430,960]){
    await page.setViewportSize({width,height:900});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'pre-draw overflow at '+width);
  }
  await page.evaluate(()=>{state.meta.stations=12;render();});
  assert.equal(await page.locator('.ref-seat-button').count(),36);
  assert.equal(await page.locator('.ref-waiting-controls').count(),12);
  // Simulated draw replaces displayed match state without resetting the seat model.
  await page.evaluate(()=>{state.bracketSize=4;render();});
  assert.equal(await page.locator('.ref-seat-button.mine').count(),1);
  assert.equal(await page.locator('[data-action="court-force-exit"]').isVisible(),false);
  await page.setViewportSize({width:390,height:844});
  await page.locator('[data-slot="main"]').tap();
  await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).tap();
  assert.equal(await page.evaluate(()=>executed.length),0,'seat exit cancellation must not retire court');
  await page.locator('.ref-court-maintenance summary').tap();
  await page.getByRole('button',{name:'裁判台強制退場',exact:true}).tap();
  assert.equal(await page.locator('#modal-cancel-btn').evaluate(el=>el===document.activeElement),true);
  assert.equal(await page.locator('#modal-confirm-btn').isEnabled(),false);
  assert.match(await page.getByRole('dialog').innerText(),/台1｜測試選手甲 vs 測試選手乙｜3：2/);
  // An immediate second tap/click cannot bypass disabled confirmation.
  await page.locator('#modal-confirm-btn').dispatchEvent('click');
  assert.equal(await page.evaluate(()=>executed.length),0);
  for(const width of [320,390,430,960]){
    await page.setViewportSize({width,height:900});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'confirmation overflow at '+width);
  }
  await page.locator('#court-force-exit-ack').check();
  assert.equal(await page.locator('#modal-confirm-btn').isEnabled(),true);
  await page.locator('#court-force-exit-ack').uncheck();
  assert.equal(await page.locator('#modal-confirm-btn').isEnabled(),false);
  await page.locator('#court-force-exit-ack').check();
  await page.locator('#modal-cancel-btn').tap();
  assert.equal(await page.evaluate(()=>executed.length),0);
  await page.locator('.ref-court-maintenance summary').tap();
  await page.getByRole('button',{name:'裁判台強制退場',exact:true}).tap();
  assert.equal(await page.locator('#modal-confirm-btn').isEnabled(),false,'new confirmation must require new acknowledgment');
  await page.locator('#court-force-exit-ack').check();
  await page.locator('#modal-confirm-btn').tap();
  assert.equal(await page.evaluate(()=>executed.length),1);
  assert.equal(await page.getByRole('dialog').count(),0);
  assert.equal(await page.evaluate(()=>seatWrites.length),1,'court maintenance cannot remove referee seats');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('PASS pre-draw seats, disabled scoring, retained seats, collapsed court maintenance, cancel focus, acknowledgment, touch confirmation and 320/390/430/960 layouts (isolated transport)');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
