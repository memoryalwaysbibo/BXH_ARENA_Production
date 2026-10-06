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
 vm.runInContext('api={'+block(cloud,'async mutateRegistrationRoster(','    async promoteEarliestWaitlist(')+'}',sandbox);
 return {api:sandbox.api,docs};
}
for(const [action,status,confirmed,waiting] of [['promote','waitlist',1,0],['demote','confirmed',0,1]]){
 test(action+' commits a newer roster revision to both mirrors',async()=>{
  const {api,docs}=rosterHarness(status),result=await api.mutateRegistrationRoster('BXH-X','r',action);
  assert.equal(result.verified,true);
  assert.equal(JSON.parse(docs.tour.data).registrationRosterRevision,5);
  assert.equal(JSON.parse(docs.pub.bracketView).registrationRosterRevision,5);
  assert.equal(docs.tour.confirmedCount,confirmed);assert.equal(docs.tour.waitlistCount,waiting);
 });
}
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
