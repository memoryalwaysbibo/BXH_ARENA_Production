'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('court-call-ui.js','utf8');
function harness(){
 let time=100000,uid='a',calls=0,reads=0,failure=null,summary={tournamentPhase:'waiting'},resolveCall;
 const storage={getItem(){return null},setItem(){}};
 const context={console,Map,Set,setTimeout,clearTimeout,Date:{now:()=>time},currentAuthUid:()=>uid,engagementSessionEpoch:1,localStorage:storage,sessionStorage:storage,
  state:null,canOperateCurrentTournament:()=>true,myRegistrationsTournamentInfo:{},navigator:{onLine:true},window:{cloudSync:{getPublicTournamentSummary:async()=>{reads++;return summary}},engagementService:{courtCall:async()=>{calls++;if(failure)throw failure;return {ok:true,rows:[],prepares:[]}}}},
  syncCourtCallGlobalOverlay(){},courtCallNotifyChanges(){},courtCallError:e=>e.message,renderPreservingScroll(){}};
 vm.createContext(context);
 vm.runInContext("let courtCallCache=new Map(),courtCallIdentity='',courtCallPlayerCodes=[],courtCallDiscoveryAt=0;"+source.slice(source.indexOf('function courtCallUserKey()'),source.indexOf('function courtCallError(e)'))+source.slice(source.indexOf('function courtCallPhase(info)'),source.indexOf('function scheduleCourtCallPoll()'))+source.slice(source.indexOf('async function loadCourtCalls(code)'),source.indexOf('async function handleCourtCall(action,target)')),context);
 return {context,load:()=>context.loadCourtCalls('BXH-TEST01'),c:()=>context.courtCallContext('BXH-TEST01'),tick:n=>time+=n,counts:()=>({calls,reads}),summary:v=>summary=v,fail:v=>failure=v,user:v=>uid=v};
}
test('waiting room performs no callable; phase read bounded to 30 seconds; remote start resumes',async()=>{
 const h=harness();await h.load();assert.equal(h.counts().calls,0);for(let i=0;i<100;i++)await h.load();assert.equal(h.counts().reads,1);
 h.summary({tournamentPhase:'live'});h.tick(30000);await h.load();assert.equal(h.counts().calls,1);
});
test('live room preserves 2.5 second CALL cadence, and hence list PASS recall',async()=>{
 const h=harness();h.summary({tournamentPhase:'live'});await h.load();await h.load();assert.equal(h.counts().calls,1);h.tick(2500);await h.load();assert.equal(h.counts().calls,2);
});
test('permission rejection pauses per room, clears stale UI and does not retry on timers',async()=>{
 const h=harness();h.summary({tournamentPhase:'live'});h.c().rows=[{matchId:'m',players:[]}];h.fail({code:'functions/permission-denied',message:'permission-denied'});await h.load();assert.equal(h.c().denied,true);assert.equal(h.c().rows.length,0);
 for(let i=0;i<20;i++){h.tick(60000);await h.load();}assert.equal(h.counts().calls,1);
 h.fail(null);h.context.courtCallResume('BXH-TEST01');await h.load();assert.equal(h.counts().calls,2);
});
test('actual phase transition permits recovery but repeated phase does not',async()=>{
 const h=harness();h.summary({tournamentPhase:'live'});h.fail({code:'functions/permission-denied'});await h.load();h.tick(30000);h.summary({tournamentPhase:'waiting'});await h.load();assert.equal(h.counts().calls,1);h.tick(30000);h.summary({tournamentPhase:'live'});h.fail(null);await h.load();assert.equal(h.counts().calls,2);
});
test('network failures back off, recover, and reset normal cadence',async()=>{
 const h=harness();h.summary({tournamentPhase:'live'});h.fail({code:'functions/unavailable'});await h.load();h.tick(2500);await h.load();assert.equal(h.counts().calls,1);h.tick(2500);await h.load();assert.equal(h.counts().calls,2);h.tick(10000);h.fail(null);await h.load();assert.equal(h.c().failures,0);h.tick(2500);await h.load();assert.equal(h.counts().calls,4);
});
test('offline does not issue CALL; reconnect continues without changing authority',async()=>{
 const h=harness();h.summary({tournamentPhase:'live'});h.context.navigator.onLine=false;await h.load();assert.equal(h.counts().calls,0);h.context.navigator.onLine=true;await h.load();assert.equal(h.counts().calls,1);
});
test('existing manager realtime state avoids extra public reads and observes close/start',async()=>{
 const h=harness();h.context.state={cloudCode:'BXH-TEST01'};await h.load();assert.deepEqual(h.counts(),{calls:0,reads:0});h.context.state.startedAt=123;await h.load();assert.equal(h.counts().calls,1);h.tick(2500);h.context.state.systemClosed=true;await h.load();assert.equal(h.counts().calls,1);
});
test('all terminal public phases suppress polling',async()=>{
 for(const summary of [{tournamentPhase:'done'},{tournamentPhase:'cancelled'},{tournamentPhase:'live',systemClosed:true},{parsedData:{startedAt:123,meta:{eventCancelled:true}}}]){const h=harness();h.summary(summary);await h.load();assert.equal(h.counts().calls,0);}
});
test('missing public summary does not become waiting and kill known live PASS channel',async()=>{
 const h=harness();h.summary({tournamentPhase:'live'});await h.load();h.tick(30000);h.summary(null);await h.load();assert.equal(h.counts().calls,2);assert.equal(h.c().phase,'live');
});
test('account change isolates denied status and late responses',async()=>{
 const h=harness();h.summary({tournamentPhase:'live'});h.fail({code:'functions/permission-denied'});await h.load();h.user('b');h.fail(null);await h.load();assert.equal(h.c().denied,false);assert.equal(h.counts().calls,2);
 let resolve;h.context.window.engagementService.courtCall=()=>new Promise(r=>resolve=r);h.tick(2500);const pending=h.load();await new Promise(r=>setImmediate(r));h.user('c');resolve({ok:true,rows:[{matchId:'secret',players:[]}]});await pending;assert.equal(h.c().rows.length,0);
});
test('new public summary object can wake waiting room without another public read',async()=>{
 const h=harness();h.context.myRegistrationsTournamentInfo['BXH-TEST01']={tournamentPhase:'waiting'};await h.load();h.context.myRegistrationsTournamentInfo['BXH-TEST01']={tournamentPhase:'live'};await h.load();assert.equal(h.counts().calls,1);assert.equal(h.counts().reads,0);
});
test('denied room does not suspend a different live room',async()=>{
 const h=harness();h.summary({tournamentPhase:'live'});h.fail({code:'functions/permission-denied'});await h.load();h.fail(null);await h.context.loadCourtCalls('BXH-OTHER1');assert.equal(h.counts().calls,2);assert.equal(h.c().denied,true);
});
test('concurrent loads share one lifecycle read and one CALL request',async()=>{
 const h=harness();let resolve;h.context.window.cloudSync.getPublicTournamentSummary=()=>new Promise(r=>resolve=r);const a=h.load(),b=h.load();resolve({tournamentPhase:'live'});await Promise.all([a,b]);assert.equal(h.counts().calls,1);
});
test('bounded exponential retry delay never exceeds 60 seconds',async()=>{
 const h=harness();h.summary({tournamentPhase:'live'});h.fail({code:'functions/unavailable'});for(let i=0;i<12;i++){await h.load();h.tick(60000);}assert.equal(h.counts().calls,12);assert.equal(h.c().failures,5);
});

