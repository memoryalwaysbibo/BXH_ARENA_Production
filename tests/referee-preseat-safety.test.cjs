'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../modules/main-app/core.js'),'utf8');
const seats=require('../referee-seats/functions/core.cjs');
function fn(name){const start=source.indexOf('function '+name+'(');assert(start>=0);const end=source.indexOf('\nfunction ',start+1);return source.slice(start,end<0?undefined:end);}
function fixture(){
 const c={state:{id:'test',cloudCode:'BXH-TEST',meta:{stations:6},bracketSize:0,matches:[]},pendingModal:null,courtRetirementBusy:false,
  window:{BXHRefereeSeats:{render:(st,n)=>`<button data-seat-action="seat" data-station="${n}">加入裁判席</button>`}},
  esc:v=>String(v??'').replace(/[<>&"']/g,''),refereeBracketRoundtripNav:()=>'',courtAtmosphereStyle:()=>'',
  refereeDisplayForStation:()=> '測試裁判',refereeStationStatus:()=>({label:'等待中',cls:'waiting'}),
  stationCompletedCount:()=>0,refereeStationRestrictionEnabled:()=>true,canForceExitCourt:()=>true,canManageCourtRetirement:()=>true,
  playerName:id=>({a:'選手甲',b:'選手乙'})[id]||id,executed:[],toasts:[],render:()=>{},document:{getElementById:()=>({focus(){c.focused=true;}})}};
 c.executeCourtForceAction=change=>c.executed.push(change);c.showToast=m=>c.toasts.push(m);
 vm.createContext(c);
 for(const name of ['refereeWorkstationHeader','refereeWaitingControls','renderWaitingRefereeCourt','renderReferee','courtForceExitConfirmation','renderModal','openModal','closeModal'])vm.runInContext(fn(name),c);
 return c;
}
test('6 and 12 pre-draw courts render seats outside disabled scoring, without mutating state',()=>{
 const c=fixture();
 for(const n of [1,6,12]){
  c.state.meta.stations=n;const before=JSON.stringify(c.state),html=c.renderReferee();
  assert.equal((html.match(/data-seat-action="seat"/g)||[]).length,n);
  assert.equal((html.match(/<fieldset disabled/g)||[]).length,n);
  for(const card of html.split('<fieldset disabled').slice(1))assert(!card.split('</fieldset>')[0].includes('data-seat-action'));
  assert(!html.includes('data-action="score"'));assert(!html.includes('court-force-exit'));
  assert.equal(JSON.stringify(c.state),before);
 }
});
test('court force-exit is hidden inside a collapsed maintenance menu',()=>{
 const c=fixture();c.state.bracketSize=4;
 const html=c.refereeWorkstationHeader(null,2);
 assert.match(html,/<details class="ref-court-maintenance"><summary>更多操作<\/summary>/);
 assert(!html.includes('<details open'));assert.match(html,/裁判台強制退場/);
 c.state.archiveStatus='completed';assert(!c.refereeWorkstationHeader(null,2).includes('court-force-exit'));
});
test('confirmation identifies court, players and score, requires acknowledgment and focuses cancel',()=>{
 const c=fixture(),change={kind:'force-exit',station:2,matchId:'m',revision:3,exitRevision:0};
 const cfg=c.courtForceExitConfirmation(change,{a:{playerId:'a'},b:{playerId:'b'},scoreA:3,scoreB:2});
 assert.match(cfg.message,/台2｜選手甲 vs 選手乙｜3：2/);assert.match(cfg.message,/停止接收賽事自動指派／編排/);
 c.openModal(cfg);assert(c.focused);
 assert.match(c.renderModal(),/id="modal-confirm-btn"[^>]*disabled/);
 cfg.acknowledged=true;assert(!/id="modal-confirm-btn"[^>]*disabled/.test(c.renderModal()));
 cfg.acknowledged=false;assert.match(c.renderModal(),/id="modal-confirm-btn"[^>]*disabled/);
 const start=source.indexOf('  if(action==="modal-confirm"){',source.indexOf('function handleAction('));
 const end=source.indexOf('// v13.14.2',start);
 vm.runInContext('function confirmOnly(action){\n'+source.slice(start,end),c);
 c.confirmOnly('modal-confirm');assert.equal(c.executed.length,0,'unacknowledged event cannot execute');
 cfg.acknowledged=true;c.confirmOnly('modal-confirm');assert.equal(c.executed.length,1);
 c.confirmOnly('modal-confirm');assert.equal(c.executed.length,1,'repeat event cannot execute twice');
});
test('switching rooms while confirmation is open cannot stop another court',()=>{
 const c=fixture(),cfg=c.courtForceExitConfirmation({station:1},null);c.state.id='other';cfg.onConfirm();
 assert.equal(c.executed.length,0);assert.match(c.toasts[0],/賽事已切換/);
});
test('pre-draw claims survive actual single-elimination generation',()=>{
 const c=fixture();c.state.meta={eventAuthority:'official',stations:2};c.state.players=['a','b','c','d'].map(id=>({id,checkedIn:true}));
 const room={eventAuthority:'official',createdBy:'host'},user={role:'staff',active:true,realName:'裁判甲'};
 const enable=seats.transition({room,state:c.state,user,uid:'host',d:{action:'enable'},now:1,id:'enable'});room.refereeSeatsV1=enable.model;
 const claim=seats.transition({room,state:c.state,user,uid:'host',d:{action:'claim',station:1,slot:'main',expectedCourtRevision:0},now:2,id:'claim'});
 c.state.meta.refereeSeatsV1=claim.model;Object.assign(c.state.meta,claim.projection);const before=JSON.stringify(c.state.meta);
 Object.assign(c,{eligiblePlayers:()=>c.state.players,shuffle:x=>x,nextPow2:n=>2**Math.ceil(Math.log2(n)),seedOrder:n=>Array.from({length:n},(_,i)=>i+1),uid:()=>String(Math.random()),applyChallongeSingleElimOrder:()=>{},rebuildPropagationSingle:()=>{},syncMatchStatuses:()=>{},orderedMatches:()=>c.state.matches});
 vm.runInContext(fn('generateSingleElim'),c);assert.equal(c.generateSingleElim(),true);
 assert.equal(c.state.bracketSize,4);assert.equal(JSON.stringify(c.state.meta),before);
 assert.equal(c.state.meta.refereeSeatsV1.courts[1].main.uid,'host');
});
