'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const cloud=fs.readFileSync(__dirname+'/../modules/cloud/cloud-runtime.js','utf8'),core=fs.readFileSync(__dirname+'/../modules/main-app/core.js','utf8');
const block=(s,a,b)=>{const i=s.indexOf(a),j=s.indexOf(b,i);assert(i>=0&&j>i);return s.slice(i,j);};
function cloudHarness(error){
 let calls=0;
 const s={authReady:true,authHandle:{currentUser:{uid:'staff'}},dbHandle:{},crypto:{randomUUID:()=> 'operation-example-123'},fx:{doc:(_db,col)=>col,getDoc:async col=>({exists:()=>true,data:()=>({eventAuthority:'official',refereeSeatsV1:col==='tournaments'?{version:1}:undefined})}),runTransaction:()=>{throw Error('must not use browser runtime write');}},callEngagementFunction:async(name,d)=>{calls++;assert.equal(name,'promoteSeatedRegistration');assert.equal(d.registrationId,'candidate');assert.equal(d.expandBy,0);if(error)throw error;return {ok:true,verified:true,state:{id:'room'},capacity:88,confirmedCount:81,waitlistCount:0};}};
 vm.createContext(s);vm.runInContext('api={'+block(cloud,'async mutateRegistrationRoster(','    async promoteEarliestWaitlist(')+'}',s);return {s,calls:()=>calls};
}
test('seat-enabled staff promotion sends only intent to trusted callable',async()=>{const h=cloudHarness();const r=await h.s.api.mutateRegistrationRoster('BXH-TEST','candidate','promote');assert.equal(h.calls(),1);assert.equal(r.verified,true);});
test('callable capacity-full reaches existing +8 confirmation handling',async()=>{const h=cloudHarness(Object.assign(Error('capacity-full functions/failed-precondition'),{code:'functions/failed-precondition'}));await assert.rejects(h.s.api.mutateRegistrationRoster('BXH-TEST','candidate','promote'),e=>e.code==='capacity-full');});
function onsiteHarness(saved=true){let resolveSave,modalSnapshot;const messages=[],stored=[];const s={state:{id:'room',cloudCode:'BXH-TEST',meta:{checkinRequired:true},players:[]},peopleRosterBusy:false,adminRegistrationsCache:[],adminRosterCode:'BXH-TEST',adminRegistrationsLoading:false,adminRegistrationsError:null,isCommunityQuickRegistration:()=>false,openModal:modal=>{modalSnapshot=modal;},uid:()=> 'new-guest',window:{__BXH_LAST_CLOUD_ERROR_CODE:'permission-denied'},render(){},saveState:()=>new Promise(resolve=>{resolveSave=resolve;}),saveRecord:async state=>{stored.push(state);return true;},cloneStateForSave:s=>JSON.parse(JSON.stringify(s)),showToast:(...args)=>messages.push(args),document:{getElementById:()=>({value:'Synthetic'})}};vm.createContext(s);vm.runInContext(block(core,'async function peopleQuickAddPlayers(','async function peopleDemoteOnline('),s);return {s,messages,stored,modal:()=>modalSnapshot,finish:()=>resolveSave(saved)};}
test('onsite addition waits for cloud acceptance before announcing success',async()=>{const h=onsiteHarness(),p=h.s.peopleQuickAddPlayers(['Synthetic'],true);assert.equal(h.messages.length,0);h.finish();await p;assert.match(h.messages[0][0],/已新增/);assert.equal(h.s.state.players.length,1);});
test('rejected onsite save removes only the newly added guest and never announces success',async()=>{const h=onsiteHarness(false),p=h.s.peopleQuickAddPlayers(['Synthetic'],true);h.s.state.players.push({id:'another-device',name:'Other'});h.finish();await p;assert.deepEqual(Array.from(h.s.state.players,p=>p.id),['another-device']);assert.equal(h.stored.length,1);assert.equal(h.messages[0][1],true);assert(!h.messages.some(m=>m[0].startsWith('已新增')));});
test('late onsite response cannot alter a newly selected room',async()=>{const h=onsiteHarness(false),p=h.s.peopleQuickAddPlayers(['Synthetic'],true);h.s.state={id:'other',cloudCode:'BXH-OTHER',players:[]};h.finish();await p;assert.equal(h.messages.length,0);assert.equal(h.s.state.players.length,0);});

test('onsite guest addition waits for registration sync',async()=>{
  const h=onsiteHarness();h.s.state.meta.registrationEnabled=true;h.s.adminRegistrationsCache=null;
  const result=await h.s.peopleQuickAddPlayers(['Synthetic']);
  assert.equal(result,false);assert.equal(h.s.state.players.length,0);assert.match(h.modal().title,/同步/);
});
test('same-name registered player requires explicit distinct-person confirmation',async()=>{
  const h=onsiteHarness();h.s.state.meta.registrationEnabled=true;
  h.s.adminRegistrationsCache=[{realName:'Synthetic',status:'waitlist'}];
  const result=await h.s.peopleQuickAddPlayers(['Synthetic']);
  assert.equal(result,false);assert.equal(h.s.state.players.length,0);
  assert.match(h.modal().message,/線上報名/);assert.match(h.modal().message,/不會取得獵人榜/);
  const save=h.modal().onConfirm();assert.equal(h.s.state.players.length,1);h.finish();await save;
});
