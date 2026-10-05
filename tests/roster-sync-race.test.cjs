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
for(const [action,status,confirmed,waiting] of [['promote','waitlist',1,0],['demote','confirmed',0,1],['cancel','waitlist',0,0]]){
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
