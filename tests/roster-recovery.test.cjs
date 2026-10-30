'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {createJournal}=require('../modules/main-app/roster-recovery.js');
const core=fs.readFileSync(__dirname+'/../modules/main-app/core.js','utf8'),cloud=fs.readFileSync(__dirname+'/../modules/cloud/cloud-runtime.js','utf8');
const block=(s,a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));
const storage=()=>{const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};};
test('recovery journal loads before the main app and both changed bundles have fresh cache keys',()=>{
 const html=fs.readFileSync(__dirname+'/../index.html','utf8');
 assert(html.indexOf('src="modules/main-app/roster-recovery.js?')<html.indexOf('id="bxh-main-app-m7"'));
 for(const p of ['modules/main-app/core.js','modules/cloud/cloud-runtime.js'])assert(new RegExp('src="'+p.replaceAll('.','\\.')+'\\?[^\"]*roster-recovery=20261030.1').test(html));
});
test('unknown operation survives refresh and is isolated by actor, room, candidate and expansion',()=>{
 const store=storage();let n=0;const uuid=()=> 'operation-number-'+(++n),c={uid:'staff',code:'BXH-TEST',registrationId:'r',expandBy:0};
 const a=createJournal(store,uuid),id=a.begin(c),b=createJournal(store,uuid);
 assert.equal(b.begin(c),id);
 for(const patch of [{uid:'other'},{code:'BXH-OTHER'},{registrationId:'other'},{expandBy:8}])assert.notEqual(b.begin({...c,...patch}),id);
 b.finish(c,'different-id');assert.equal(b.begin(c),id);b.finish(c,id);assert.notEqual(b.begin(c),id);
});
function harness({mutate,read}={}){
 let n=0;const calls=[],modals=[],messages=[],applied=[];
 const context={roomId:'room',code:'BXH-TEST',uid:'staff',registrationId:'candidate',expandBy:0,players:80,waitlist:1};
 const s={state:{id:'room',cloudCode:'BXH-TEST',meta:{registrationCapacity:88},players:Array(80).fill({}),waitlistPlayers:[{}]},actor:'staff',peopleRosterBusy:false,render(){},
 currentAuthUid:()=>s.actor,showToast:m=>messages.push(m),openModal:m=>modals.push(m),setTimeout,clearTimeout,
 peopleApplyCloudRosterResult:async(result,message)=>{applied.push(result);s.state={...result.state,cloudCode:'BXH-TEST'};messages.push(message);s.peopleRosterBusy=false;},
 window:{BXHRosterRecovery:createJournal(storage(),()=> 'operation-number-'+(++n)),cloudSync:{
 mutateRegistrationRoster:async(...args)=>{calls.push(args);return mutate?mutate(...args):{state:{id:'room',meta:{registrationCapacity:88}},capacity:88};},
 readRegistrationRosterRecovery:async(...args)=>read(...args)
 }}};
 vm.createContext(s);vm.runInContext(block(core,'function peoplePromotionContextCurrent(','async function peopleQuickAddPlayers('),s);
 return {s,calls,modals,messages,applied,context};
}
const remote=(patch={})=>({state:{id:'room',meta:{registrationCapacity:88},players:Array(81).fill({}),waitlistPlayers:[]},registrationId:'candidate',status:'confirmed',countsAgree:true,achieved:true,retryable:false,...patch});
const lost=()=>Object.assign(Error('response lost'),{code:'functions/unavailable'});
test('server accepted but response lost synchronizes success without sending a second write',async()=>{
 const h=harness({mutate:async()=>{throw lost();},read:async()=>remote()});
 await h.s.peoplePromoteOnline('candidate','Synthetic');assert.equal(h.calls.length,1);assert.equal(h.applied.length,1);assert.equal(h.modals.length,0);assert.match(h.messages[0],/雲端目前已是正取/);
});
test('offline read preserves the intent and offers recheck or return, then reuses the same ID',async()=>{
 let n=0;const h=harness({mutate:async()=>{if(++n===1)throw lost();return remote();},read:async()=>{throw lost();}});
 await h.s.peoplePromoteOnline('candidate','Synthetic');assert.equal(h.s.peopleRosterBusy,false);assert.equal(h.modals[0].confirmLabel,'重新核對雲端');assert.match(h.modals[0].cancelLabel,/稍後處理/);
 await h.s.peoplePromoteOnline('candidate','Synthetic');assert.equal(h.calls[0][3].operationId,h.calls[1][3].operationId);
});
test('conflict requires cloud sync and explicit retry, resending intent only',async()=>{
 let n=0;const h=harness({mutate:async()=>{if(++n===1)throw Object.assign(Error('changed'),{code:'registration-state-conflict'});return remote();},read:async()=>remote({status:'waitlist',achieved:false,retryable:true})});
 await h.s.peoplePromoteOnline('candidate','Synthetic');assert.equal(h.calls.length,1);assert.equal(h.modals[0].confirmLabel,'同步雲端資料');
 await h.modals[0].onConfirm();assert.equal(h.calls.length,1);assert.equal(h.modals[1].cancelLabel,'維持雲端資料');
 await h.modals[1].onConfirm();assert.equal(h.calls.length,2);assert.equal(h.calls[0][3].operationId,h.calls[1][3].operationId);assert.deepEqual(Object.keys(h.calls[1][3]).sort(),['expandBy','operationId']);
});
test('cloud cancellation is retained with no retry or overwrite option',async()=>{
 const h=harness({mutate:async()=>{throw lost();},read:async()=>remote({status:'cancelled',achieved:false,retryable:false})});
 await h.s.peoplePromoteOnline('candidate','Synthetic');await h.modals[0].onConfirm();assert.equal(h.modals.length,1);assert.equal(h.calls.length,1);
});
test('inconsistent cloud snapshots only offer a read recheck',async()=>{
 const h=harness({mutate:async()=>{throw lost();},read:async()=>remote({countsAgree:false,achieved:false})});
 await h.s.peoplePromoteOnline('candidate','Synthetic');assert.equal(h.modals[0].confirmLabel,'重新核對雲端');assert.equal(h.applied.length,0);
});
test('superseded receipt gets a new ID only after explicit reconciliation',async()=>{
 let n=0;const h=harness({mutate:async()=>{if(++n===1)throw Object.assign(Error('operation-outdated'),{code:'operation-outdated'});return remote();},read:async()=>remote({status:'waitlist',achieved:false,retryable:true})});
 await h.s.peoplePromoteOnline('candidate','Synthetic');await h.modals[0].onConfirm();await h.modals[1].onConfirm();assert.notEqual(h.calls[0][3].operationId,h.calls[1][3].operationId);
});
test('late operation success after account switch cannot apply state to the new actor',async()=>{
 let finish;const h=harness({mutate:()=>new Promise(r=>finish=r)});
 const task=h.s.peoplePromoteOnline('candidate','Synthetic');h.s.actor='other';finish(remote());await task;assert.equal(h.applied.length,0);assert.equal(h.modals.length,0);
});
function readHarness({status='confirmed',mismatch=false}={}){
 const candidate={id:'p',registrationId:'candidate'},state={id:'room',meta:{},players:[candidate]},docs={
 tournaments:{capacity:88,confirmedCount:81,waitlistCount:0,tournamentPhase:'waiting',data:JSON.stringify(state)},
 publicTournaments:{capacity:88,confirmedCount:mismatch?80:81,waitlistCount:0,tournamentPhase:'waiting',bracketView:JSON.stringify({players:[{id:'p'}]})},reg:{status}};
 const s={authReady:true,authHandle:{currentUser:{uid:'staff'}},dbHandle:{},fx:{doc:(_db,col,_code,sub)=>sub?'reg':col,runTransaction:async(_db,fn)=>fn({get:async ref=>({exists:()=>true,data:()=>docs[ref]})})}};
 vm.createContext(s);vm.runInContext('api={'+block(cloud,'async readRegistrationRosterRecovery(','    async mutateRegistrationRoster(')+'}',s);return s;
}
test('consistent readback identifies completed promotion without writing anything',async()=>{const s=readHarness(),r=await s.api.readRegistrationRosterRecovery('BXH-TEST','candidate');assert.equal(r.achieved,true);assert.equal(r.retryable,false);});
test('divergent mirrors cannot be treated as a completed promotion',async()=>{const s=readHarness({mismatch:true}),r=await s.api.readRegistrationRosterRecovery('BXH-TEST','candidate');assert.equal(r.achieved,false);assert.equal(r.countsAgree,false);});
