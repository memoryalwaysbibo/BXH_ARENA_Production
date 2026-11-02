'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const core=fs.readFileSync(path.join(root,'modules/main-app/core.js'),'utf8');
const cloud=fs.readFileSync(path.join(root,'modules/cloud/cloud-runtime.js'),'utf8');
function block(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);}
function rosterHarness(status){
 const runtime={id:'room',updatedAt:1,registrationRosterRevision:4,meta:{registrationCapacity:32},players:status==='confirmed'?[{id:'p',source:'online',registrationId:'r',name:'Player'}]:[],waitlistPlayers:[]};
 const docs={tour:{data:JSON.stringify(runtime),capacity:32,confirmedCount:status==='confirmed'?1:0,waitlistCount:status==='waitlist'?1:0},pub:{capacity:32,confirmedCount:status==='confirmed'?1:0,waitlistCount:status==='waitlist'?1:0,tournamentPhase:'waiting'},reg:{status,uid:'u',displayName:'Player'}};
 const snap=key=>({exists:()=>true,data:()=>docs[key]});
 const fx={doc:(_db,collection,_code,_sub,id)=>id?'reg':collection==='tournaments'?'tour':'pub',serverTimestamp:()=>123,
 runTransaction:async(_db,fn)=>fn({get:async key=>snap(key),update:(key,patch)=>Object.assign(docs[key],patch)}),getDoc:async key=>snap(key)};
 const sandbox={fx,dbHandle:{},authReady:true,authHandle:{currentUser:{uid:'admin'}},buildPublicMirrorFields:x=>x,console};
 vm.createContext(sandbox);
 vm.runInContext(block(cloud,'function courtLifecycleWritePatch(','function buildPublicMirrorFields('),sandbox);
 vm.runInContext('api={'+block(cloud,'async mutateRegistrationRoster(','    async promoteEarliestWaitlist(')+'}',sandbox);
 return {api:sandbox.api,docs,fx,sandbox};
}
function occupancyRoom(local,online,capacity){
 const h=rosterHarness('waitlist'),runtime=JSON.parse(h.docs.tour.data);
 runtime.players=[...Array.from({length:local},(_,i)=>({id:'local'+i,name:'Onsite QA',source:'onsite'})),...Array.from({length:online},(_,i)=>({id:'online'+i,source:'online',registrationId:'other'+i}))];
 runtime.meta.registrationCapacity=capacity;
 h.docs.tour.data=JSON.stringify(runtime);
 Object.assign(h.docs.tour,{capacity,confirmedCount:online,waitlistCount:1});
 Object.assign(h.docs.pub,{capacity,confirmedCount:online,waitlistCount:1});
 return h;
}
function earliestHarness(local,online,capacity,team=false){
 const h=occupancyRoom(local,online,capacity),{fx,docs,sandbox}=h;
 fx.collection=(_db,...parts)=>parts.join('/');fx.where=(...args)=>args;fx.orderBy=(...args)=>args;fx.limit=x=>x;fx.query=(...args)=>args;
 fx.getDocs=async()=>({empty:false,docs:[{id:'r'}]});fx.increment=n=>({increment:n});
 fx.runTransaction=async(_db,fn)=>fn({get:async key=>({exists:()=>true,data:()=>docs[key]}),update:(key,patch)=>{for(const [k,v] of Object.entries(patch))docs[key][k]=v&&typeof v==='object'&&'increment'in v?Number(docs[key][k]||0)+v.increment:v;}});
 if(team){docs.tour.battleMode=docs.pub.battleMode='team';const r=JSON.parse(docs.tour.data);r.meta.battleMode='team';docs.tour.data=JSON.stringify(r);}
 vm.runInContext('earliest={'+block(cloud,'async promoteEarliestWaitlist(','    async staffCancelRegistration(')+'}',sandbox);
 h.promote=()=>sandbox.earliest.promoteEarliestWaitlist.call(h.api,'BXH-X');return h;
}
test('earliest individual promotion rejects a room full of onsite players without writes',async()=>{const h=earliestHarness(2,0,2),before=JSON.stringify(h.docs);await assert.rejects(h.promote(),e=>e.code==='capacity-full');assert.equal(JSON.stringify(h.docs),before);});
test('earliest individual promotion atomically fills vacancy in both rosters and counters',async()=>{const h=earliestHarness(1,0,2),r=await h.promote();assert.equal(r.promotedUid,'r');assert.equal(r.verified,true);assert.equal(h.docs.reg.status,'confirmed');assert.equal(JSON.parse(h.docs.tour.data).players.length,2);assert.equal(JSON.parse(h.docs.pub.bracketView).players.length,2);assert.equal(h.docs.pub.registrationStatus,'full');assert.equal(h.docs.tour.capacity,2);});
test('earliest team promotion refuses a full team capacity without writes',async()=>{const h=earliestHarness(0,2,2,true),before=JSON.stringify(h.docs);await assert.rejects(h.promote(),e=>e.code==='capacity-full');assert.equal(JSON.stringify(h.docs),before);});
test('earliest team promotion retains team units and never creates an individual player',async()=>{const h=earliestHarness(0,1,2,true),before=h.docs.tour.data;await h.promote();assert.equal(h.docs.tour.confirmedCount,2);assert.equal(h.docs.pub.confirmedCount,2);assert.equal(h.docs.tour.waitlistCount,0);assert.equal(h.docs.reg.status,'confirmed');assert.equal(h.docs.tour.data,before);});
for(const [kind,patch] of [['draw',{registrationSelection:true}],['bracket',{data:JSON.stringify({id:'room',meta:{registrationCapacity:2},players:[],bracketSize:8})}]])test('earliest promotion cannot bypass '+kind+' control',async()=>{const h=earliestHarness(0,0,2);Object.assign(h.docs.tour,patch);const before=JSON.stringify(h.docs);await assert.rejects(h.promote(),e=>['selection-managed','bracket-locked'].includes(e.code));assert.equal(JSON.stringify(h.docs),before);});
test('earliest candidate changed before commit is rejected without touching others',async()=>{const h=earliestHarness(0,0,2);h.fx.getDocs=async()=>{h.docs.reg.status='cancelled';return {empty:false,docs:[{id:'r'}]};};await assert.rejects(h.promote(),e=>['not-waitlist','candidate-changed-retry'].includes(e.code));assert.equal(h.docs.tour.confirmedCount,0);assert.equal(h.docs.reg.status,'cancelled');});
for(const [local,online] of [[2,0],[1,1]])test(`manual promotion counts ${local} onsite plus ${online} online seats before admitting`,async()=>{
 const {api,docs}=occupancyRoom(local,online,2),before=JSON.stringify(docs);
 await assert.rejects(api.mutateRegistrationRoster('BXH-X','r','promote'),e=>e.code==='capacity-full'&&e.capacity===2);
 assert.equal(JSON.stringify(docs),before,'rejection writes neither capacity, registration nor roster');
});
test('explicit expansion admits once while counters retain their online unit',async()=>{
 const {api,docs}=occupancyRoom(2,0,2);await api.mutateRegistrationRoster('BXH-X','r','promote',{expandBy:8});
 assert.equal(docs.tour.capacity,10);assert.equal(docs.pub.capacity,10);assert.equal(docs.tour.confirmedCount,1);assert.equal(docs.pub.confirmedCount,1);assert.equal(JSON.parse(docs.tour.data).players.length,3);assert.equal(docs.reg.status,'confirmed');
});
test('a remaining seat admits without expansion and marks combined roster full',async()=>{
 const {api,docs}=occupancyRoom(1,0,2);await api.mutateRegistrationRoster('BXH-X','r','promote');
 assert.equal(docs.tour.capacity,2);assert.equal(docs.tour.registrationStatus,'full');assert.equal(docs.pub.registrationStatus,'full');assert.equal(JSON.parse(docs.tour.data).meta.registrationStatus,'full');
});
test('demoting online entrant keeps room full when onsite seats still occupy capacity',async()=>{
 const {api,docs}=rosterHarness('confirmed'),s=JSON.parse(docs.tour.data);s.players.push({id:'a',source:'onsite'},{id:'b',source:'onsite'});s.meta.registrationCapacity=2;
 Object.assign(docs.tour,{data:JSON.stringify(s),capacity:2,registrationStatus:'full'});Object.assign(docs.pub,{capacity:2,registrationStatus:'full'});
 await api.mutateRegistrationRoster('BXH-X','r','demote');assert.equal(docs.tour.registrationStatus,'full');assert.equal(docs.pub.registrationStatus,'full');assert.equal(JSON.parse(docs.tour.data).players.length,2);assert.equal(docs.reg.status,'waitlist');
});
test('projected online rows above a lagging counter cannot be overbooked',async()=>{
 const {api,docs}=occupancyRoom(0,2,2);docs.tour.confirmedCount=0;docs.pub.confirmedCount=0;const before=JSON.stringify(docs);
 await assert.rejects(api.mutateRegistrationRoster('BXH-X','r','promote'),e=>e.code==='capacity-full');assert.equal(JSON.stringify(docs),before);
});
for(const [action,status,confirmed,waiting] of [['promote','waitlist',1,0],['demote','confirmed',0,1]]){
 test(action+' commits a newer roster revision to both mirrors',async()=>{
  const {api,docs}=rosterHarness(status),result=await api.mutateRegistrationRoster('BXH-X','r',action);
  assert.equal(result.verified,true);
  assert.equal(JSON.parse(docs.tour.data).registrationRosterRevision,5);
  assert.equal(JSON.parse(docs.pub.bracketView).registrationRosterRevision,5);
  assert.equal(docs.tour.confirmedCount,confirmed);assert.equal(docs.tour.waitlistCount,waiting);
 });
}
test('roster mutation advances an activated court lifecycle sequence',async()=>{
 const {api,docs}=rosterHarness('waitlist');
 docs.tour.courtLifecycleEpoch=1;docs.tour.courtLifecycleWriteSeq=7;
 docs.tour.data=JSON.stringify({...JSON.parse(docs.tour.data),courtLifecycleEpoch:1});
 const result=await api.mutateRegistrationRoster('BXH-X','r','promote');
 assert.equal(result.verified,true);
 assert.equal(docs.tour.courtLifecycleWriteSeq,8);
 assert.equal(JSON.parse(docs.tour.data).courtLifecycleEpoch,1);
 assert.equal(JSON.parse(docs.pub.bracketView).courtLifecycleEpoch,1);
});
test('committed result retains other waitlist rows and patches promoted status',async()=>{
 const sandbox={state:{id:'room',cloudCode:'BXH-X'},adminRegistrationsCache:[{registrationId:'r',status:'waitlist'},{registrationId:'other',status:'waitlist'}],peopleRegistrationIdOf:r=>r.registrationId,saveRecord:async()=>true,resetRegistrationFormDraft(){},render(){},showToast(){},Date};
 vm.createContext(sandbox);
 vm.runInContext(block(core,'async function peopleApplyCloudRosterResult(','async function peoplePromoteOnline('),sandbox);
 await sandbox.peopleApplyCloudRosterResult({state:{id:'room',players:[{registrationId:'r'}]},registrationId:'r',status:'confirmed'},'done');
 assert.equal(sandbox.adminRegistrationsCache.length,2);
 assert.equal(sandbox.adminRegistrationsCache[0].status,'confirmed');
 assert.equal(sandbox.adminRegistrationsCache[1].status,'waitlist');
});
test('old roster snapshot cannot replace committed state even with a newer clock',()=>{
 const sandbox={state:{id:'room',updatedAt:100,registrationRosterRevision:5,players:[{id:'new'}]},remoteAppliedRoomId:'room',remoteAppliedAt:0,isTournamentFullyDecided:()=>false,finishTournament:async()=>false,defaultState:id=>({id}),saveRecord(){},render(){},getMatch(){},Date};
 vm.createContext(sandbox);
 vm.runInContext(block(core,'function applyRemoteState(','// Phase 1:'),sandbox);
 sandbox.applyRemoteState({id:'room',updatedAt:200,registrationRosterRevision:4,players:[]},true);
 assert.equal(sandbox.state.players[0].id,'new');
 sandbox.applyRemoteState({id:'room',updatedAt:50,registrationRosterRevision:6,players:[{id:'latest'}]});
 assert.equal(sandbox.state.players[0].id,'latest');
});
test('queued registration snapshot cannot reconcile after cache advances',async()=>{
 const sandbox={state:{meta:{registrationEnabled:true},cloudCode:'BXH-X'},window:{cloudSync:{connect:async()=>true,listRegistrationsForAdmin(){throw Error('unexpected read');}}},adminRegistrationsCache:[],peopleRosterBusy:false};
 vm.createContext(sandbox);
 vm.runInContext(block(core,'async function readVerifiedOnlineRoster(','/* ==== render helpers ===='),sandbox);
 const result=await sandbox.syncLatestOnlineRosterBeforeLock([{status:'confirmed'}]);
 assert.equal(result.changed,false);
});

