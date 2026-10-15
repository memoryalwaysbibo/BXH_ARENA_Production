'use strict';
// Independent, synthetic reviewer checks. No Firebase initialization or network.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const active=require('../modules/main-app/active-events.js');
const {create}=require('../modules/cloud/active-events-reader.js');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const ready=()=>({schemaVersion:1,status:'ready',generation:'g',revision:1,memberships:[]});
const self={kind:'self',registrationStatus:'confirmed',participantId:'p'};
const lossRoom=()=>({visibility:'public',tournamentPhase:'live',parsedData:{startedAt:1,bracketSize:8,meta:{formatType:'single',bronzeMatch:true},players:[{id:'p',name:'Player'}],matches:[{id:'sf',round:1,completed:true,a:{playerId:'p'},b:{playerId:'q'},loserId:'p',winnerId:'q'}]}});
const source=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

test('review: bronze eligibility without a trustworthy round must not be finished',()=>{
 for(const round of [undefined,null,'invalid',-1,100]){
  const room=lossRoom();room.parsedData.matches[0].round=round;
  assert.notEqual(active.classify(self,room).group,'finished','round='+round);
 }
});

test('review: double elimination loss and unfinished team tournament stay visible',()=>{
 const room=lossRoom();room.parsedData.meta.formatType='double';
 assert.equal(active.classify(self,room).group,'unknown');
 room.battleMode='team';room.parsedData.teams=[{id:'p',name:'Team'}];
 assert.equal(active.classify({...self,kind:'team-captain'},room).group,'unknown');
});

test('review: exact identity mismatch cannot bind even with equal display names',()=>{
 const room=lossRoom();room.parsedData.meta.bronzeMatch=false;
 const result=active.classify({...self,participantId:'missing',displayName:'Player'},room);
 assert.equal(result.group,'unknown');
});

test('review: late account A completion cannot clear account B single flight',async()=>{
 let owner={uid:'A',epoch:1};const a=deferred(),b=deferred();let reads=0;
 const c=active.createController({owner:()=>owner,readIndex:()=>++reads===1?a.promise:b.promise,readRoom:async()=>null});
 const first=c.load();owner={uid:'B',epoch:2};const second=c.load();
 a.resolve(ready());await first;assert.equal(c.load(true),second);assert.equal(reads,2);
 b.resolve(ready());await second;assert.equal(c.snapshot().status,'ready');
});

test('review: mutation during pending load schedules a new visible render after release',async()=>{
 const read=deferred();let changes=0;
 const c=active.createController({owner:()=>({uid:'A',epoch:1}),readIndex:()=>read.promise,readRoom:async()=>null,onChange:()=>changes++});
 const task=c.load();c.noteKnownEvent('BXH-TEST');const before=changes;
 read.resolve(ready());await task;assert.equal(changes,before+1);
 await c.load();assert.equal(c.snapshot().confirmedEmpty,false);
});

test('review: timed-out read unblocks manual retry only after the original flight settles',async()=>{
 const pending=deferred();let reads=0;
 const c=active.createController({owner:()=>({uid:'A',epoch:1}),timeoutMs:5,
  readIndex:()=>++reads===1?pending.promise:Promise.resolve(ready()),readRoom:async()=>null});
 const task=c.load();await new Promise(resolve=>setTimeout(resolve,15));
 assert.equal(c.snapshot().retryBlocked,true);assert.equal(c.load(true),task);assert.equal(reads,1);
 pending.resolve(ready());await task;
 assert.notEqual(c.snapshot().retryBlocked,true);assert.equal(reads,1,'settlement must not start an automatic retry');
 await c.load(true);assert.equal(reads,2);assert.equal(c.snapshot().status,'ready');
});

test('review: waiting room without bracket remains a waiting entry',async()=>{
 const context={uid:'A',epoch:1};let reconstructions=0;
 const reader=create({db:{},session:()=>context,reconstruct:()=>{reconstructions++;throw Error('corrupt');},sdk:{
  doc:(_, ...parts)=>parts.join('/'),getDocFromServer:async()=>({metadata:{fromCache:false,hasPendingWrites:false},exists:()=>true,data:()=>({visibility:'public',tournamentPhase:'waiting'})})
 }});
 const room=await reader.readRoom('BXH-TEST',context);
 assert.equal(reconstructions,0);assert.equal(active.classify(self,room).group,'waiting');
});

