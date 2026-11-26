'use strict';
const assert=require('node:assert/strict');require('../modules/main-app/court-retirement.js');
const api=globalThis.BXHCourtRetirement;
function room(){return {meta:{stations:12},matches:Array.from({length:24},(_,i)=>({id:'m'+i,seq:i,station:i%12+1,status:i<12?'in_progress':'ready',a:{playerId:'A'+i},b:{playerId:'B'+i},scoreA:0,scoreB:0,log:[],completed:false,dispatchRevision:0})),courtAssignments:Object.fromEntries(Array.from({length:12},(_,i)=>['court'+(i+1),{currentMatchId:'m'+i,nextMatchId:'m'+(i+12)}]))};}
const st=room();st.matches[9].scoreA=3;st.matches[9].log=[{side:'A',points:3}];
const pass=st.matches[21];pass.skippedAt=100;pass.callPass={waitFor:['m13','m14']};pass.skipWaitFor=['m13','m14'];
assert(api.request(st,8,12,200).ok);assert.equal(api.target(st),8);assert.equal(st.meta.stations,12);assert.equal(st.matches[9].station,10);assert.equal(st.matches[9].scoreA,3);assert.deepEqual(pass.callPass.waitFor,['m13','m14']);assert(pass.station<=8);
for(const m of st.matches.filter(m=>m.station>8&&!m.completed))assert(st.courtRetirementPlan.courts[m.station].holdIds.includes(m.id));
const restored=JSON.parse(JSON.stringify(st));api.reconcile(restored,300);assert.deepEqual(restored,st,'reload is idempotent');
assert.equal(api.transfer(st,'m9',9,0).reason,'target-retiring');assert.equal(api.transfer(st,'m9',1,3).reason,'dispatch-stale');
st.matches[9].offlinePendingSync=true;assert.equal(api.transfer(st,'m9',1,0).reason,'offline-sync-pending');delete st.matches[9].offlinePendingSync;
assert(api.transfer(st,'m9',1,0,400).ok);assert.equal(st.matches[9].scoreA,3);assert.equal(st.matches[9].log.length,1);assert.equal(st.courtAssignments.court1.currentMatchId,'m0','busy destination keeps its active work');assert.equal(st.matches[9].dispatchRevision,1);assert.equal(api.transfer(st,'m9',1,0).reason,'not-retiring');
assert.equal(api.request(st,4,12).reason,'court-plan-stale');
for(const m of st.matches)if(m.station>8)m.completed=true;api.reconcile(st,500);assert.equal(st.meta.stations,8);assert.equal(st.courtRetirementPlan.status,'completed');
assert(api.request(st,12,8,600).ok);assert.equal(st.meta.stations,12);assert(api.accepts(st,12));
assert(api.request(st,1,12,700).ok);for(const m of st.matches)if(m.station>1)m.completed=true;api.reconcile(st,800);assert.equal(st.meta.stations,1);assert(st.matches.every(m=>m.completed||m.station===1));
assert.equal(api.request(st,0).reason,'invalid-court-count');assert.equal(api.request(st,33).reason,'invalid-court-count');
console.log('PASS safe retirement, preserved live scores/PASS, reload, stale requests, offline hold, transfer, expansion and 12→8→1');

