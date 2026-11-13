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
const productionFunctions=['canUseRefereeSyncRecovery','refereeSyncRecoveryControlsHtml','refereeWorkstationHeader','refereeSwapControl','renderRefereeScorePanel','refereeWaitingControls','renderWaitingRefereeCourt','courtForceExitConfirmation','renderModal','openModal','closeModal'].map(fn).join('\n');
const courtView=core.slice(core.indexOf('let refereeCourtView='),core.indexOf('/* ==== tab: settings ==== */'));
const stableView=core.slice(core.indexOf('let refereeTemplates='),core.indexOf('function renderApp()'));
const selectStart=core.indexOf('  if(action==="referee-select-court"){');
const selectEnd=core.indexOf('  if(action==="jump-to-court"){',selectStart);
assert(selectStart>0&&selectEnd>selectStart);
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
    var appPhase='app',activeTab='referee',communityRoomActiveTab='referee',judgeUid='judge';
    var focusLab=false,restricted=false,allowed=true;
    const currentAuthUid=()=>judgeUid;
    var state={id:'fixture',cloudCode:'BXH-TEST',meta:{stations:6,refereeSeatsV1:{version:1,revision:1,courts:{},requests:{}}},matches:[],bracketSize:0};
    var pendingModal=null,courtRetirementBusy=false,executed=[],seatWrites=[],toasts=[];
    const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const refereeStageLabel=()=> '第一輪',canOperateCurrentTournament=()=>false,isCommunityRoomOwner=()=>false,refereeBracketRoundtripNav=()=>'',courtAtmosphereStyle=()=>'',refereeDisplayForStation=()=> '測試裁判',refereeStationStatus=()=>({label:'等待中',cls:'waiting'}),stationCompletedCount=()=>0,refereeStationRestrictionEnabled=()=>true,canForceExitCourt=()=>true,canManageCourtRetirement=()=>true;
    const POINT_LABELS={spin:'旋轉',knockout:'擊飛',burst:'爆裂',extreme:'極限'},canOperateStation=n=>!restricted||(n===1&&allowed),checkWinnerSide=()=>null,refereeUploadPending=()=>false,refereeUploadStatusHtml=()=>'<div class="ref-upload-status"></div>',refereeFaultWritePending=()=>false,refereeFaultCount=()=>0,refereeFaultLast=()=>null,refereeViewClass=()=>'',refereeCourtSwapButton=()=>'',matchStatusBarHtml=()=> '準備中';
    const playerName=id=>({a:'測試選手甲',b:'測試選手乙'})[id]||id,showToast=m=>toasts.push(m),executeCourtForceAction=change=>executed.push(change),shouldBindLobbyInput=()=>true;
    ${productionFunctions}
    ${courtView}
    ${stableView}
    const refereeMatches=()=>state.matches;
    const renderForcedCourtExitPanel=()=>'',renderCourtRetirementPanel=()=>'',renderSkippedMatches=()=>'';
    function renderCourtCard(n){
      const match=state.matches[n-1];
      return '<div id="court-card-'+n+'" class="panel court-card referee-workstation">'+refereeWorkstationHeader(match,n)+renderRefereeScorePanel(match,n)+'</div>';
    }
    function handleAction(action,target){
      ${core.slice(selectStart,selectEnd)}
      if(action==='modal-cancel'){closeModal();return;}
      ${core.slice(confirmStart,confirmEnd)}
    function bindConfirmation(){${core.slice(ackStart,ackEnd)}}
    function render(){
      BXHRefereeSeats.bind({state:()=>state,uid:()=>'judge',eligible:()=>true,operator:()=>true,manager:()=>true,render,toast:showToast});
      if(focusLab){renderRefereeCourtView(document.getElementById('app'),'<main>'+renderReferee()+'</main>'+renderModal());return;}
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
    document.addEventListener('click',event=>{
      const target=event.target.closest('[data-action="referee-select-court"]');
      if(target)handleAction('referee-select-court',target);
    });
    render();
  `});
  assert.deepEqual(errors,[],'pre-draw renderer must initialize without page errors');
  assert.equal(await page.locator('.ref-seat-button').count(),18);
  assert.equal(await page.locator('.referee-workstation-waiting .ref-vs-arena button:not(:disabled),.referee-workstation-waiting .ref-result-actions button:not(:disabled)').count(),0);
  await page.locator('[data-station="1"][data-slot="main"]').tap();
  await page.waitForFunction(()=>state.meta.refereeSeatsV1.courts[1]?.main?.uid==='judge');
  assert.equal(await page.locator('.ref-seat-button.mine').count(),1);
  assert.equal(await page.locator('.referee-workstation-waiting .ref-vs-arena button:not(:disabled),.referee-workstation-waiting .ref-result-actions button:not(:disabled)').count(),0);
  for(const width of [320,390,430,960]){
    await page.setViewportSize({width,height:900});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'pre-draw overflow at '+width);
  }
  await page.evaluate(()=>{state.meta.stations=12;render();});
  assert.equal(await page.locator('.ref-seat-button').count(),36);
  assert.equal(await page.locator('.ref-vs-arena.standard').count(),12);
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
  // Compare real rendered geometry, not just markup: waiting and normal panels
  // must keep the same player, score, button, swap and result-action dimensions.
  await page.evaluate(()=>{
    window.showNormalPanel=false;
    window.drawComparison=()=>{
      const match={id:'fixture-match',a:{playerId:'a'},b:{playerId:'b'},scoreA:0,scoreB:0,log:[],status:'ready'};
      document.getElementById('app').innerHTML='<div class="court-grid court-grid-1">'+(showNormalPanel?'<div class="panel court-card referee-workstation">'+refereeWorkstationHeader(null,1)+renderRefereeScorePanel(match,1)+'</div>':renderWaitingRefereeCourt(1))+'</div>';
    };
    state.startedAt=1;drawComparison();
  });
  const geometry=()=>page.evaluate(()=>{
    const origin=document.querySelector('.ref-vs-arena').getBoundingClientRect();
    return [...document.querySelectorAll('.side-panel,.side-name,.side-score,.score-btns,.score-btns button,.ref-swap,.ref-result-actions,.ref-result-actions button')].map(el=>{
      const r=el.getBoundingClientRect();return {className:el.className,x:r.x-origin.x,y:r.y-origin.y,width:r.width,height:r.height};
    });
  });
  for(const width of [320,390,430,960]){
    await page.setViewportSize({width,height:1000});
    await page.evaluate(()=>{showNormalPanel=false;drawComparison();});
    const waiting=await geometry();
    assert.equal(await page.locator('.ref-vs-arena button:not(:disabled),.ref-result-actions button:not(:disabled)').count(),0);
    assert.equal(await page.locator('.ref-seat-button:not(:disabled)').count(),3);
    assert.match(await page.locator('.ref-vs-arena').evaluate(el=>getComputedStyle(el).filter),/grayscale/);
    await page.evaluate(()=>{showNormalPanel=true;drawComparison();});
    assert.deepEqual(await geometry(),waiting,'normal and gray waiting geometry at '+width);
    assert.equal(await page.locator('[data-action="score"]:not(:disabled)').count(),8);
    assert.equal(await page.locator('.ref-vs-arena').evaluate(el=>getComputedStyle(el).filter),'none');
  }
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{
    focusLab=true;restricted=true;
    state.courtAssignments=Object.fromEntries(Array.from({length:12},(_,i)=>['court'+(i+1),{}]));
    state.matches=Array.from({length:12},(_,i)=>({id:'m'+i,a:{playerId:'a'},b:{playerId:'b'},scoreA:0,scoreB:0,log:[],status:'ready'}));
    render();
  });
  const selector=page.getByRole('group',{name:'切換裁判台'});
  await selector.getByRole('button',{name:'台1',exact:true}).tap();
  assert.equal(await page.locator('.referee-workstation').count(),1);
  assert.equal(await selector.getByRole('button',{name:'台1',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#court-card-1 [data-action="score"]:not(:disabled)').count(),8);
  const stable=await page.evaluate(()=>{
    const court=document.getElementById('court-card-1'),score=court.querySelector('[data-action="score"]');
    score.focus();
    const observer=new MutationObserver(()=>{});
    observer.observe(court,{attributes:true,childList:true,characterData:true,subtree:true});
    for(let i=0;i<24;i++){state.matches[1].scoreA=i;render();}
    const result={same:court===document.getElementById('court-card-1'),focused:document.activeElement===score,mutations:observer.takeRecords().length};
    observer.disconnect();
    return result;
  });
  assert.deepEqual(stable,{same:true,focused:true,mutations:0});
  await page.evaluate(()=>{state.matches[0].scoreA=2;render();});
  assert.equal(await page.locator('#court-card-1 .side-score').first().textContent(),'2');
  await page.evaluate(()=>{allowed=false;render();});
  assert.equal(await page.locator('#court-card-1 [data-action="score"]:not(:disabled)').count(),0);
  await selector.getByRole('button',{name:'台2',exact:true}).tap();
  assert.equal(await page.locator('.referee-workstation').count(),1);
  assert.equal(await page.locator('#court-card-2 [data-action="score"]:not(:disabled)').count(),0);
  await selector.getByRole('button',{name:'全部台',exact:true}).tap();
  assert.equal(await page.locator('.referee-workstation').count(),12);
  await page.evaluate(()=>{appPhase='community-room';render();});
  await selector.getByRole('button',{name:'台3',exact:true}).tap();
  assert.equal(await page.locator('#court-card-3').count(),1);
  assert.equal(await page.locator('.referee-workstation').count(),1);
  await page.evaluate(()=>{judgeUid='different-user';render();});
  assert.equal(await page.locator('.referee-workstation').count(),12);
  await selector.getByRole('button',{name:'台4',exact:true}).tap();
  await page.evaluate(()=>{state.cloudCode='BXH-OTHER';render();});
  assert.equal(await page.locator('.referee-workstation').count(),12);
  console.log('PASS single court selection, 12-court overview, score and permission updates, and zero selected-court DOM mutations from other-court scores');

  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('PASS pre-draw seats, disabled scoring, retained seats, collapsed court maintenance, cancel focus, acknowledgment, touch confirmation and 320/390/430/960 layouts (isolated transport)');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
