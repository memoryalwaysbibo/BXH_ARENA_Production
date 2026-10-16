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
const ready=()=>({schemaVersion:1,status:'ready',generation:'g',revision:1,receiptHash:'receipt',verifiedSourceEpoch:1,memberships:[]});
const health=()=>({schemaVersion:1,status:'healthy',generation:'g',revision:1,sourceEpoch:1,projectedEpoch:1,receiptHash:'receipt',leaseExpiresAt:{toMillis:()=>60000}});
const controller=options=>active.createController({verifyIndexHealth:async()=>({displayDeadline:performance.now()+20000}),...options});
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
 const c=controller({owner:()=>owner,readIndex:()=>++reads===1?a.promise:b.promise,readRoom:async()=>null});
 const first=c.load();owner={uid:'B',epoch:2};const second=c.load();
 a.resolve(ready());await first;assert.equal(c.load(true),second);assert.equal(reads,2);
 b.resolve(ready());await second;assert.equal(c.snapshot().status,'ready');
});

test('review: mutation during pending load schedules a new visible render after release',async()=>{
 const read=deferred();let changes=0;
 const c=controller({owner:()=>({uid:'A',epoch:1}),readIndex:()=>read.promise,readRoom:async()=>null,onChange:()=>changes++});
 const task=c.load();c.noteKnownEvent('BXH-TEST');const before=changes;
 read.resolve(ready());await task;assert.equal(changes,before+1);
 await c.load();assert.equal(c.snapshot().confirmedEmpty,false);
});

test('review: timed-out read unblocks manual retry only after the original flight settles',async()=>{
 const pending=deferred();let reads=0;
 const c=controller({owner:()=>({uid:'A',epoch:1}),timeoutMs:5,
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
   getDocFromServer:async ref=>({metadata,exists:()=>true,data:()=>ref==='activeTournamentMembershipHealth/current'?health():ready()}),
   getDocsFromServer:async()=>({metadata:mode==='missing-metadata'?undefined:metadata,forEach:fn=>fn({id:'BXH-REAL',data:()=>({code:mode==='wrong-code'?'BXH-FAKE':'BXH-REAL'})})})};
  const reader=create({sdk,db:{},session:()=>context,reconstruct:()=>null});
  await assert.rejects(reader.readIndex(context),mode==='wrong-code'?/membership-code-mismatch/:/server-snapshot-required/);
 }
});