const emergency=room();emergency.currentMatchId='m9';emergency.courtAssignments.court10={currentMatchId:'m9',nextMatchId:'m21',lockedBy:'stale-device',lockedAt:1};
const e=emergency.matches[9];e.station=10;e.scoreA=3;e.log=[{type:'extreme',points:3}];
assert.equal(api.forceExit(emergency,10,'m0',0,0).reason,'current-match-changed');
assert.equal(api.forceExit(emergency,10,'m9',2,0).reason,'dispatch-stale');
assert(api.forceExit(emergency,10,'m9',0,0,900).ok);
assert.equal(emergency.matches[21].dispatchRevision,1);assert.equal(e.station,0);assert.equal(e.status,'paused');assert.equal(e.scoreA,3);assert.equal(e.log.length,1);assert.equal(e.dispatchRevision,1);assert.equal(emergency.currentMatchId,null);
assert.equal(emergency.courtAssignments.court10.currentMatchId,null);assert.equal(emergency.courtAssignments.court10.nextMatchId,null);assert.equal(emergency.courtAssignments.court10.lockedBy,null);assert(!api.accepts(emergency,10));
const emergencyRestored=JSON.parse(JSON.stringify(emergency));api.reconcile(emergencyRestored,901);assert.equal(emergencyRestored.matches[9].station,0);assert(emergencyRestored.forcedCourtExits[10].closed);
assert.equal(api.claimDetached(emergencyRestored,'m9',10,1).reason,'target-retiring');assert.equal(api.claimDetached(emergencyRestored,'m9',1,0).reason,'dispatch-stale');
assert(api.claimDetached(emergencyRestored,'m9',1,1,902).ok);assert.equal(emergencyRestored.matches[9].scoreA,3);assert.equal(emergencyRestored.courtAssignments.court1.currentMatchId,'m0');assert.equal(emergencyRestored.matches[9].dispatchRevision,2);
assert.equal(api.reopen(emergencyRestored,10,0).reason,'court-exit-stale');assert(api.reopen(emergencyRestored,10,1,903).ok);assert(api.accepts(emergencyRestored,10));assert.equal(emergencyRestored.matches[9].station,1);
const finished=room();finished.matches[0].completed=true;finished.matches[0].winnerId='winner';finished.courtAssignments.court1.currentMatchId='m0';assert(api.forceExit(finished,1,'m0',0,0).ok);assert.equal(finished.matches[0].winnerId,'winner');assert.equal(finished.matches[0].station,1);assert(finished.matches[0].completed);
const last=room();last.meta.stations=1;last.courtAssignments.court1.currentMatchId='m0';assert(api.forceExit(last,1,'m0',0,0).ok);assert.equal(last.matches[0].station,0);assert(!api.accepts(last,1));assert(api.reopen(last,1,1).ok);assert.equal(last.matches[0].station,0);
console.log('PASS forced exit, all assignment/lock release, score preservation, stale action, completed result, last court, reload, reopen and takeover');
// A faster local clock must not hide an authoritative emergency exit.
const vm=require('node:vm'),fs=require('node:fs');
const core=fs.readFileSync(require('node:path').join(__dirname,'../modules/main-app/core.js'),'utf8');
const remoteFn=core.slice(core.indexOf('function applyRemoteState('),core.indexOf('// Phase 1: tournaments connect to the cloud automatically'));
const ctx={state:{id:'clock-room',cloudCode:'BXH-CLOCK',updatedAt:999999},remoteAppliedRoomId:'clock-room',remoteAppliedAt:999999,courtSwapDraft:null,refereeAssignmentDraftEnabled:null,cloudLastSyncAt:0,defaultState:id=>({id}),saveRecord:()=>{},render:()=>{},renderPreservingScroll:()=>{},isCommunityQuickRegistration:()=>false,isTournamentFullyDecided:()=>false,finishTournament:async()=>false};vm.createContext(ctx);vm.runInContext(remoteFn,ctx);
ctx.applyRemoteState({id:'clock-room',updatedAt:10,forcedCourtExits:{1:{closed:true,revision:1}}});assert.equal(ctx.state.forcedCourtExits[1].closed,true);
ctx.applyRemoteState({id:'clock-room',updatedAt:9999999});assert.equal(ctx.state.forcedCourtExits[1].revision,1);
ctx.applyRemoteState({id:'clock-room',updatedAt:11,forcedCourtExits:{1:{closed:false,revision:2}}});assert.equal(ctx.state.forcedCourtExits[1].closed,false);
ctx.applyRemoteState({id:'clock-room',updatedAt:99999999,forcedCourtExits:{1:{closed:true,revision:1}}});assert.equal(ctx.state.forcedCourtExits[1].revision,2);
console.log('PASS emergency exit listener over clock skew and delayed snapshots');

