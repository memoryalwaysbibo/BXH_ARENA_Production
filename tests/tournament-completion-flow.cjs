const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../modules/main-app/core.js'), 'utf8');
const section = (from, to) => {
  const a=source.indexOf(from), b=source.indexOf(to,a+from.length);
  assert.ok(a>=0 && b>a,from);
  return source.slice(a,b);
};
const completion = section('function tournamentCompletionKey(', '\nasync function performUnarchiveRecord');
const decided = section('function isTournamentFullyDecided(', '\nfunction buildCelebrationData');
const route = section('function settlementRouteForTournament(', '\nfunction isOwnTestTournament');
const seats = section('async function executeRefereeSeatCommand(', '\nasync function executeRefereeDispatchCommand');
const remote = section('function applyRemoteState(', '// Phase 1: tournaments connect to the cloud automatically');
function room(overrides={}) {
  return {id:'room-a',cloudCode:'BXH-TEST',meta:{formatType:'single',eventAuthority:'official',ladderMode:'general',bronzeMatch:false},
    championId:'a',runnerUpId:'b',thirdId:null,fourthId:null,players:[{id:'a'},{id:'b'}],
    matches:[{id:'final',completed:true,station:1}],archiveStatus:'ongoing',settlementPhase:'idle',...overrides};
}
function runtime(target=room()) {
  const saved=[],writes=[],awarded=new Set(); let awardCount=0,resultCount=0;
  const ctx={state:target,console,Map,Set,Date,Promise,recordIndex:[],currentRole:'admin',
    celebrationOpen:false,celebrationData:null,publicTournamentsCache:[],publicTournamentsError:null,
    historyCloudSyncLoaded:true,cloudSyncPending:false,myRegistrationsCache:null,
    ladderPublicLoaded:true,ladderAdminLogsLoaded:true,myLadderProfileCache:{},
    publicWatchReturnContext:null,canOperateCurrentTournament:()=>true,isAdminTierOrAbove:()=>true,
    isOwnTestTournament:()=>false,isTestTournament:()=>false,isSystemSyntheticTestRoster:()=>false,
    tournamentEligiblePlayers:p=>p,
    saveRecord:async s=>{saved.push(structuredClone(s));return true;},
    saveRecordDetailed:async s=>{saved.push(structuredClone(s));return {recordOk:true,indexOk:true};},
    loadIndex:async()=>[],addRecordSummaryToMemoryIndex:()=>{},
    ensureCloudAvailableForArchive:async()=>true,cloudAvailable:()=>true,
    writeArchiveStateToCloud:async s=>{writes.push(structuredClone(s));return true;},
    cloneStateForSave:s=>structuredClone(s),queueCloudSyncRetry:()=>{},showToast:()=>{},render:()=>{},
    flushCloudStateWrites:async()=>true,
    buildLadderSettlementPayload:()=>({participants:[1,2,3,4].map(placement=>({placement}))}),
    buildCelebrationData:s=>{resultCount++;return {name:s.id};},
    window:{cloudSync:{settleLadderTournament:async code=>{
      const alreadyAwarded=awarded.has(code); if(!alreadyAwarded){awarded.add(code);awardCount++;}
      return {ok:true,alreadyAwarded,seasonId:'S1',results:[],awardedAt:1};
    }}},
  };
  vm.createContext(ctx);
  vm.runInContext('const tournamentArchiveTasks=new Map();const shownTournamentResults=new Set();'+route+decided+completion,ctx);
  return {ctx,saved,writes,awards:()=>awardCount,results:()=>resultCount};
}
test('general room waits for cloud acknowledgement and retries into results once',async()=>{
  const r=runtime(); let accept=false;
  r.ctx.writeArchiveStateToCloud=async s=>{r.writes.push(structuredClone(s));return accept;};
  assert.equal(await r.ctx.finishTournament(),false);
  assert.equal(r.ctx.state.archiveStatus,'ongoing');
  assert.equal(r.ctx.state.settlementPhase,'sync-pending');
  assert.equal(r.ctx.celebrationOpen,false);
  assert.ok(r.saved.every(s=>s.archiveStatus!=='completed'));
  assert.equal(r.awards(),0);
  accept=true;
  assert.equal(await r.ctx.finishTournament(),true);
  assert.equal(r.ctx.state.archiveStatus,'completed');
  assert.equal(r.ctx.state.settlementPhase,'completed');
  assert.equal(r.ctx.celebrationOpen,true);
  r.ctx.celebrationOpen=false;
  await r.ctx.finishTournament();
  assert.equal(r.results(),1);
  assert.equal(r.ctx.celebrationOpen,false,'closing the overlay must survive duplicate completion notifications');
});
test('ranked retry reuses backend idempotency and never awards twice',async()=>{
  const target=room();target.meta.ladderMode='ranked';const r=runtime(target);
  r.ctx.writeArchiveStateToCloud=async()=>false;
  assert.equal(await r.ctx.finishTournament(),false);
  assert.equal(r.ctx.state.ladderPointsAwarded,true);
  assert.equal(r.ctx.state.archiveStatus,'ongoing');
  assert.equal(r.awards(),1);
  r.ctx.writeArchiveStateToCloud=async()=>true;
  assert.equal(await r.ctx.finishTournament(),true);
  assert.equal(r.awards(),1);
  assert.equal(r.results(),1);
});
test('concurrent completion calls share a cloud archive and one results overlay',async()=>{
  const r=runtime();let release;
  r.ctx.writeArchiveStateToCloud=async s=>{r.writes.push(s);return new Promise(resolve=>{release=resolve;});};
  const one=r.ctx.finishTournament(),two=r.ctx.finishTournament();
  while(!release) await Promise.resolve();
  assert.equal(r.writes.length,1);
  release(true);
  assert.deepEqual(await Promise.all([one,two]),[true,true]);
  assert.equal(r.results(),1);
});
test('navigation during archive cannot complete the next room or open the old overlay',async()=>{
  const r=runtime();const original=r.ctx.state;let release;
  r.ctx.writeArchiveStateToCloud=async()=>new Promise(resolve=>{release=resolve;});
  const work=r.ctx.finishTournament();while(!release)await Promise.resolve();
  r.ctx.state=room({id:'room-b',cloudCode:'BXH-NEXT',championId:null,runnerUpId:null});
  release(true);assert.equal(await work,true);
  assert.equal(original.archiveStatus,'completed');
  assert.equal(r.ctx.state.archiveStatus,'ongoing');
  assert.equal(r.ctx.celebrationOpen,false);
});
test('a changed same-room result cannot inherit a pending older result overlay',async()=>{
  const r=runtime();let release;
  r.ctx.writeArchiveStateToCloud=async()=>new Promise(resolve=>{release=resolve;});
  const work=r.ctx.finishTournament();while(!release)await Promise.resolve();
  r.ctx.state=room({championId:'b',runnerUpId:'a'});
  release(true);assert.equal(await work,false);
  assert.equal(r.ctx.state.archiveStatus,'ongoing');
  assert.equal(r.ctx.celebrationOpen,false);
});
test('enabled bronze match must finish in both general and ranked rooms',async()=>{
  for(const ladderMode of ['general','ranked']){
    const target=room({players:['a','b','c','d'].map(id=>({id}))});target.meta={...target.meta,bronzeMatch:true,ladderMode};const r=runtime(target);
    assert.equal(await r.ctx.performAutoArchive(),false);
    assert.equal(r.ctx.state.settlementErrorCode,'incomplete-placements');
    assert.equal(r.writes.length,0);assert.equal(r.awards(),0);
  }
});
test('two- and three-player finals do not require a nonexistent fourth-place player',async()=>{
  for(const count of [2,3]){
    const target=room({players:['a','b','c'].slice(0,count).map(id=>({id})),thirdId:count===3?'c':null});
    target.meta.bronzeMatch=true;const r=runtime(target);
    assert.equal(await r.ctx.finishTournament(),true);
    assert.equal(r.results(),1);
  }
});
test('public-watch mode cannot archive even when the account has management access',async()=>{
  const r=runtime();r.ctx.publicWatchReturnContext='guest-lobby';
  assert.equal(await r.ctx.finishTournament(),false);
  assert.equal(r.writes.length,0);
});
test('a player operating their own community room can complete it',async()=>{
  const target=room();target.meta.eventAuthority='community';const r=runtime(target);
  r.ctx.currentRole='player';
  assert.equal(await r.ctx.finishTournament(),true);
  assert.equal(r.awards(),0);
});
test('cloud success remains completed when the local cache is full',async()=>{
  const r=runtime();r.ctx.saveRecordDetailed=async()=>({recordOk:false,indexOk:false});
  assert.equal(await r.ctx.finishTournament(),true);
  assert.equal(r.ctx.state.archiveStatus,'completed');
  assert.equal(r.results(),1);
});
test('local-only storage failure does not show final results',async()=>{
  const r=runtime(room({cloudCode:null}));
  r.ctx.saveRecordDetailed=async()=>({recordOk:false,indexOk:false});
  assert.equal(await r.ctx.finishTournament(),false);
  assert.equal(r.ctx.state.archiveStatus,'ongoing');
  assert.equal(r.ctx.state.settlementPhase,'failed');
  assert.equal(r.results(),0);
});
test('persisted celebrationShown from another device does not suppress this browser',async()=>{
  const r=runtime(room({celebrationShown:true}));
  assert.equal(await r.ctx.finishTournament(),true);
  assert.equal(r.results(),1);
});
test('spectators cannot initiate archive writes',async()=>{
  const r=runtime();r.ctx.currentRole='guest';
  assert.equal(await r.ctx.finishTournament(),false);
  assert.equal(r.writes.length,0);
});
test('another device completing the final triggers local results after archive acknowledgement',async()=>{
  const r=runtime(room({championId:null,runnerUpId:null,updatedAt:1}));
  Object.assign(r.ctx,{remoteAppliedRoomId:'room-a',remoteAppliedAt:0,
    courtSwapDraft:null,refereeAssignmentDraftEnabled:null,cloudLastSyncAt:0,
    defaultState:()=>room(),isCommunityQuickRegistration:()=>false,reconcileCourtAssignments:()=>{}});
  vm.runInContext(remote,r.ctx);
  r.ctx.applyRemoteState(room({updatedAt:2}),true);
  await r.ctx.finishTournament();
  assert.equal(r.ctx.state.archiveStatus,'completed');
  assert.equal(r.ctx.celebrationOpen,true);
  assert.equal(r.results(),1);
});
test('failed cloud connection never falls through to local-only success for a cloud room',async()=>{
  const r=runtime();r.ctx.ensureCloudAvailableForArchive=async()=>false;
  assert.equal(await r.ctx.finishTournament(),false);
  assert.equal(r.ctx.state.archiveStatus,'ongoing');
  assert.equal(r.ctx.state.settlementPhase,'sync-pending');
  assert.equal(r.writes.length,0);
});
test('a cloud archive exception retains pending state and permits a later retry',async()=>{
  const r=runtime();r.ctx.console={warn:()=>{}};
  r.ctx.writeArchiveStateToCloud=async()=>{throw Error('disconnected');};
  assert.equal(await r.ctx.finishTournament(),false);
  assert.equal(r.ctx.state.settlementPhase,'sync-pending');
  r.ctx.writeArchiveStateToCloud=async()=>true;
  assert.equal(await r.ctx.finishTournament(),true);
  assert.equal(r.results(),1);
});
test('three-seat scored and quick confirmations both reach the shared completion path',async()=>{
  for(const action of ['confirm','quick']){
    const target=room();target.meta.refereeSeatsV1={version:1,courts:{1:{revision:1}}};const r=runtime(target);
    Object.assign(r.ctx,{currentAuthUid:()=> 'judge',getMatch:id=>r.ctx.state.matches.find(m=>m.id===id),
      requireStationPermission:()=>true,navigator:{onLine:true},crypto:{randomUUID:()=> 'op'},
      pendingModal:{},cloudStatus:'connected',cloudLastSyncAt:0,
      applyRemoteState:s=>{r.ctx.state=s;},checkWinnerSide:()=>null});
    r.ctx.window.cloudSync.commitRefereeCommand=async()=>({ok:true,state:structuredClone(target)});
    vm.runInContext('const refereeSeatCommandBusy=new Set();'+seats,r.ctx);
    assert.equal(await r.ctx.executeRefereeSeatCommand('final',{action}),true);
    assert.equal(r.ctx.state.archiveStatus,'completed');assert.equal(r.results(),1);
  }
});