function courtFixture(flag,hints){
 const text=source('court-call-ui.js'),start=text.indexOf('async function discoverCourtCallPlayerCodes('),end=text.indexOf('\nfunction scheduleCourtCallPoll',start);
 const calls=[],saved=[];
 const context={console,Date,performance,courtCallUserKey:()=>context.firebaseUser.uid,firebaseUser:{uid:'A'},engagementSessionEpoch:1,
  courtCallDiscoveryBusy:false,courtCallDiscoveryAt:0,courtCallPlayerCodes:[],courtCallIndexDeadline:0,courtCallIndexOwner:'',courtCallIndexAttemptedOwner:'',
  courtCallSaveKnownCodes:codes=>saved.push({uid:context.firebaseUser.uid,codes:[...codes]}),
  window:{BXH_FEATURE_FLAGS:{uidActiveEvents:flag},cloudSync:{
   connect:async()=>calls.push('connect'),queryMyRegistrations:async()=>{calls.push('legacy');return [{tournamentCode:'BXH-LEGA',status:'confirmed'}];}
  }}};
 if(hints)context.window.cloudSync.queryMyActiveRegistrationHints=async()=>{calls.push('index');const rows=await hints();return Object.assign(rows,{displayDeadline:rows.displayDeadline??performance.now()+20000});};
 vm.createContext(context);vm.runInContext(text.slice(start,end),context);
 return {context,calls,saved,run:()=>context.discoverCourtCallPlayerCodes(true),visible:()=>Array.from(context.courtCallVisibleCodes())};
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
  const f=courtFixture(true,hints);await f.run();assert.ok(!f.calls.includes('legacy'));assert.ok(f.saved.every(item=>item.codes.length===0));
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
 const calls=[],listeners={},context={console,Date,performance,firebaseUser:{uid:'A'},engagementSessionEpoch:1,cache:new Map(),matchNames:new Map(),
  document:{querySelector:()=>null,querySelectorAll:()=>[]},
  root:{addEventListener:(name,fn)=>listeners[name]=fn,BXH_FEATURE_FLAGS:{uidActiveEvents:flag},engagementService:{enchantment:()=>{}},cloudSync:{
   queryMyRegistrations:async()=>{calls.push('legacy');return [];},
   queryMyActiveRegistrationHints:async()=>{calls.push('index:'+context.firebaseUser.uid);return Object.assign([{tournamentCode:'BXH-'+context.firebaseUser.uid.repeat(4),status:'confirmed',participantId:'p'}],{displayDeadline:performance.now()+20000});},
   getPublicTournamentSummary:async code=>{calls.push('legacy-room:'+code);return null;},
   readMyActivePublicRoom:async code=>{calls.push('room:'+code);return null;}
  }}};
 context.window=context.root;context.currentAuthUid=()=>context.firebaseUser.uid;
 vm.createContext(context);vm.runInContext(text.slice(start,end),context);
 return {context,calls,listeners,run:()=>context.discoverPlayerDraw()};
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
 let nextTimer=0;const timers=new Map(),calls=[],listeners={},fixture={state:'pending',memberships:[],rooms:{},mono:0};
 const context={console,Date,Event,module:{exports:{}},performance:{now:()=>fixture.mono},document:{hidden:false,addEventListener:(name,fn)=>listeners[name]=fn},firebaseUser:{uid:'A'},engagementSessionEpoch:1,
  appPhase:'player-center',playerActiveTab:'registered',myRegistrationsCache:[],myRegistrationsLoading:false,myRegistrationsError:null,
  mailboxContext:()=>({open:false}),setTimeout:(fn,delay)=>{timers.set(++nextTimer,{fn,delay});return nextTimer;},clearTimeout:id=>timers.delete(id),
  window:{BXH_FEATURE_FLAGS:{uidActiveEvents:flag},BXHActiveEvents:active,addEventListener:(name,fn)=>listeners[name]=fn,dispatchEvent:event=>listeners[event.type]?.(event),cloudSync:{
   readMyActiveMemberships:async owner=>{calls.push('index:'+owner.uid);return fixture.indexRead?fixture.indexRead(owner):{...ready(),status:fixture.state,memberships:fixture.memberships};},
   verifyMyActiveMembershipHealth:async()=>({displayDeadline:fixture.mono+20000}),
   readMyActivePublicRoom:async code=>{calls.push('room:'+code);return fixture.rooms[code];}
  }},markup:''};
 context.renderPreservingScroll=()=>{context.markup=context.renderUidActiveEvents();};
 vm.createContext(context);vm.runInContext(source('modules/main-app/active-events.js'),context);vm.runInContext(text.slice(start,end),context);
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

test('review VM integration: same-UID new session discards old certainty without a background index poll',async()=>{
 const f=coreFixture();f.fixture.state='ready';f.render();await f.runTimers(0);
 const old=[...f.timers].find(([,t])=>t.delay===20000)?.[0];assert.ok(old);
 f.context.engagementSessionEpoch=2;f.render();assert.ok(!f.timers.has(old));await f.runTimers(0);
 const timers=[...f.timers].filter(([,t])=>t.delay===20000);assert.equal(timers.length,1);assert.notEqual(timers[0][0],old);
 f.fixture.mono=20000;await f.runTimers(20000);await f.runTimers(0);
 assert.deepEqual(f.calls,['index:A','index:A']);assert.match(f.context.markup,/清單待更新/);assert.doesNotMatch(f.context.markup,/沒有進行中/);
});

test('review VM integration: stale mutation is ignored and current mutation prevents empty',async()=>{
 const f=coreFixture();f.fixture.state='ready';f.render();await f.runTimers(0);
 assert.match(f.context.markup,/沒有進行中/);
 f.listeners['bxh-active-event-mutation']({detail:{uid:'B',epoch:1,code:'BXH-NEW1'}});await f.runTimers(0);
 assert.deepEqual(f.calls,['index:A']);assert.match(f.context.markup,/沒有進行中/);
 f.listeners['bxh-active-event-mutation']({detail:{uid:'A',epoch:1,code:'BXH-NEW1'}});await f.runTimers(0);
 assert.match(f.context.markup,/剛才的參賽變更仍待索引核對/);assert.doesNotMatch(f.context.markup,/沒有進行中/);
});

// All time, server responses and lifecycle events below are synthetic. The SDK
// fixture deliberately models Rules allowing a healthy lease; Rules themselves
// are covered by the independent emulator suite, not by these reader checks.
function timedControllerFixture(){
 const clock={mono:0,wall:1700000000000},timers=new Map();let sequence=0;
 class ClockDate extends Date {static now(){return clock.wall;}}
 const context={module:{exports:{}},console,Date:ClockDate,performance:{now:()=>clock.mono},
  setTimeout:(fn,delay)=>{const id=++sequence;timers.set(id,{fn,at:clock.mono+delay,delay});return id;},clearTimeout:id=>timers.delete(id)};
 vm.createContext(context);vm.runInContext(source('modules/main-app/active-events.js'),context);
 const api=context.module.exports;
 const drain=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
 const fireDue=async()=>{for(const [id,t]of [...timers])if(t.at<=clock.mono){timers.delete(id);t.fn();}await drain();};
 const make=(options={})=>api.createController({owner:()=>({uid:'A',epoch:1}),readIndex:async()=>ready(),readRoom:async()=>null,
  verifyIndexHealth:async()=>({displayDeadline:clock.mono+20000}),...options});
 return {clock,timers,api,make,drain,fireDue};
}

function readerFixture(options={}){
 const context={uid:'A',epoch:1},clock={mono:0},reads=[],metadata={fromCache:false,hasPendingWrites:false};
 let healthReads=0;
 const snap=data=>({metadata,exists:()=>data!==null,data:()=>data});
 const sdk={doc:(_, ...p)=>p.join('/'),collection:(_, ...p)=>p.join('/'),query:x=>x,limit:n=>n,
  getDocFromServer:async ref=>{
   reads.push(ref);
   if(ref==='activeTournamentMembershipHealth/current')return snap(options.healthRead?await options.healthRead(++healthReads,clock):health());
   if(ref.startsWith('publicTournaments/'))return snap(options.roomRead?await options.roomRead(ref,clock):{visibility:'public',tournamentPhase:'waiting'});
   return snap(options.stateRead?await options.stateRead(ref,clock):ready());
  },
  getDocsFromServer:async()=>({metadata,forEach:fn=>(options.members||[]).forEach(row=>fn({id:row.code,data:()=>row}))})};
 const reader=create({sdk,db:{},session:()=>context,reconstruct:()=>null,monotonicNow:()=>clock.mono});
 return {reader,context,clock,reads,sdk};
}

test('review health: server-response latency consumes the before-send display budget',async()=>{
 const f=readerFixture({healthRead:async(n,clock)=>{if(n===3)clock.mono+=9000;return health();}});
 const index=await f.reader.readIndex(f.context);f.clock.mono=100;
 const verified=await f.reader.verifyIndexHealth(index,f.context);
 assert.equal(f.clock.mono,9100);assert.equal(verified.displayDeadline,20100);
 assert.equal(verified.displayDeadline-f.clock.mono,11000);
});

test('review health: response exactly at the full budget boundary is rejected',async()=>{
 for(const delay of [20000,20001,90000]){
  const f=readerFixture({healthRead:async(n,clock)=>{clock.mono+=delay;return health();}});
  await assert.rejects(f.reader.readIndex(f.context),/membership-health-read-too-slow/);
  assert.equal(f.reads.length,1,'expired health must not start membership discovery');
 }
});

test('review health: missing, pending and mismatched source epochs cannot yield ready',async()=>{
 for(const value of [null,{...health(),status:'pending'},{...health(),sourceEpoch:2},
  {...health(),sourceEpoch:-1,projectedEpoch:-1},{...health(),leaseExpiresAt:{toMillis:()=>NaN}}]){
  const f=readerFixture({healthRead:async()=>value});
  await assert.rejects(f.reader.readIndex(f.context),/membership-health-(missing|unavailable)/);
  assert.equal(f.reads.length,1);
 }
});

test('review health: after-room health changes cannot publish a stale empty result',async()=>{
 let revision=1;
 const member={schemaVersion:1,generation:'g',code:'BXH-TEST',sourceRevision:'r1',participants:[self]};
 const f=readerFixture({members:[member],healthRead:async()=>({...health(),revision}),
  roomRead:async()=>{revision=2;return {visibility:'public',tournamentPhase:'done'};}});
 const c=controller({owner:()=>f.context,readIndex:context=>f.reader.readIndex(context),
  readRoom:(code,context)=>f.reader.readRoom(code,context),verifyIndexHealth:(index,context)=>f.reader.verifyIndexHealth(index,context),monotonicNow:()=>f.clock.mono});
 await c.load();assert.equal(c.snapshot().status,'error');assert.match(c.snapshot().reason,/membership-health-changed/);
 assert.equal(c.snapshot().rows.length,0);assert.notEqual(c.snapshot().confirmedEmpty,true);
 assert.doesNotMatch(active.html(c.snapshot()),/沒有進行中的個人賽程/);
 assert.ok(f.reads.indexOf('publicTournaments/BXH-TEST')<f.reads.lastIndexOf('activeTournamentMembershipHealth/current'));
});

test('review health: server denial cannot be overridden by a backwards wall clock',async()=>{
 const f=timedControllerFixture();f.clock.wall=0;
 const c=f.make({verifyIndexHealth:async()=>{throw Object.assign(Error('permission-denied'),{code:'permission-denied'});}});
 await c.load();assert.equal(c.snapshot().status,'error');assert.notEqual(c.snapshot().confirmedEmpty,true);
});

test('review health: no verifier and expired verifier receipts both fail closed',async()=>{
 const f=timedControllerFixture();
 for(const verifyIndexHealth of [undefined,async()=>({displayDeadline:0}),async()=>({displayDeadline:NaN})]){
  const c=f.make({verifyIndexHealth});await c.load();assert.equal(c.snapshot().status,'error');assert.notEqual(c.snapshot().confirmedEmpty,true);
 }
});

test('review health: snapshot age uses monotonic time despite large wall-clock jumps',async()=>{
 const f=timedControllerFixture(),c=f.make();await c.load();
 assert.equal(c.snapshot().confirmedEmpty,true);
 f.clock.wall-=365*86400000;f.clock.mono=19999;assert.equal(c.snapshot().status,'ready');
 f.clock.wall+=1000*365*86400000;assert.equal(c.snapshot().status,'ready');
 f.clock.mono=20000;assert.equal(c.snapshot().status,'stale');assert.equal(c.snapshot().rows.length,0);
 assert.notEqual(c.snapshot().confirmedEmpty,true);assert.equal(f.timers.size,0);
});

test('review health: expiry timer marks stale and notifies without another index read',async()=>{
 const f=timedControllerFixture();let changes=0;
 const c=f.make({onChange:()=>changes++});await c.load();const before=changes;
 f.clock.mono=20000;await f.fireDue();assert.equal(changes,before+1);assert.equal(c.snapshot().status,'stale');
 assert.equal(c.snapshot().rows.length,0);assert.notEqual(c.snapshot().confirmedEmpty,true);
});

test('review health: late A health verification cannot overwrite B or clear its single flight',async()=>{
 const f=timedControllerFixture(),a=deferred(),b=deferred();let owner={uid:'A',epoch:1};
 const c=f.make({owner:()=>owner,verifyIndexHealth:async(_,context)=>context.uid==='A'?a.promise:b.promise});
 const first=c.load();await f.drain();owner={uid:'B',epoch:2};const second=c.load();await f.drain();
 a.resolve({displayDeadline:20000});await first;assert.equal(c.load(true),second);assert.equal(c.snapshot().status,'loading');
 b.resolve({displayDeadline:20000});await second;assert.equal(c.snapshot().status,'ready');
});

test('review health: invalidating a hung single flight must still reach reload recovery',async()=>{
 const f=timedControllerFixture(),pending=deferred();
 const c=f.make({timeoutMs:100,readIndex:()=>pending.promise});c.load();c.invalidate();
 f.clock.mono=100;await f.fireDue();
 assert.equal(c.snapshot().retryBlocked,true,'lifecycle invalidation must not silently remove the only timeout recovery');
 assert.match(f.api.html(c.snapshot()),/重新載入頁面/);
});

test('review VM integration: hide and resume invalidate ready before another successful read',async()=>{
 const f=coreFixture();f.fixture.state='ready';f.render();await f.runTimers(0);assert.match(f.context.markup,/沒有進行中/);
 f.context.document.hidden=true;f.listeners.visibilitychange({type:'visibilitychange'});
 assert.equal(f.context.getUidActiveEventsController().snapshot().status,'stale');
 await f.runTimers(0);assert.deepEqual(f.calls,['index:A'],'hidden document must not restart IO');
 f.fixture.state='pending';f.context.document.hidden=false;f.listeners.visibilitychange({type:'visibilitychange'});
 assert.doesNotMatch(f.context.markup,/沒有進行中/);await f.runTimers(0);
 assert.match(f.context.markup,/仍在建立或更新/);assert.deepEqual(f.calls,['index:A','index:A']);
});

test('review VM integration: page restore, focus and offline events revoke old empty confidence',async()=>{
 for(const event of ['pagehide','pageshow','focus','offline']){
  const f=coreFixture();f.fixture.state='ready';f.render();await f.runTimers(0);
  f.fixture.state='pending';f.listeners[event]({type:event});
  assert.notEqual(f.context.getUidActiveEventsController().snapshot().confirmedEmpty,true,event);
  assert.doesNotMatch(f.context.markup,/沒有進行中/,event);
  await f.runTimers(0);
  assert.match(f.context.markup,event==='pagehide'||event==='offline'?/清單待更新/:/仍在建立或更新/,event);
  if(event==='pagehide'||event==='offline')assert.deepEqual(f.calls,['index:A']);
 }
});

test('review health hints: court snapshot expiry preserves known live rooms without adding legacy discoveries',async()=>{
 const rows=Object.assign([{tournamentCode:'BXH-AAAA',status:'confirmed'}],{displayDeadline:10});
 const f=courtFixture(true,()=>rows);let mono=0;f.context.performance={now:()=>mono};
 f.context.myRegistrationsCache=[{tournamentCode:'BXH-LEGA',status:'confirmed'}];
 await f.run();assert.deepEqual(f.visible(),['BXH-AAAA']);
 mono=10;assert.deepEqual(f.visible(),['BXH-AAAA']);assert.ok(!f.calls.includes('legacy'));
});

test('review health hints: a rejected court refresh retains rooms for separately authorized live updates',async()=>{
 let denied=false;
 const f=courtFixture(true,()=>{if(denied)throw Error('permission-denied');return [{tournamentCode:'BXH-AAAA',status:'confirmed'}];});
 await f.run();assert.deepEqual(f.visible(),['BXH-AAAA']);denied=true;await f.run();
 assert.deepEqual(f.visible(),['BXH-AAAA']);assert.deepEqual(f.saved.at(-1).codes,['BXH-AAAA']);assert.ok(!f.calls.includes('legacy'));
});

test('review health hints: enchantment expiry never triggers an index heartbeat, only explicit intent does',async()=>{
 const f=enchantmentFixture(true);let mono=0,denied=false;f.context.performance={now:()=>mono};
 class BackwardsDate extends Date {static now(){return -1000000;}}
 f.context.Date=BackwardsDate;
 f.context.root.cloudSync.queryMyActiveRegistrationHints=async()=>{
  f.calls.push('index');if(denied)throw Error('permission-denied');
  return Object.assign([{tournamentCode:'BXH-AAAA',status:'confirmed',participantId:'p'}],{displayDeadline:10});
 };
 await f.run();assert.deepEqual(f.calls,['index','room:BXH-AAAA']);
 mono=10;denied=true;await f.run();assert.deepEqual(f.calls,['index','room:BXH-AAAA','room:BXH-AAAA']);
 f.listeners['bxh-active-event-discovery-refresh']();await f.run();assert.deepEqual(f.calls,['index','room:BXH-AAAA','room:BXH-AAAA','index']);
});

test('review health hints: membership expiry does not interrupt an already discovered room lookup',async()=>{
 const f=enchantmentFixture(true);let mono=0,operations=0;f.context.performance={now:()=>mono};
 f.context.key=(code,id)=>code+':'+id;
 f.context.call=async()=>{operations++;return {};};
 f.context.root.cloudSync.queryMyActiveRegistrationHints=async()=>Object.assign([{tournamentCode:'BXH-AAAA',status:'confirmed',participantId:'p'}],{displayDeadline:10});
 f.context.root.cloudSync.readMyActivePublicRoom=async()=>{mono=10;return {parsedData:{startedAt:1,matches:[{id:'m',status:'in_progress',a:{playerId:'p'},b:{playerId:'q'}}]}};};
 await f.run();assert.equal(operations,1,'live callable still performs its own authorization');
});

test('review health: missing or different cohort receipts and source proof reject stale ready states',async()=>{
 for(const patch of [{receiptHash:undefined},{receiptHash:''},{receiptHash:'old-cohort'},
  {verifiedSourceEpoch:undefined},{verifiedSourceEpoch:0},{verifiedSourceEpoch:'1'}]){
  const f=readerFixture({stateRead:async()=>({...ready(),...patch})});
  await assert.rejects(f.reader.readIndex(f.context),/membership-health-changed/);
 }
 for(const receiptHash of [undefined,'',42]){
  const f=readerFixture({healthRead:async()=>({...health(),receiptHash})});
  await assert.rejects(f.reader.readIndex(f.context),/membership-health-unavailable/);
 }
});

test('review health: same generation and revision cannot hide a changed health receipt',async()=>{
 const f=readerFixture({healthRead:async n=>({...health(),receiptHash:n===1?'receipt':'another-cohort'})});
 await assert.rejects(f.reader.readIndex(f.context),/membership-health-changed/);
});

test('review health: stale, loading, pending and error snapshots retain cards but never assert empty',async()=>{
 const f=timedControllerFixture();let status='ready',reads=0;
 const member={schemaVersion:1,generation:'g',code:'BXH-TEST',sourceRevision:'r1',participants:[self]};
 const c=f.make({readIndex:async()=>{reads++;if(status==='throw')throw Error('offline');return {...ready(),status,memberships:[member]};},
  readRoom:async()=>({visibility:'public',name:'Retained room',tournamentPhase:'waiting'})});
 await c.load();assert.equal(c.snapshot().confirmedEmpty,true);assert.equal(c.snapshot().rows.length,1);
 f.clock.mono=20000;await f.fireDue();assert.equal(c.snapshot().status,'stale');assert.equal(c.snapshot().rows.length,1);assert.equal(reads,1);
 assert.match(f.api.html(c.snapshot()),/清單待更新/);assert.match(f.api.html(c.snapshot()),/Retained room/);assert.doesNotMatch(f.api.html(c.snapshot()),/沒有進行中的個人賽程/);
 for(status of ['pending','throw']){
  const task=c.load(true);assert.equal(c.snapshot().status,'loading');assert.equal(c.snapshot().rows.length,1);assert.equal(c.snapshot().confirmedEmpty,false);
  await task;assert.equal(c.snapshot().status,status==='pending'?'syncing':'error');assert.equal(c.snapshot().rows.length,1);
  assert.match(f.api.html(c.snapshot()),/Retained room/);assert.doesNotMatch(f.api.html(c.snapshot()),/沒有進行中的個人賽程/);
 }
});

test('review VM integration: visibility and focus coalesce behind a stale in-flight read and eventually verify once',async()=>{
 const f=coreFixture(),pending=deferred();let reads=0;
 f.fixture.indexRead=()=>++reads===1?pending.promise:Promise.resolve(ready());
 f.render();await f.runTimers(0);assert.deepEqual(f.calls,['index:A']);
 f.context.document.hidden=true;f.listeners.visibilitychange({type:'visibilitychange'});
 f.context.document.hidden=false;f.listeners.visibilitychange({type:'visibilitychange'});f.listeners.focus({type:'focus'});
 await f.runTimers(0);assert.deepEqual(f.calls,['index:A'],'never overlap the original server request');
 pending.resolve(ready());await f.drain();await f.runTimers(0);await f.drain();
 assert.equal(f.context.getUidActiveEventsController().snapshot().status,'ready');assert.deepEqual(f.calls,['index:A','index:A']);
 await f.runTimers(0);assert.deepEqual(f.calls,['index:A','index:A'],'lifecycle burst queues only one replacement');
});

test('review health hints: indexed court discovery makes one attempt with zero or negative wall time',async()=>{
 for(const wall of [0,-1000]){
  const f=courtFixture(true,()=>[]);class ClockDate extends Date {static now(){return wall;}}
  f.context.Date=ClockDate;
  for(let i=0;i<4;i++)await f.context.discoverCourtCallPlayerCodes(false);
  assert.deepEqual(f.calls,['connect','index']);
  f.context.engagementSessionEpoch=2;await f.context.discoverCourtCallPlayerCodes(false);
  assert.deepEqual(f.calls,['connect','index','connect','index']);
 }
});

test('review health hints: indexed enchantment discovery makes one attempt with zero or negative wall time',async()=>{
 for(const wall of [0,-1000]){
  const f=enchantmentFixture(true);class ClockDate extends Date {static now(){return wall;}}
  f.context.Date=ClockDate;
  for(let i=0;i<4;i++)await f.run();
  assert.equal(f.calls.filter(x=>x==='index:A').length,1);
  f.listeners['bxh-active-event-discovery-refresh']();await f.run();assert.equal(f.calls.filter(x=>x==='index:A').length,2);
 }
});

function sharedMembershipFlightFixture(readIndex){
 const text=source('modules/cloud/cloud-runtime.js'),start=text.indexOf('    async readMyActiveMemberships(context)'),end=text.indexOf('    async readMyActivePublicRoom(',start);
 assert.ok(start>=0&&end>start);
 const runtime=vm.runInNewContext('({'+text.slice(start,end)+'})');
 runtime.activeEventsReader=()=>({readIndex});return runtime;
}

test('review health shared-flight: same UID and epoch coalesce only while the request is pending',async()=>{
 const pending=deferred();let reads=0;
 const runtime=sharedMembershipFlightFixture(()=>{reads++;return reads===1?pending.promise:Promise.resolve(ready());});
 const owner={uid:'A',epoch:1};
 const calls=[runtime.readMyActiveMemberships(owner),runtime.readMyActiveMemberships({...owner}),runtime.readMyActiveMemberships({...owner})];
 assert.equal(reads,1);pending.resolve(ready());await Promise.all(calls);
 await runtime.readMyActiveMemberships(owner);assert.equal(reads,2,'settled responses are not an unbounded cache');
});

test('review health shared-flight: late account A settlement cannot release the newer B flight',async()=>{
 const a=deferred(),b=deferred();let reads=0;
 const runtime=sharedMembershipFlightFixture(context=>{reads++;return context.uid==='A'?a.promise:b.promise;});
 const first=runtime.readMyActiveMemberships({uid:'A',epoch:1}),second=runtime.readMyActiveMemberships({uid:'B',epoch:2});
 assert.equal(reads,2);a.resolve(ready());await first;
 const third=runtime.readMyActiveMemberships({uid:'B',epoch:2});assert.equal(reads,2);
 b.resolve(ready());await Promise.all([second,third]);
});

test('review health shared-flight: same UID new epoch does not reuse an older request and rejection allows retry',async()=>{
 let rejectOld;const old=new Promise((_,reject)=>{rejectOld=reject;});let reads=0;
 const runtime=sharedMembershipFlightFixture(()=>++reads===1?old:Promise.resolve(ready()));
 const first=runtime.readMyActiveMemberships({uid:'A',epoch:1});
 await runtime.readMyActiveMemberships({uid:'A',epoch:2});assert.equal(reads,2);
 rejectOld(Error('stale-session'));await assert.rejects(first,/stale-session/);
 await runtime.readMyActiveMemberships({uid:'A',epoch:2});assert.equal(reads,3);
});