// One physical-count contract covers official, community and ticket seat models.
for(const eventAuthority of ['official','community','ticket']){
 const model={version:1,revision:7,courts:{1:{revision:3,main:{uid:'keep',name:'保留'},backup1:null,backup2:null},5:{revision:4,main:{uid:'remove',name:'退出'},backup1:null,backup2:null},6:{revision:2,main:null,backup1:{uid:'still-playing',name:'進行中'},backup2:null}},requests:{qr:{id:'qr',kind:'qr',station:5,status:'pending',expiresAt:1000},mail:{id:'mail',kind:'invite',station:6,status:'pending',expiresAt:1000},keep:{id:'keep',station:1,status:'pending',expiresAt:1000}}};
 const st={meta:{stations:6,eventAuthority},startedAt:1,matches:[{id:'active',station:6,status:'in_progress',scoreA:2,log:[{points:2}],completed:false}],courtAssignments:{court6:{currentMatchId:'active'}}};
 assert(api.request(st,4,6,10).ok);assert.equal(st.meta.stations,6);
 assert.equal(api.reconcileSeatCount(model,st.meta.stations,10).changed,false);
 assert(api.forceExit(st,6,'active',0,0,20).ok);assert.equal(st.matches[0].scoreA,2);assert.equal(st.matches[0].station,0);assert.equal(st.meta.stations,4);
 const cleaned=api.reconcileSeatCount(model,st.meta.stations,20);
 assert.equal(cleaned.changed,true);assert.equal(cleaned.model.courts[5].main,null);assert.equal(cleaned.model.courts[6].backup1,null);assert.equal(cleaned.model.courts[1].main.uid,'keep');
 assert.equal(cleaned.model.requests.qr.status,'stale');assert.equal(cleaned.model.requests.mail.status,'stale');assert.equal(cleaned.model.requests.keep.status,'pending');
 assert.equal(api.reconcileSeatCount(cleaned.model,4,21).changed,false);
 assert.deepEqual(Object.keys(api.projectSeats(cleaned.model,'host',4).refereeSeatNames),['1','2','3','4']);
 assert(!api.projectSeats(cleaned.model,'host',4).refereeStationUids.includes('remove'));
 const legacyExpanded=api.reconcileSeatCount(model,6,30,4).model;assert.equal(legacyExpanded.courts[5].main,null);assert.equal(legacyExpanded.requests.mail.status,'stale');
 const expanded=api.reconcileSeatCount(cleaned.model,6,30).model;
 assert.equal(expanded.courts[5].main,null);assert(expanded.courts[5].revision>model.courts[5].revision);assert.equal(expanded.requests.mail.status,'stale');
 const empty={meta:{stations:6,eventAuthority},matches:[],courtAssignments:{}};
 assert(api.request(empty,4,6,40).ok);assert.equal(empty.meta.stations,4);
 assert.equal(api.reconcileSeatCount(model,4,40).model.courts[5].main,null);
}
console.log('PASS shared official/community/PTN physical removal: draining preserves seats, empty occupied court clears, old invites stay stale on re-expansion');

// A first-score-free current assignment is still work on a live court.
for(const eventAuthority of ['official','community','ticket']){
 const make=startedAt=>({startedAt,meta:{stations:3,eventAuthority},
  matches:[{id:'current',seq:1,station:3,status:'ready',scoreA:0,scoreB:0,log:[],completed:false},
   {id:'next',seq:2,station:3,status:'ready',scoreA:0,scoreB:0,log:[],completed:false}],
  courtAssignments:{court3:{currentMatchId:'current',nextMatchId:'next'}}});
 const live=make(1);
 assert(api.request(live,2,3,10).ok);
 assert.equal(live.meta.stations,3);assert.equal(live.matches[0].station,3);
 assert(live.matches[1].station<=2);assert.equal(live.courtRetirementPlan.courts[3].status,'draining');
 assert(api.forceExit(live,3,'current',0,0,20).ok);
 assert.equal(live.meta.stations,2);assert.equal(live.matches[0].station,0);
 assert(api.claimDetached(live,'current',1,1,30).ok);assert.equal(live.matches[0].station,1);
 const waiting=make(null);assert(api.request(waiting,2,3,10).ok);assert.equal(waiting.meta.stations,2);
 assert(waiting.matches.every(m=>m.station<=2));
}
console.log('PASS all three modes: assigned zero-score live court stays until exit; pre-start preview does not pin a court');