test('review: forged payload code and missing server metadata fail closed',async()=>{
 for(const mode of ['wrong-code','missing-metadata']){
  const context={uid:'A',epoch:1};const metadata={fromCache:false,hasPendingWrites:false};
  const sdk={doc:(_, ...p)=>p.join('/'),collection:(_, ...p)=>p.join('/'),query:x=>x,limit:n=>n,
   getDocFromServer:async()=>({metadata,exists:()=>true,data:()=>ready()}),
   getDocsFromServer:async()=>({metadata:mode==='missing-metadata'?undefined:metadata,forEach:fn=>fn({id:'BXH-REAL',data:()=>({code:mode==='wrong-code'?'BXH-FAKE':'BXH-REAL'})})})};
  const reader=create({sdk,db:{},session:()=>context,reconstruct:()=>null});
  await assert.rejects(reader.readIndex(context),mode==='wrong-code'?/membership-code-mismatch/:/server-snapshot-required/);
 }
});

function courtFixture(flag,hints){
 const text=source('court-call-ui.js'),start=text.indexOf('async function discoverCourtCallPlayerCodes('),end=text.indexOf('\nfunction courtCallVisibleCodes',start);
 const calls=[],saved=[];
 const context={console,Date,courtCallUserKey:()=>context.firebaseUser.uid,firebaseUser:{uid:'A'},engagementSessionEpoch:1,
  courtCallDiscoveryBusy:false,courtCallDiscoveryAt:0,courtCallPlayerCodes:[],
  courtCallSaveKnownCodes:codes=>saved.push({uid:context.firebaseUser.uid,codes:[...codes]}),
  window:{BXH_FEATURE_FLAGS:{uidActiveEvents:flag},cloudSync:{
   connect:async()=>calls.push('connect'),queryMyRegistrations:async()=>{calls.push('legacy');return [{tournamentCode:'BXH-LEGA',status:'confirmed'}];}
  }}};
 if(hints)context.window.cloudSync.queryMyActiveRegistrationHints=async()=>{calls.push('index');return hints();};
 vm.createContext(context);vm.runInContext(text.slice(start,end),context);
 return {context,calls,saved,run:()=>context.discoverCourtCallPlayerCodes(true)};
}

test('review: court discovery flag off retains the legacy behavior',async()=>{
 const f=courtFixture(false,()=>{throw Error('must not call');});await f.run();
 assert.deepEqual(f.calls,['connect','legacy']);assert.deepEqual(f.saved[0].codes,['BXH-LEGA']);
});

test('review: court discovery flag on uses indexed hints only',async()=>{
 const f=courtFixture(true,()=>[{tournamentCode:'BXH-NEW1',status:'confirmed'}]);await f.run();
 assert.deepEqual(f.calls,['connect','index']);assert.deepEqual(f.saved[0].codes,['BXH-NEW1']);
});

test('review: missing or rejected court index never falls back to broad discovery',async()=>{
 for(const hints of [null,()=>{throw Error('pending');}]){
  const f=courtFixture(true,hints);await f.run();assert.ok(!f.calls.includes('legacy'));assert.equal(f.saved.length,0);
 }
});

test('review: indexed court discovery cannot persist A codes after auth switches to B',async()=>{
 const pending=deferred(),f=courtFixture(true,()=>pending.promise);const task=f.run();
 await Promise.resolve();await Promise.resolve();
 f.context.firebaseUser={uid:'B'};f.context.engagementSessionEpoch=2;
 pending.resolve([{tournamentCode:'BXH-AAAA',status:'confirmed'}]);await task;
 assert.equal(f.saved.length,0);
});

function enchantmentFixture(flag){
 const text=source('enchantment-ui.js'),start=text.indexOf(' let discoveryBusy='),end=text.indexOf(' function openEnchantmentPreview()',start);
 const calls=[],context={console,Date,firebaseUser:{uid:'A'},engagementSessionEpoch:1,cache:new Map(),matchNames:new Map(),
  document:{querySelector:()=>null,querySelectorAll:()=>[]},
  root:{BXH_FEATURE_FLAGS:{uidActiveEvents:flag},engagementService:{enchantment:()=>{}},cloudSync:{
   queryMyRegistrations:async()=>{calls.push('legacy');return [];},
   queryMyActiveRegistrationHints:async()=>{calls.push('index:'+context.firebaseUser.uid);return [{tournamentCode:'BXH-'+context.firebaseUser.uid.repeat(4),status:'confirmed',participantId:'p'}];},
   getPublicTournamentSummary:async code=>{calls.push('legacy-room:'+code);return null;},
   readMyActivePublicRoom:async code=>{calls.push('room:'+code);return null;}
  }}};
 context.window=context.root;context.currentAuthUid=()=>context.firebaseUser.uid;
 vm.createContext(context);vm.runInContext(text.slice(start,end),context);
 return {context,calls,run:()=>context.discoverPlayerDraw()};
}

test('review: enchantment flag off retains legacy discovery',async()=>{
 const f=enchantmentFixture(false);await f.run();assert.deepEqual(f.calls,['legacy']);
});

