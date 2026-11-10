'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const {chromium}=require('playwright');

const core=fs.readFileSync('modules/main-app/core.js','utf8');
function section(from,to){
 const start=core.indexOf(from),end=core.indexOf(to,start+from.length);
 assert(start>=0&&end>start,from);
 return core.slice(start,end);
}

(async()=>{
 const server=http.createServer((_,response)=>response.end('<!doctype html><meta charset="utf-8"><main></main><p id="notice"></p>'));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try{
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage();
  const initial={id:'fixture-room',cloudCode:'BXH-PILOT',meta:{formatType:'single',battleMode:'individual',stations:12},
   players:[{id:'a',checkedIn:true},{id:'b',checkedIn:true}],matches:[],registrationRosterRevision:2};
  let remote=structuredClone(initial),publicReadStale=false;
  const calls=[],receipts=new Map();
  await page.exposeFunction('fixtureRead',()=>{
   const data=structuredClone(remote),publicData=structuredClone(remote);
   delete publicData.bracketDraw;
   if(publicReadStale)delete publicData.startedAt;
   return {ok:true,data,publicData};
  });
  await page.exposeFunction('fixtureSend',(kind,data)=>{
   calls.push({kind,data});
   if(receipts.has(data.operationId))return receipts.get(data.operationId);
   if(kind==='draw'){
    remote={...remote,bracketSize:2,drawnAt:500,bracketDraw:{id:'server-draw',revision:1},
     matches:[{id:'server-match',bracket:'SE',round:0,indexInRound:0,a:{playerId:'a'},b:{playerId:'b'}}]};
    receipts.set(data.operationId,{ok:true,drawId:'server-draw',revision:1});
   }else{
    remote={...remote,startedAt:900};receipts.set(data.operationId,{ok:true,drawId:'server-draw',startedAt:900});
   }
   throw Error('response-lost-after-commit');
  });
  const url='http://127.0.0.1:'+server.address().port;
  async function load(state){
   await page.goto(url);
   await page.addScriptTag({content:fs.readFileSync('modules/main-app/bracket-commit.js','utf8')});
   await page.addScriptTag({content:`
    let state=${JSON.stringify(state)},firebaseUser={uid:'manager'},activeTab='people',currentRole='admin',appPhase='app';
    let bracketCommitContext=null,adminOperationalFailure=null,adminOperationalOverrideBusy=false,pendingModal;
    let publicTournamentsCache,myRegistrationsCache;
    window.BXH_REGISTRATION_LIFECYCLE_V2_ROOMS=['BXH-PILOT','BXH-OTHER'];
    window.cloudSync={commitRegistrationLifecycle:fixtureSend,readBracketFromServer:fixtureRead};
    const canOfferAdminOperationalOverride=()=>false,adminOverrideButtonsHtml=()=>'',entryRosterValid=()=>true;
    const canOperateCurrentTournament=()=>true,bracketRosterIsCurrent=()=>true,eligiblePlayers=()=>state.players;
    const syncLatestOnlineRosterBeforeLock=async()=>({ok:true}),scheduledTournamentStartMs=()=>null;
    const saveRecord=async()=>true,resetAdminRegistrationsCache=()=>{},esc=String;
    const saveState=()=>{throw Error('unexpected-browser-write');};
    const BATTLE_MODE_LABELS={},FORMAT_LABELS={},PLAY_MODE_LABELS={};
    function openModal(value){pendingModal=value;render();}
    function showToast(value){document.querySelector('#notice').textContent=value;}
    function renderPreservingScroll(){render();}
    ${section('function bracketCommitController(){','function currentRoundLabelForBoard(){')}
    function handle(action){
     ${section('  if(action==="start-tournament"){','  if(action==="reset-bracket"){')}
     ${section('  if(action==="draw-bracket"){','  if(action==="view-changelog"){')}
    }
    function render(){document.querySelector('main').innerHTML=bracketCommitStatusHtml()+bracketDrawButtonHtml()+
     '<button data-action="start-tournament" '+(bracketCommitBlocked()?'disabled':'')+'>開始賽事</button>'+
     (pendingModal?'<section role="dialog"><button data-action="confirm">'+pendingModal.confirmLabel+'</button></section>':'');}
    document.addEventListener('click',event=>{
     const action=event.target.dataset.action;
     if(action==='confirm'){const modal=pendingModal;pendingModal=null;void modal.onConfirm();render();}
     else if(action==='bracket-commit-submit')void bracketCommitController().submit();
     else handle(action);
    });
    window.fixtureView=()=>({state,activeTab});
    window.fixtureSwitch=()=>{state={...state,id:'other-room',cloudCode:'BXH-OTHER'};render();};
    render();
   `});
  }
  await load(initial);
  await page.getByRole('button',{name:'抽籤',exact:true}).click();
  await page.getByText('儲存結果尚未確認',{exact:true}).waitFor();
  assert.equal((await page.evaluate(()=>fixtureView())).state.matches.length,0);
  await load(initial);
  await page.getByRole('button',{name:'重試上傳'}).click();
  await page.locator('#notice').getByText('上傳成功').waitFor();
  assert.deepEqual(calls[0],calls[1]);
  await page.getByRole('button',{name:'開始賽事',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'確認賽事開始'}).waitFor();
  await page.evaluate(()=>fixtureSwitch());
  await page.getByRole('dialog').getByRole('button',{name:'確認賽事開始'}).click();
  assert.equal(calls.length,2,'confirmation must not start a different room');
  await load(remote);
  await page.getByRole('button',{name:'開始賽事',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'確認賽事開始'}).click();
  await page.getByText('開賽結果尚未確認',{exact:true}).waitFor();
  assert.equal((await page.evaluate(()=>fixtureView())).state.startedAt,undefined);
  publicReadStale=true;
  await page.getByRole('button',{name:'重試確認開賽'}).click();
  await page.getByText('開賽結果尚未確認',{exact:true}).waitFor();
  assert.equal((await page.evaluate(()=>fixtureView())).activeTab,'people');
  publicReadStale=false;
  await page.getByRole('button',{name:'重試確認開賽'}).click();
  await page.locator('#notice').getByText(/賽事正式開始/).waitFor();
  assert.deepEqual(calls[2],calls[3]);assert.deepEqual(calls[3],calls[4]);
  assert.equal((await page.evaluate(()=>fixtureView())).activeTab,'referee');
  assert.equal(receipts.size,2);
  console.log('PASS V2 management buttons, reload recovery and matching public/private start readback');
 }finally{await browser?.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
