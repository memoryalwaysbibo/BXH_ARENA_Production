'use strict';
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const core=fs.readFileSync('modules/main-app/core.js','utf8');
const source=core.slice(core.indexOf('let refereeTemplates='),core.indexOf('function renderApp(){'));
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
 const page=await browser.newPage();await page.route('**/*',r=>r.abort());
 await page.setContent('<main id="app"></main>');
 await page.addScriptTag({content:source+`
 let scores=Array(12).fill(0),locked=false,connection='connected',match='m1',calls=0;
 function paint(){renderStableRefereeScreen(document.getElementById('app'),'<header>'+connection+'</header><section>'+scores.map((s,i)=>'<article id="court-card-'+i+'"><h2>Court '+i+'</h2><span class="score">'+s+'</span><button data-action="score" data-id="'+(i===0?match:'m'+i)+'" '+(locked?'disabled':'')+'>Score</button><input id="draft-'+i+'" value=""></article>').join('')+'</section>','room|uid');}
 document.addEventListener('click',e=>{if(e.target.matches('button')&&!e.target.disabled){calls++;scores[0]++;paint();}});paint();
 window.original=document.getElementById('court-card-0');window.button=original.querySelector('button');
 window.mutations=0;new MutationObserver(records=>{mutations+=records.length}).observe(original,{subtree:true,attributes:true,childList:true,characterData:true});
 `});
 await page.evaluate(()=>{const input=document.getElementById('draft-0');input.value='unsent';input.focus();input.dispatchEvent(new Event('input',{bubbles:true}));});
 assert.equal(await page.locator('#draft-0').inputValue(),'unsent');
 await page.evaluate(()=>{for(let n=0;n<200;n++){scores[1+n%11]++;paint();}});
 assert.equal(await page.evaluate(()=>mutations),0);
 assert.equal(await page.evaluate(()=>document.getElementById('court-card-0')===original),true);
 assert.equal(await page.locator('#draft-0').inputValue(),'unsent');assert.equal(await page.evaluate(()=>document.activeElement.id),'draft-0');
 await page.locator('#court-card-0 button').click();assert.equal(await page.evaluate(()=>calls),1);
 await page.evaluate(()=>{scores[0]--;paint();});assert.equal(await page.locator('#court-card-0 .score').textContent(),'0');
 await page.evaluate(()=>{connection='offline';paint();});assert.equal(await page.locator('header').textContent(),'offline');
 await page.evaluate(()=>{connection='connected';locked=true;paint();});assert.equal(await page.locator('#court-card-0 button').isDisabled(),true);
 await page.evaluate(()=>{locked=false;match='next';paint();});assert.equal(await page.locator('#court-card-0 button').getAttribute('data-id'),'next');assert.equal(await page.evaluate(()=>button.isConnected),false);
 assert.equal(await page.locator('#draft-0').inputValue(),'unsent');
 const scoreStart=core.indexOf('function renderRefereeScorePanel('),scoreEnd=core.indexOf('function renderSkippedMatches(',scoreStart);
 await page.addScriptTag({content:`
 var state={startedAt:1,meta:{}},pendingModal=null;
 var POINT_LABELS={spin:'Spin',knockout:'KO',burst:'Burst',extreme:'Extreme'};
 var esc=v=>String(v),playerName=id=>id,checkWinnerSide=()=>null,canOperateStation=()=>!locked;
 var refereeFaultWritePending=()=>false,refereeFaultCount=()=>0,refereeFaultLast=()=>null,refereeViewClass=()=>'',refereeCourtSwapButton=()=>'',refereeSwapControl=()=>'',matchStatusBarHtml=m=>m.status;
 ${core.slice(scoreStart,scoreEnd)}
 var matchState={id:'real-score',a:{playerId:'A'},b:{playerId:'B'},scoreA:0,scoreB:0,log:[],status:'in_progress'};
 function paintScore(){renderStableRefereeScreen(document.getElementById('app'),'<div id="score-fixture">'+renderRefereeScorePanel(matchState,1)+'</div>','score-room');}
 paintScore();window.scoreButton=document.querySelector('[data-action="score"]');
 `});
 await page.evaluate(()=>{matchState.scoreA=1;matchState.log=[{side:'A',type:'spin'}];paintScore();});
 assert.equal(await page.locator('.side-score').first().textContent(),'1');
 assert.equal(await page.evaluate(()=>scoreButton===document.querySelector('[data-action="score"]')),true);
 assert.equal(await page.locator('[data-action="undo-score"]').isDisabled(),false);
 await page.evaluate(()=>{locked=true;paintScore();});
 assert.equal(await page.locator('[data-action="score"]').first().isDisabled(),true);
 await page.evaluate(()=>{locked=false;state.startedAt=0;paintScore();});
 assert.equal(await page.locator('[data-action="score"]').first().isDisabled(),true);
 await page.evaluate(()=>{state.startedAt=1;matchState.scoreA=0;matchState.log=[];paintScore();});
 assert.equal(await page.locator('.side-score').first().textContent(),'0');
 assert.equal(await page.locator('[data-action="undo-score"]').isDisabled(),true);
 console.log('PASS production score panel: score/undo patches, preserved button identity, permission and global start locks');
 const bindStart=core.indexOf('function shouldBindLobbyInput('),bindEnd=core.indexOf('function lobbyNodeKey(',bindStart);
 const confirmStart=core.indexOf('  const modalConfirmBtn = document.getElementById("modal-confirm-btn");',core.indexOf('function bindDynamicInputs('));
 const confirmEnd=core.indexOf('  const ta = document.getElementById("player-textarea");',confirmStart);
 await page.addScriptTag({content:`
 var activeTab='referee',lobbyInputBindings=new WeakMap(),confirmed=0;
 ${core.slice(bindStart,bindEnd)}
 function handleAction(){confirmed++;}
 function bindConfirmation(){${core.slice(confirmStart,confirmEnd)}}
 for(let i=0;i<20;i++){renderStableRefereeScreen(document.getElementById('app'),'<div><button id="modal-confirm-btn">Confirm</button></div>','modal');bindConfirmation();}
 `});
 await page.locator('#modal-confirm-btn').click();
 assert.equal(await page.evaluate(()=>confirmed),1);
 console.log('PASS production confirmation binding: 20 renders retain one click handler');
 await page.addScriptTag({content:fs.readFileSync('modules/main-app/referee-seats.js','utf8')});
 await page.evaluate(()=>{
  window.seatState={cloudCode:'BXH-MOCK',meta:{refereeSeatsV1:{version:1,revision:1,courts:{},requests:{}}}};
  window.seatRenders=0;window.cloudSync={subscribeRefereeSeats:(code,cb)=>{window.receiveSeat=cb;return ()=>{};}};
  BXHRefereeSeats.bind({state:()=>seatState,uid:()=> 'judge',operator:()=>true,eligible:()=>true,render:()=>seatRenders++,toast:()=>{}});
  receiveSeat({model:structuredClone(seatState.meta.refereeSeatsV1)});
 });
 assert.equal(await page.evaluate(()=>seatRenders),0);
 await page.evaluate(()=>receiveSeat({model:{...seatState.meta.refereeSeatsV1,revision:2}}));
 assert.equal(await page.evaluate(()=>seatRenders),1);
 await page.evaluate(()=>receiveSeat({model:seatState.meta.refereeSeatsV1,projection:{refereeSeatAccessRevoked:true}}));
 assert.equal(await page.evaluate(()=>seatRenders),2);
 await page.evaluate(()=>receiveSeat({accessRevoked:true}));
 assert.equal(await page.evaluate(()=>seatRenders),3);
 console.log('PASS duplicate/new seat revision and equal-revision permission projection; access revoked always rendered');
 console.log('PASS 12 courts / 200 other-court updates: zero local DOM mutations; focus/draft, score/undo, disconnect/recovery, lock and action identity');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