test('same-phase manager authority or match membership change resumes without score-triggered retries',async()=>{
 const h=harness();h.context.userProfile={active:true,role:'staff'};h.context.state={cloudCode:'BXH-TEST01',startedAt:123,matches:[{id:'m1',scoreA:0}],meta:{assignedStaffUids:['other']}};
 h.fail({code:'functions/permission-denied'});await h.load();h.tick(2500);h.context.state.matches[0].scoreA=1;await h.load();assert.equal(h.counts().calls,1);
 h.context.state.meta.assignedStaffUids=['a'];h.fail(null);await h.load();assert.equal(h.counts().calls,2);
});
test('a hung public summary is bounded and does not issue an unknown-phase CALL',async()=>{
 const h=harness();h.context.window.cloudSync.getPublicTournamentSummary=()=>new Promise(()=>{});
 const timers=[];h.context.setTimeout=(fn)=>{timers.push(fn);return 1};h.context.clearTimeout=()=>{};
 const pending=h.load();assert.equal(timers.length,1);timers[0]();await pending;assert.equal(h.c().loading,false);assert.equal(h.counts().calls,0);
});

test('UID-first summaries are reused instead of a duplicate lifecycle read',async()=>{
 const h=harness();h.context.window.BXH_MY_EVENTS_PLAYER_READ_SLICE=true;let info={tournamentPhase:'waiting'};
 h.context.currentMyEventsPlayerSlice=()=>({snapshot:()=>({rooms:[{card:{code:'BXH-TEST01'},status:'ready',info}]})});
 await h.load();info={tournamentPhase:'live'};await h.load();assert.equal(h.counts().calls,1);assert.equal(h.counts().reads,0);
});
test('both manual refresh entrances resume CALL only after refreshed data and retain owner fence',()=>{
 const core=fs.readFileSync('modules/main-app/core.js','utf8');
 assert.match(core,/Promise.resolve\(slice\?\.action\(action/);
 assert.match(core,/action==='my-events-refresh'&&owner===lobbyAuthKey\(\)&&slice===currentMyEventsPlayerSlice\(\)/);
 assert.match(core,/Object.keys\(infoByCode\)\)courtCallResume\(code\)/);
});

test('UID deep-cloned unchanged waiting summary cannot starve remote start detection',async()=>{
 const h=harness();h.context.window.BXH_MY_EVENTS_PLAYER_READ_SLICE=true;
 h.context.currentMyEventsPlayerSlice=()=>({snapshot:()=>({rooms:[{card:{code:'BXH-TEST01'},status:'ready',info:{tournamentPhase:'waiting',myEventsPublicRead:{receivedAt:100000}}}]})});
 await h.load();h.summary({tournamentPhase:'live'});h.tick(30000);await h.load();assert.equal(h.counts().calls,1);h.tick(2500);await h.load();assert.equal(h.counts().calls,2);assert.equal(h.c().phase,'live');
});
test('explicit refresh is not consumed by an older pending permission failure',async()=>{
 const h=harness();h.summary({tournamentPhase:'live'});let reject;
 h.context.window.engagementService.courtCall=()=>new Promise((_,r)=>reject=r);
 const pending=h.load();await new Promise(r=>setImmediate(r));h.context.courtCallResume('BXH-TEST01');reject({code:'functions/permission-denied'});await pending;
 assert.equal(h.c().denied,false);assert.equal(h.c().next,0);
});