test('review: indexed enchantment registration cache is scoped by UID and epoch',async()=>{
 const f=enchantmentFixture(true);await f.run();
 f.context.firebaseUser={uid:'B'};f.context.engagementSessionEpoch=2;await f.run();
 assert.deepEqual(f.calls,['index:A','room:BXH-AAAA','index:B','room:BXH-BBBB']);
});

function coreFixture(flag=true){
 const text=source('modules/main-app/core.js'),start=text.indexOf('// Local candidate flag is deliberately absent/false'),end=text.indexOf('\nconst {hunterRecordTimestamp',start);
 let nextTimer=0;const timers=new Map(),calls=[],listeners={},fixture={state:'pending',memberships:[],rooms:{}};
 const context={console,Date,document:{hidden:false},firebaseUser:{uid:'A'},engagementSessionEpoch:1,
  appPhase:'player-center',playerActiveTab:'registered',myRegistrationsCache:[],myRegistrationsLoading:false,myRegistrationsError:null,
  mailboxContext:()=>({open:false}),setTimeout:(fn,delay)=>{timers.set(++nextTimer,{fn,delay});return nextTimer;},clearTimeout:id=>timers.delete(id),
  window:{BXH_FEATURE_FLAGS:{uidActiveEvents:flag},BXHActiveEvents:active,addEventListener:(name,fn)=>listeners[name]=fn,cloudSync:{
   readMyActiveMemberships:async owner=>{calls.push('index:'+owner.uid);return {...ready(),status:fixture.state,memberships:fixture.memberships};},
   readMyActivePublicRoom:async code=>{calls.push('room:'+code);return fixture.rooms[code];}
  }},markup:''};
 context.renderPreservingScroll=()=>{context.markup=context.renderUidActiveEvents();};
 vm.createContext(context);vm.runInContext(text.slice(start,end),context);
 const drain=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
 const runTimers=async delay=>{for(const [id,t]of [...timers])if(t.delay===delay){timers.delete(id);t.fn();}await drain();};
 return {context,timers,calls,listeners,fixture,drain,runTimers,render:()=>{context.markup=context.renderPlayerRegisteredTab();return context.markup;}};
}

test('review VM integration: pending readiness renders unknown rather than empty',async()=>{
 const f=coreFixture();f.render();await f.runTimers(0);
 assert.deepEqual(f.calls,['index:A']);assert.match(f.context.markup,/仍在建立或更新/);assert.doesNotMatch(f.context.markup,/沒有進行中/);
});

test('review VM integration: flag off keeps legacy registered empty screen and no index IO',async()=>{
 const f=coreFixture(false);const html=f.render();await f.runTimers(0);
 assert.match(html,/目前沒有進行中的個人賽程/);assert.doesNotMatch(html,/我的目前賽事/);assert.deepEqual(f.calls,[]);
});

test('review VM integration: configured flag on with missing module must not fall back to legacy',async()=>{
 const f=coreFixture(true);delete f.context.window.BXHActiveEvents;
 const html=f.render();await f.runTimers(0);
 assert.doesNotMatch(html,/目前沒有進行中的個人賽程/);
 assert.match(html,/無法|不可|未能|載入失敗|尚未載入|unavailable/);
 assert.deepEqual(f.calls,[]);
});

test('review VM integration: same-UID new session replaces the old refresh timer',async()=>{
 const f=coreFixture();f.fixture.state='ready';f.render();await f.runTimers(0);
 const old=[...f.timers].find(([,t])=>t.delay===20000)?.[0];assert.ok(old);
 f.context.engagementSessionEpoch=2;f.render();assert.ok(!f.timers.has(old));await f.runTimers(0);
 const timers=[...f.timers].filter(([,t])=>t.delay===20000);assert.equal(timers.length,1);assert.notEqual(timers[0][0],old);
 await f.runTimers(20000);assert.deepEqual(f.calls,['index:A','index:A','index:A']);
});

test('review VM integration: stale mutation is ignored and current mutation prevents empty',async()=>{
 const f=coreFixture();f.fixture.state='ready';f.render();await f.runTimers(0);
 assert.match(f.context.markup,/沒有進行中/);
 f.listeners['bxh-active-event-mutation']({detail:{uid:'B',epoch:1,code:'BXH-NEW1'}});await f.runTimers(0);
 assert.deepEqual(f.calls,['index:A']);assert.match(f.context.markup,/沒有進行中/);
 f.listeners['bxh-active-event-mutation']({detail:{uid:'A',epoch:1,code:'BXH-NEW1'}});await f.runTimers(0);
 assert.match(f.context.markup,/剛才的參賽變更仍待索引核對/);assert.doesNotMatch(f.context.markup,/沒有進行中/);
});