test('cancel mutation delegates to the unified server transaction',async()=>{
 const {api}=rosterHarness('confirmed');let called=0;
 api.cancelRoster=async(code,registrationId,localId,intent)=>{called++;assert.equal(code,'BXH-X');assert.equal(registrationId,'r');assert.equal(localId,'');assert.equal(intent,'admin');return {ok:true,autoPromoted:true};};
 const result=await api.mutateRegistrationRoster('BXH-X','r','cancel');
 assert.equal(called,1);assert.equal(result.autoPromoted,true);
});
test('atomic cancel and fill patches both registration statuses without clearing others',async()=>{
 const sandbox={state:{id:'room',cloudCode:'BXH-X'},adminRegistrationsCache:[{registrationId:'c',status:'confirmed'},{registrationId:'w',status:'waitlist'},{registrationId:'other',status:'waitlist'}],peopleRegistrationIdOf:r=>r.registrationId,saveRecord:async()=>true,resetRegistrationFormDraft(){},render(){},showToast(){},Date};
 vm.createContext(sandbox);
 vm.runInContext(block(core,'async function peopleApplyCloudRosterResult(','async function peoplePromoteOnline('),sandbox);
 await sandbox.peopleApplyCloudRosterResult({state:{id:'room'},registrationChanges:[{registrationId:'c',status:'cancelled'},{registrationId:'w',status:'confirmed'}]},'done');
 assert.deepEqual(Array.from(sandbox.adminRegistrationsCache,row=>row.status),['cancelled','confirmed','waitlist']);
});
test('per-room switch sends a boolean and waits for committed state',async()=>{
 let sent,applied;
 const sandbox={state:{cloudCode:'BXH-X',meta:{}},peopleRosterBusy:false,render(){},showToast(){},
 window:{cloudSync:{configureAutoFill:async(code,enabled)=>{sent={code,enabled};return {ok:true,enabled,state:{meta:{registrationAutoFillEnabled:enabled}}};}}},
 peopleApplyCloudRosterResult:async(result)=>{applied=result;sandbox.state=result.state;sandbox.peopleRosterBusy=false;},peopleMutationErrorMessage:e=>e.message};
 vm.createContext(sandbox);
 vm.runInContext(block(core,'async function peopleToggleAutoFill(','async function peoplePromoteLocal('),sandbox);
 await sandbox.peopleToggleAutoFill();assert.equal(sent.enabled,true);assert.equal(applied.enabled,true);
 sandbox.state.cloudCode='BXH-X';await sandbox.peopleToggleAutoFill();assert.equal(sent.enabled,false);
});
test('both online and onsite cancellation use one server call without client promotion',async()=>{
 const calls=[];
 const sandbox={state:{cloudCode:'BXH-X',meta:{}},peopleRosterBusy:false,render(){},showToast(){},peopleCancellationMessage:()=>'',peopleMutationErrorMessage:e=>e.message,
 window:{cloudSync:{cancelRoster:async(...args)=>{calls.push(args);return {ok:true,autoPromoted:true};},promoteEarliestWaitlist:()=>{throw Error('must not double-promote');}}},
 peopleApplyCloudRosterResult:async()=>{sandbox.peopleRosterBusy=false;}};
 vm.createContext(sandbox);
 vm.runInContext(block(core,'async function peopleCancelOnline(','async function peopleToggleAutoFill('),sandbox);
 await sandbox.peopleCancelOnline('r','Name');await sandbox.peopleCancelLocal('onsite','Local');
 assert.deepEqual(Array.from(calls[0]),['BXH-X','r','','admin']);assert.deepEqual(Array.from(calls[1]),['BXH-X','','onsite','admin']);
});



