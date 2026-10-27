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
 const sandbox={state:{id:'room',updatedAt:100,registrationRosterRevision:5,players:[{id:'new'}]},remoteAppliedRoomId:'room',remoteAppliedAt:0,defaultState:id=>({id}),saveRecord(){},render(){},getMatch(){},Date};
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
 vm.runInContext(block(core,'async function syncLatestOnlineRosterBeforeLock(','/* ==== render helpers ===='),sandbox);
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