test('earliest individual promotion rejects a switch to team mode during the transaction',async()=>{const h=earliestHarness(0,0,2),run=h.fx.runTransaction;h.fx.runTransaction=async(db,fn)=>{h.docs.tour.battleMode=h.docs.pub.battleMode='team';const r=JSON.parse(h.docs.tour.data);r.meta.battleMode='team';h.docs.tour.data=JSON.stringify(r);return run(db,fn);};await assert.rejects(h.promote(),e=>e.code==='team-roster-managed');assert.equal(h.docs.reg.status,'waitlist');assert.equal(h.docs.tour.confirmedCount,0);});
test('earliest team promotion rejects switched mode and divergent mirrors',async()=>{for(const mode of ['switch','counter']){const h=earliestHarness(0,0,2,true),run=h.fx.runTransaction;h.fx.runTransaction=async(db,fn)=>{if(mode==='switch')h.docs.pub.battleMode='individual';else h.docs.pub.confirmedCount=1;return run(db,fn);};await assert.rejects(h.promote(),e=>e.code==='registration-state-conflict');assert.equal(h.docs.reg.status,'waitlist');assert.equal(h.docs.tour.confirmedCount,0);}});
test('earliest promotion rejects missing auth and empty queue without writes',async()=>{for(const mode of ['auth','empty']){const h=earliestHarness(0,0,2),before=JSON.stringify(h.docs);if(mode==='auth')h.sandbox.authHandle.currentUser=null;else h.fx.getDocs=async()=>({empty:true,docs:[]});await assert.rejects(h.promote(),e=>e.code===(mode==='auth'?'auth-required':'no-waitlist-candidate'));assert.equal(JSON.stringify(h.docs),before);}});
for(const team of [false,true])test('registration screen applies canonical individual result without treating teams as individuals '+team,async()=>{let applied=0,toasts=[];const s={state:{cloudCode:'BXH-X',meta:{battleMode:team?'team':'individual'}},adminRegistrationsBusy:false,currentTournamentRegistrationLocked:()=>false,render(){},showToast:m=>toasts.push(m),publicTournamentsCache:{},resetAdminRegistrationsCache(){},peopleApplyCloudRosterResult:async()=>{applied++},window:{cloudSync:{promoteEarliestWaitlist:async()=>team?{ok:true}:{ok:true,state:{id:'room'}}}},mapRegistrationError:String};vm.createContext(s);vm.runInContext('function invoke(){const action="admin-promote-waitlist";'+block(core,'  if(action==="admin-promote-waitlist"){','  if(action==="admin-cancel-registration"){')+'}',s);s.invoke();await new Promise(resolve=>setImmediate(resolve));assert.equal(applied,team?0:1);assert.equal(toasts.length,team?1:0);assert.equal(s.adminRegistrationsBusy,false);});


// Late online registrations must only become actionable after the cloud accepts
// their canonical IDs. Exercise the actual family merge and QR write fence.
function lateRosterHarness({qr=true,fail=false}={}){
 const clone=x=>JSON.parse(JSON.stringify(x));let nextId=0,valid=true,reads=0,writes=0;
 const regs=Array.from({length:80},(_,i)=>({registrationId:'r'+i,uid:'u'+i,displayName:i===71?'江佳恩':'Player '+i,status:'confirmed'}));
 const initial={id:'late-room',cloudCode:'BXH-LATE12',updatedAt:1,meta:{registrationEnabled:true,checkinRequired:true,battleMode:'individual'},players:regs.slice(0,68).map((r,i)=>({id:'canonical-'+i,name:r.displayName,source:'online',registrationId:r.registrationId,registrationUid:r.uid,checkedIn:i<40,...(i<40?{checkinFirstAt:100+i,checkinAt:200+i,checkinMethod:'manual'}:{})})),teams:[],...(qr?{qrCheckinManaged:true,qrCheckinRevision:7}:{})};
 let remote=clone(initial),readbackFail=false,writeGate=null;
 const s={state:clone(initial),adminRegistrationsCache:null,peopleRosterBusy:false,publicTournamentsCache:null,myRegistrationsCache:null,
  captureRegistrationRosterContext:()=>({code:'BXH-LATE12',roomId:'late-room'}),
  requireRegistrationRosterContext:()=>{if(!valid)throw Error('context-changed');},registrationRosterContextIsCurrent:()=>valid,
  isCommunityQuickRegistration:()=>false,peopleOnsiteWaitlistManaged:()=>false,cloneStateForSave:clone,
  uid:()=> 'new-'+ ++nextId,computeRegistrationStatus:()=> 'open',touchCommunityActivity(){},cloudAvailable:()=>true,
  saveState:()=>{throw Error('optimistic save forbidden');},
  applyRemoteState:r=>{s.state=clone(r);},window:{cloudSync:{connect:async()=>{},getPublicTournamentFull:async()=>({}),listRegistrationsForAdmin:async()=>clone(regs),
   joinRoom:async()=>{reads++;return readbackFail?{ok:false}:{ok:true,data:clone(remote)};}}},
  enqueueCloudStateWrite:async(code,candidate,options)=>{
   writes++;assert.equal(s.state.players.length,68,'candidate is not exposed before commit');
   if(writeGate)await writeGate;
   if(!options.isCurrent())return false;
   if(fail){s.window.__BXH_LAST_CLOUD_ERROR_CODE='permission-denied';return false;}
   if(qr)require('../modules/main-app/qr-checkin-fence.js').advance({qrCheckinManaged:true,qrCheckinRevision:remote.qrCheckinRevision,data:JSON.stringify(remote)},candidate);
   remote=clone(candidate);return true;
  }};
 vm.createContext(s);
 vm.runInContext(block(fs.readFileSync(path.join(root,'family-ui.js'),'utf8'),'function mergeFamilyOnlineRoster(','async function chooseFamilyRegistrationToCancel('),s);
 vm.runInContext(block(core,'async function readVerifiedOnlineRoster(','/* ==== render helpers ===='),s);
 return {s,initial,clone,setValid:x=>{valid=x},setReadbackFail:x=>{readbackFail=x},setGate:x=>{writeGate=x},remote:()=>remote,stats:()=>({reads,writes})};
}
for(const qr of [false,true])test('68 to 80 sync rejects cloud failure without exposing phantom players; QR='+qr,async()=>{
 const h=lateRosterHarness({qr,fail:true});await assert.rejects(h.s.syncLatestOnlineRosterBeforeLock(),/permission-denied/);
 assert.equal(h.s.state.players.length,68);assert.equal(h.remote().players.length,68);assert.equal(h.s.state.players.filter(p=>p.checkedIn).length,40);
});
test('68 to 80 sync waits for commit, preserves check-ins and exposes only canonical IDs',async()=>{
 const h=lateRosterHarness();let release;h.setGate(new Promise(r=>{release=r}));
 const pending=h.s.syncLatestOnlineRosterBeforeLock();await new Promise(r=>setImmediate(r));assert.equal(h.s.state.players.length,68);release();
 const result=await pending;assert.equal(result.changed,true);assert.equal(h.s.state.players.length,80);assert.equal(h.s.state.qrCheckinRevision,8);
 assert.equal(h.s.state.players.filter(p=>p.checkedIn).length,40);assert.equal(h.s.state.players[71].name,'江佳恩');
 assert.equal(h.s.state.players[71].id,h.remote().players[71].id);assert.equal(h.s.state.players[0].id,'canonical-0');
 const ids=h.s.state.players.map(p=>p.id);await h.s.syncLatestOnlineRosterBeforeLock();assert.deepEqual(h.s.state.players.map(p=>p.id),ids);assert.equal(h.stats().writes,1,'an unchanged retry does not create another version');
});
test('fresh canonical QR state recovers a stale local revision before late roster sync',async()=>{
 const h=lateRosterHarness();h.s.state.qrCheckinRevision=3;
 await h.s.syncLatestOnlineRosterBeforeLock();assert.equal(h.s.state.qrCheckinRevision,8);assert.equal(h.s.state.players.length,80);
});
test('readback failure does not publish an unverified candidate; retry recovers committed IDs',async()=>{
 const h=lateRosterHarness(),join=h.s.window.cloudSync.joinRoom;let count=0;
 h.s.window.cloudSync.joinRoom=async()=> (++count>=2&&count<=4)?{ok:false}:join();
 await assert.rejects(h.s.syncLatestOnlineRosterBeforeLock(),/roster-readback-failed/);
 assert.equal(h.s.state.players.length,68);assert.equal(h.remote().players.length,80);
 await h.s.syncLatestOnlineRosterBeforeLock();assert.equal(h.s.state.players[71].id,h.remote().players[71].id);assert.equal(h.stats().writes,1);
});
test('room or account switch while queued prevents the roster commit and publication',async()=>{
 const h=lateRosterHarness();let release;h.setGate(new Promise(r=>{release=r}));const pending=h.s.syncLatestOnlineRosterBeforeLock();
 await new Promise(r=>setImmediate(r));h.setValid(false);release();await assert.rejects(pending,/context-changed/);
 assert.equal(h.s.state.players.length,68);assert.equal(h.remote().players.length,68);
});
test('QR revision outranks device clock and older check-in snapshots cannot undo it',()=>{
 const s={state:{id:'room',cloudCode:'BXH-X',qrCheckinManaged:true,qrCheckinRevision:7,updatedAt:500,players:[{id:'p',checkedIn:false}]},remoteAppliedRoomId:'room',remoteAppliedAt:500,
 isTournamentFullyDecided:()=>false,finishTournament:async()=>false,defaultState:id=>({id}),saveRecord(){},render(){},getMatch(){},Date};vm.createContext(s);vm.runInContext(block(core,'function applyRemoteState(','// Phase 1:'),s);
 s.applyRemoteState({id:'room',qrCheckinManaged:true,qrCheckinRevision:8,updatedAt:100,players:[{id:'p',checkedIn:true}]});
 assert.equal(s.state.qrCheckinRevision,8);assert.equal(s.state.players[0].checkedIn,true);
 s.applyRemoteState({id:'room',qrCheckinManaged:true,qrCheckinRevision:7,updatedAt:900,players:[{id:'p',checkedIn:false}]},true);
 assert.equal(s.state.players[0].checkedIn,true);
});
test('successful detached writes adopt the committed QR revision for the next save',async()=>{
 const s={state:{id:'room',cloudCode:'BXH-X',qrCheckinManaged:true,qrCheckinRevision:7,players:[{id:'p',checkedIn:false}]},currentAuthUid:()=> 'u',cloudWriteChain:Promise.resolve(true),cloudAvailable:()=>true,
 window:{cloudSync:{pushUpdate:async(code,snapshot)=>{snapshot.qrCheckinRevision++;snapshot.players[0].checkedIn=true;snapshot.players[0].checkinAt=123;return true;}}}};
 vm.createContext(s);vm.runInContext(block(core,'function enqueueCloudStateWrite(','async function flushCloudStateWrites('),s);
 const snapshot=JSON.parse(JSON.stringify(s.state));await s.enqueueCloudStateWrite('BXH-X',snapshot);
 assert.equal(s.state.qrCheckinRevision,8);assert.equal(s.state.players[0].checkedIn,true);assert.equal(s.state.players[0].checkinAt,123);
});
for(const change of ['account','room','newer-checkin'])test('write acknowledgment does not overwrite changed '+change,async()=>{
 let uid='u',release;const gate=new Promise(r=>{release=r});
 const s={state:{id:'room',cloudCode:'BXH-X',qrCheckinManaged:true,qrCheckinRevision:7,players:[{id:'p',checkedIn:true}]},currentAuthUid:()=>uid,cloudWriteChain:Promise.resolve(true),cloudAvailable:()=>true,
 window:{cloudSync:{pushUpdate:async(code,snapshot)=>{await gate;snapshot.qrCheckinRevision=8;snapshot.players[0].checkedIn=false;return true;}}}};
 vm.createContext(s);vm.runInContext(block(core,'function enqueueCloudStateWrite(','async function flushCloudStateWrites('),s);
 const pending=s.enqueueCloudStateWrite('BXH-X',JSON.parse(JSON.stringify(s.state)));await new Promise(r=>setImmediate(r));
 if(change==='account')uid='other';if(change==='room')s.state={...s.state,cloudCode:'BXH-OTHER1'};if(change==='newer-checkin')s.state.qrCheckinRevision=9;
 release();await pending;assert.equal(s.state.players[0].checkedIn,true);assert.equal(s.state.qrCheckinRevision,change==='newer-checkin'?9:7);
});
test('newly synchronized Jiang Jia En is accepted by the trusted manual check-in transition',async()=>{
 const h=lateRosterHarness();await h.s.syncLatestOnlineRosterBeforeLock();
 const player=h.s.state.players.find(p=>p.registrationId==='r71');assert.equal(player.name,'江佳恩');
 const output=require('../qr-checkin/backend/core.cjs').transition({code:'BXH-LATE12',uid:'admin',user:{active:true,role:'admin'},
 room:{},state:h.remote(),config:{enabled:true,writerGuardsVerified:true,roomCodes:['BXH-LATE12']},
 d:{action:'manual',playerId:player.id,operationId:'jiang-checkin-operation-001'},now:123456});
 assert.equal(output.result.ok,true);assert.equal(output.result.checkedIn,true);assert.equal(output.playerId,player.id);
});
for(const unavailable of [false,true])test('server-only recovery never falls back to a cached roster; failure='+unavailable,async()=>{
 let serverReads=0,cacheReads=0;
 const s={cloudEnabled:true,dbHandle:{},console:{warn(){}},fx:{doc:()=> 'private-ref',getDoc:async()=>{cacheReads++;throw Error('cache must not be used');},getDocFromServer:async()=>{serverReads++;if(unavailable)throw Error('offline');return {exists:()=>true,data:()=>({data:JSON.stringify({id:'room',players:[]})})};}}};
 vm.createContext(s);vm.runInContext('api={'+block(cloud,'async joinRoom(code){','    // Guest/public use')+'}',s);
 const result=await s.api.joinRoom('BXH-LATE12',{serverOnly:true});assert.equal(cacheReads,0);assert.equal(serverReads,1);assert.equal(result.ok,!unavailable);
});
const candidateCompute=block(core,'function computeRegistrationStatus(','function publicationValidationErrors(');
function schedule(h, {early=false}={}){
 const setup={registrationOpenAt:1000,registrationCloseAt:9000,registrationStatus:'closed',checkinClosedEarly:early};
 Object.assign(h.s.state.meta,setup);Object.assign(h.remote().meta,setup);
 h.s.Date={now:()=>10000};
 vm.runInContext(candidateCompute,h.s);
 assert.equal(h.s.computeRegistrationStatus(h.s.state.meta,h.s.state),'closed');
 h.s.state.meta.registrationCloseAt=20000;h.remote().meta.registrationCloseAt=20000;
 h.s.state.meta.registrationStatus=h.s.computeRegistrationStatus(h.s.state.meta,h.s.state);
 h.remote().meta.registrationStatus=h.s.state.meta.registrationStatus;
 assert.equal(h.s.state.meta.registrationStatus,'open');
}
function manual(h,playerId){
 return require('../qr-checkin/backend/core.cjs').transition({
 code:'BXH-LATE12',uid:'admin',user:{active:true,role:'admin'},room:{},state:h.remote(),
 config:{enabled:true,writerGuardsVerified:true,roomCodes:['BXH-LATE12']},
 d:{action:'manual',playerId,operationId:'reopen-checkin-operation-001'},now:10000
 });
}
test('deadline -> reopen -> 80 confirmed mock rows -> sync -> trusted manual checkin; existing 40 retained',async()=>{
 const h=lateRosterHarness();schedule(h);await h.s.syncLatestOnlineRosterBeforeLock();
 assert.equal(h.remote().players.length,80);assert.equal(h.remote().players.filter(p=>p.checkedIn).length,40);
 const p=h.s.state.players.find(p=>p.registrationId==='r71');
 assert.equal(p.name,'江佳恩');assert.equal(manual(h,p.id).result.checkedIn,true);
 assert.equal(h.s.state.meta.registrationStatus,'open');
});
test('reopen with cloud rejection keeps canonical 68; no phantom check-in player',async()=>{
 const h=lateRosterHarness({fail:true});schedule(h);
 await assert.rejects(h.s.syncLatestOnlineRosterBeforeLock(),/permission-denied/);
 assert.equal(h.s.state.players.length,68);assert.equal(h.remote().players.length,68);
 assert.equal(h.s.state.players.some(p=>p.registrationId==='r71'),false);
});
test('expired registration deadline alone does not close manual checkin of existing confirmed player',()=>{
 const h=lateRosterHarness();schedule(h);
 h.remote().meta.registrationCloseAt=9000;h.remote().meta.registrationStatus='closed';
 assert.equal(manual(h,'canonical-50').result.checkedIn,true);
});
test('reopen registration does not clear deliberate checkin close flag',async()=>{
 const h=lateRosterHarness();schedule(h,{early:true});await h.s.syncLatestOnlineRosterBeforeLock();
 assert.equal(h.remote().meta.registrationStatus,'open');
 assert.equal(h.remote().meta.checkinClosedEarly,true);
 assert.throws(()=>manual(h,h.remote().players[71].id),e=>e.code==='checkin-closed');
});
test('reopen and readback failure followed by retry retains committed player IDs',async()=>{
 const h=lateRosterHarness();schedule(h);let reads=0;const join=h.s.window.cloudSync.joinRoom;
 h.s.window.cloudSync.joinRoom=async()=>(++reads>=2&&reads<=4)?{ok:false}:join();
 await assert.rejects(h.s.syncLatestOnlineRosterBeforeLock(),/roster-readback-failed/);
 const id=h.remote().players[71].id;assert.equal(h.s.state.players.length,68);
 await h.s.syncLatestOnlineRosterBeforeLock();
 assert.equal(h.s.state.players[71].id,id);assert.equal(h.stats().writes,1);
 assert.equal(manual(h,id).result.ok,true);
});
test('changing deadline after actual start cannot reopen registration or checkin',()=>{
 const h=lateRosterHarness();schedule(h);h.remote().startedAt=8000;h.s.state.startedAt=8000;
 assert.equal(h.s.computeRegistrationStatus(h.s.state.meta,h.s.state),'started');
 assert.throws(()=>manual(h,'canonical-50'),e=>e.code==='checkin-closed');
});
test('trusted check-in missing canonical player reproduces not-confirmed regardless of open schedule',()=>{
 const h=lateRosterHarness();schedule(h);
 assert.throws(()=>manual(h,'phantom-jiang-id'),e=>e.code==='not-confirmed');
});

test('one stale QR readback is retried without writing the roster twice',async()=>{
 const h=lateRosterHarness(),join=h.s.window.cloudSync.joinRoom;let calls=0;
 h.s.window.cloudSync.joinRoom=async()=>{calls++;if(calls===2)return {ok:true,data:h.clone(h.initial)};return join();};
 const r=await h.s.syncLatestOnlineRosterBeforeLock();
 assert.equal(r.ok,true);assert.equal(calls,3);assert.equal(h.stats().writes,1);
 assert.equal(h.s.state.players.length,80);assert.equal(h.s.state.qrCheckinRevision,8);
 assert.equal(h.s.state.players.filter(p=>p.checkedIn).length,40);
});
test('a transient failed server read is retried without a second commit',async()=>{
 const h=lateRosterHarness(),join=h.s.window.cloudSync.joinRoom;let calls=0;
 h.s.window.cloudSync.joinRoom=async()=>++calls===2?{ok:false,reason:'network'}:join();
 assert.equal((await h.s.syncLatestOnlineRosterBeforeLock()).ok,true);
 assert.equal(calls,3);assert.equal(h.stats().writes,1);
});
test('persistent stale readback remains an error with expected and observed QR revisions',async()=>{
 const h=lateRosterHarness(),join=h.s.window.cloudSync.joinRoom;let calls=0;
 h.s.window.cloudSync.joinRoom=async()=>++calls===1?join():{ok:true,data:h.clone(h.initial)};
 await assert.rejects(h.s.syncLatestOnlineRosterBeforeLock(),e=>e.code==='roster-readback-failed'&&e.expectedQrRevision===8&&e.observedQrRevision===7);
 assert.equal(calls,4);assert.equal(h.stats().writes,1);assert.equal(h.s.state.players.length,68);
 assert.equal(h.remote().players.length,80);
 h.s.window.cloudSync.joinRoom=join;
 await h.s.syncLatestOnlineRosterBeforeLock();assert.equal(h.stats().writes,1);assert.equal(h.s.state.players.length,80);
});
test('newer concurrent checkin readback is accepted and retained',async()=>{
 const h=lateRosterHarness(),join=h.s.window.cloudSync.joinRoom;let calls=0;
 h.s.window.cloudSync.joinRoom=async()=>{if(++calls===2){h.remote().qrCheckinRevision=9;h.remote().players[71].checkedIn=true;}return join();};
 await h.s.syncLatestOnlineRosterBeforeLock();assert.equal(h.s.state.qrCheckinRevision,9);
 assert.equal(h.s.state.players[71].checkedIn,true);assert.equal(calls,2);assert.equal(h.stats().writes,1);
});
for(const failure of ['private','not-found','wrong-room'])test('readback stops immediately on '+failure,async()=>{
 const h=lateRosterHarness(),join=h.s.window.cloudSync.joinRoom;let calls=0;
 h.s.window.cloudSync.joinRoom=async()=>++calls===1?join():failure==='wrong-room'?{ok:true,data:{id:'other',qrCheckinRevision:99}}:{ok:false,reason:failure};
 await assert.rejects(h.s.syncLatestOnlineRosterBeforeLock(),/roster-readback-failed/);
 assert.equal(calls,2);assert.equal(h.s.state.players.length,68);
});
test('account or room change during stale readback stops recovery',async()=>{
 const h=lateRosterHarness(),join=h.s.window.cloudSync.joinRoom;let calls=0;
 h.s.window.cloudSync.joinRoom=async()=>{if(++calls===2){h.setValid(false);return {ok:true,data:h.clone(h.initial)};}return join();};
 await assert.rejects(h.s.syncLatestOnlineRosterBeforeLock(),/context-changed/);assert.equal(calls,2);assert.equal(h.s.state.players.length,68);
});


function auditRosterMerge(players,rows){
 const s={};vm.createContext(s);
 const family=fs.readFileSync(path.join(root,'family-ui.js'),'utf8');
 vm.runInContext(block(family,'function mergeFamilyOnlineRoster(','async function chooseFamilyRegistrationToCancel('),s);
 return JSON.parse(JSON.stringify(s.mergeFamilyOnlineRoster(players,rows,true,()=> 'new-player-id')));
}
for(const child of [false,true])test('check-in audit survives family roster merge; child='+child,()=>{
 const old={id:'p1',name:'Player',source:'online',registrationUid:'guardian',registrationId:'registration',checkedIn:true};
 if(child)Object.assign(old,{familyPlayerId:'child',participantId:'child',guardianUid:'guardian'});
 Object.assign(old,{checkinFirstAt:100,checkinAt:200,checkinMethod:'manual'});
 const row={status:'confirmed',uid:'guardian',registrationId:'registration',displayName:'Player',...(child?{familyPlayerId:'child',guardianUid:'guardian'}:{})};
 const merged=auditRosterMerge([old],[row]);
 assert.deepEqual(merged,[old]);
 assert.equal(merged[0].id,'p1');
});
test('unchanged QR roster stays clean after the real QR write fence',()=>{
 const rows=[{status:'confirmed',uid:'guardian',registrationId:'registration',displayName:'Player'}];
 const canonical={qrCheckinManaged:true,qrCheckinRevision:7,players:[{id:'p1',name:'Player',source:'online',registrationUid:'guardian',registrationId:'registration',checkedIn:true,checkinFirstAt:100,checkinAt:200,checkinMethod:'manual'}]};
 let candidate={...canonical,players:auditRosterMerge(canonical.players,rows)};
 assert.deepEqual(candidate.players,canonical.players);
 const fence=require('../modules/main-app/qr-checkin-fence.js');
 fence.advance({qrCheckinManaged:true,qrCheckinRevision:7,data:JSON.stringify(canonical)},candidate,7);
 assert.deepEqual(auditRosterMerge(candidate.players,rows),candidate.players);
 assert.equal(candidate.qrCheckinRevision,8);
});
test('new registration cannot supply check-in audit or inherit another player audit',()=>{
 const rows=[{status:'confirmed',uid:'new',registrationId:'new-reg',displayName:'New',checkinAt:900,checkinFirstAt:900,checkinMethod:'qr'}];
 const merged=auditRosterMerge([],rows);
 assert.equal(merged[0].checkedIn,false);
 for(const k of ['checkinAt','checkinFirstAt','checkinMethod'])assert.equal(Object.hasOwn(merged[0],k),false);
});
