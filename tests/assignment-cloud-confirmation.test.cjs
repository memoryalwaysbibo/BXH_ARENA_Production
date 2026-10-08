'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {test}=require('node:test');
const cloud=fs.readFileSync('modules/cloud/cloud-runtime.js','utf8');
const clone=v=>JSON.parse(JSON.stringify(v));
function method(name){const a=cloud.indexOf('    async '+name+'('),b=cloud.indexOf('\n    },',a);assert(a>=0&&b>a);return cloud.slice(a,b+6);}
function merge(a,b){const out=clone(a||{});for(const [k,v] of Object.entries(b)){out[k]=v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length?merge(out[k],v):clone(v);}return out;}
function room(){return {id:'room',createdBy:'admin',meta:{eventAuthority:'official',stations:1,assignedStaffUids:[],refereeStationAssignments:{},refereeStationNames:{},refereeStationRestrictionEnabled:false},players:[],matches:[],archiveStatus:'ongoing'};}
function harness(){
 const docs=new Map(),logs=[],reads=[],stale=new Map();let afterCommit=null;
 const initial=room();docs.set('tournaments/ROOM',{data:JSON.stringify(initial),createdBy:'admin',assignedStaffUids:[],refereeStationAssignments:{},refereeStationNames:{}});
 docs.set('publicTournaments/ROOM',{bracketView:JSON.stringify({meta:clone(initial.meta)})});
 docs.set('users/admin',{active:true,role:'admin',displayName:'Admin'});
 docs.set('staffDirectory/ref',{active:true,role:'staff',displayName:'Referee'});
 docs.set('users/ref',{active:true,role:'staff',displayName:'Referee',realName:'王裁判'});
 const snap=value=>({exists:()=>value!=null,data:()=>clone(value),metadata:{hasPendingWrites:false}});
 const fx={doc:(_db,...parts)=>parts.join('/'),getDoc:async key=>snap(docs.get(key)),getDocFromServer:async key=>{reads.push(key);const queue=stale.get(key)||[];return snap(queue.length?queue.shift():docs.get(key));},
 runTransaction:async(_db,fn)=>{const pending=[];const result=await fn({get:async key=>snap(docs.get(key)),set:(key,patch,options)=>pending.push({key,patch,deep:!!options?.merge}),update:(key,patch)=>pending.push({key,patch,deep:false})});for(const {key,patch,deep} of pending)docs.set(key,deep?merge(docs.get(key),patch):{...clone(docs.get(key)||{}),...clone(patch)});if(afterCommit){const f=afterCommit;afterCommit=null;await f();}return result;}};
 const context={window:{},console:{warn:(...args)=>logs.push(args)},setTimeout:fn=>{fn();return 1;},fx,dbHandle:{},cloudEnabled:true,authHandle:{currentUser:{uid:'admin'}},USERS_COLLECTION:'users',userProfile:{role:'admin',active:true},currentUserDisplayNameForWrites:()=> 'Admin',currentUserUidForWrites:()=> 'admin',isPartnerOrganizerMode:()=>false,isEventStaffMode:()=>false,computeTournamentPhase:()=> 'waiting',buildPublicMirrorFields:state=>({meta:{refereeStationNames:state.meta.refereeStationNames,refereeStationRestrictionEnabled:state.meta.refereeStationRestrictionEnabled}})};
 vm.createContext(context);
 const lifecycleStart=cloud.indexOf('  function courtLifecycleWritePatch(');
 const lifecycleEnd=cloud.indexOf('\n  function ',lifecycleStart+3);
 assert(lifecycleStart>=0&&lifecycleEnd>lifecycleStart);
 vm.runInContext(cloud.slice(lifecycleStart,lifecycleEnd),context);
 vm.runInContext('api={'+['pushUpdate','saveStaffAssignments','saveRefereeStationAssignments'].map(method).join(',\n')+'}',context);
 return {api:context.api,docs,reads,stale,logs,afterCommit:fn=>afterCommit=fn};
}

test('staff save retries a temporarily stale readback after the transaction commits',async()=>{
 const h=harness();h.stale.set('tournaments/ROOM',[clone(h.docs.get('tournaments/ROOM'))]);
 const result=await h.api.saveStaffAssignments('ROOM',['ref']);
 assert.equal(result.ok,true);assert.equal(result.verified,true);assert(h.reads.length>=2);assert.deepEqual(JSON.parse(h.docs.get('tournaments/ROOM').data).meta.assignedStaffUids,['ref']);
});

test('referee save retries a public mirror readback without undoing the committed private config',async()=>{
 const h=harness();h.stale.set('publicTournaments/ROOM',[clone(h.docs.get('publicTournaments/ROOM'))]);
 const data=room();data.meta.refereeStationAssignments={'1':['ref']};data.meta.refereeStationRestrictionEnabled=true;
 const result=await h.api.saveRefereeStationAssignments('ROOM',data);
 assert.equal(result.ok,true);assert.equal(result.verified,true);assert(h.reads.filter(x=>x==='publicTournaments/ROOM').length>=2);
});

test('stale whole-state sync cannot overwrite a just-committed staff assignment',async()=>{
 const h=harness(),old=room();h.afterCommit(async()=>assert.equal(await h.api.pushUpdate('ROOM',old),true,JSON.stringify(h.logs)));
 const result=await h.api.saveStaffAssignments('ROOM',['ref']);
 assert.equal(result.ok,true);assert.deepEqual(h.docs.get('tournaments/ROOM').assignedStaffUids,['ref']);assert.deepEqual(JSON.parse(h.docs.get('tournaments/ROOM').data).meta.assignedStaffUids,['ref']);
});

test('ordinary sync cannot resurrect removed staff from a stale device',async()=>{
 const h=harness(),old=room();old.meta.assignedStaffUids=['ref'];
 assert.equal((await h.api.saveStaffAssignments('ROOM',[])).ok,true);
 assert.equal(await h.api.pushUpdate('ROOM',old),true);assert.deepEqual(h.docs.get('tournaments/ROOM').assignedStaffUids,[]);
});

test('reducing courts replaces assignment maps instead of retaining obsolete map entries',async()=>{
 const h=harness();const doc=h.docs.get('tournaments/ROOM');doc.refereeStationAssignments={'1':['ref'],'12':['ref']};doc.refereeStationNames={'1':['Referee'],'12':['Referee']};
 const data=room();data.meta.refereeStationAssignments={'1':['ref']};
 const result=await h.api.saveRefereeStationAssignments('ROOM',data);assert.equal(result.ok,true);assert.deepEqual(Object.keys(h.docs.get('tournaments/ROOM').refereeStationAssignments),['1']);
});

test('referee assignment save advances the active court lifecycle while removing old Courts',async()=>{
 const h=harness(),doc=h.docs.get('tournaments/ROOM'),active=JSON.parse(doc.data);
 active.courtLifecycleEpoch=1;doc.data=JSON.stringify(active);doc.courtLifecycleEpoch=1;doc.courtLifecycleWriteSeq=7;
 doc.refereeStationAssignments={'1':['ref'],'12':['ref']};
 const data=room();data.meta.refereeStationAssignments={'1':['ref']};
 const result=await h.api.saveRefereeStationAssignments('ROOM',data);
 assert.equal(result.ok,true);assert.equal(h.docs.get('tournaments/ROOM').courtLifecycleWriteSeq,8);
 assert.deepEqual(Object.keys(h.docs.get('tournaments/ROOM').refereeStationAssignments),['1']);
});

test('persistent mismatch stays unverified but reports the transaction committed',async()=>{
 const h=harness(),old=clone(h.docs.get('tournaments/ROOM'));h.stale.set('tournaments/ROOM',[old,old,old,old]);
 const result=await h.api.saveStaffAssignments('ROOM',['ref']);assert.equal(result.ok,false);assert.equal(result.reason,'verify-mismatch');assert.equal(result.committed,true);assert(h.reads.length<=3);assert.deepEqual(h.docs.get('tournaments/ROOM').assignedStaffUids,['ref']);
});

test('referee permission rejection does not claim a successful commit',async()=>{
 const h=harness();h.docs.set('users/admin',{active:true,role:'player'});const result=await h.api.saveRefereeStationAssignments('ROOM',room());assert.equal(result.ok,false);assert.equal(result.reason,'permission-denied');assert.notEqual(result.committed,true);
});

test('invalid readback JSON after commit is distinguished from transaction failure',async()=>{
 const h=harness();h.afterCommit(()=>{h.docs.get('tournaments/ROOM').data='INVALID_JSON';});
 const result=await h.api.saveStaffAssignments('ROOM',['ref']);assert.equal(result.ok,false);assert.equal(result.committed,true);assert.deepEqual(h.docs.get('tournaments/ROOM').assignedStaffUids,['ref']);
});

test('network failure during confirmation keeps committed=true and remains unverified',async()=>{
 const h=harness();h.afterCommit(()=>{h.stale.get=()=>{throw Object.assign(new Error('network'),{code:'unavailable'});};});
 const result=await h.api.saveStaffAssignments('ROOM',['ref']);assert.equal(result.ok,false);assert.equal(result.committed,true);assert.equal(result.reason,'unavailable');assert.deepEqual(h.docs.get('tournaments/ROOM').assignedStaffUids,['ref']);
});

const core=fs.readFileSync('modules/main-app/core.js','utf8');
for(const kind of ['staff','referee'])for(const committed of [true,false]){
 test(kind+' UI '+(committed?'keeps submitted settings while confirmation is pending':'restores settings when the transaction is rejected'),async()=>{
  const start=core.indexOf('  if(action==="save-'+(kind==='staff'?'staff-assignment':'referee-station-assignment')+'")');
  const a=core.indexOf('(async()=>{',start),b=core.indexOf('})();',a);assert(a>start&&b>a);
  let finish;const done=new Promise(resolve=>finish=resolve);const messages=[];
  const previous=kind==='staff'?['old']:{assignments:{'1':['old']},names:{'1':['Old']},assignedStaffUids:['old'],restrictionEnabled:false};
  const state=room();state.cloudCode='ROOM';Object.assign(state.meta,{assignedStaffUids:['ref'],refereeStationAssignments:{'1':['ref']},refereeStationNames:{'1':['Referee']},refereeStationRestrictionEnabled:true});
  const result={ok:false,committed,reason:committed?'verify-mismatch':'permission-denied'};
  const context={state,previous,requested:['ref'],refereeAssignmentDraftEnabled:true,cloudStatus:'connected',staffAssignmentSaving:true,refereeAssignmentSaving:true,cloudAccessLimited:false,cloudAccessMessage:'',flushCloudStateWrites:async()=>true,window:{cloudSync:{saveStaffAssignments:async()=>result,saveRefereeStationAssignments:async()=>result}},showToast:message=>messages.push(message),render:()=>finish(),console:{warn:()=>{}}};
  vm.createContext(context);vm.runInContext(core.slice(a,b+5),context);await done;
  assert.deepEqual(Array.from(context.state.meta.assignedStaffUids),committed?['ref']:['old']);
  if(kind==='referee')assert.equal(context.state.meta.refereeStationRestrictionEnabled,committed);
  if(committed){assert(messages[0].includes('已送出'));assert(!messages[0].includes('未儲存'));assert(!messages[0].includes('還原'));assert.equal(context.cloudStatus,'connected');}
  else assert(messages[0].includes('權限不足'));
 });
}

for(const kind of ['staff','referee']){
 test(kind+' local-cache failure after verified cloud commit cannot mark LINK ERROR or revert assignment',async()=>{
  const start=core.indexOf('  if(action==="save-'+(kind==='staff'?'staff-assignment':'referee-station-assignment')+'")');const a=core.indexOf('(async()=>{',start),b=core.indexOf('})();',a);
  let finish;const done=new Promise(resolve=>finish=resolve),messages=[];const saved=room();saved.meta.assignedStaffUids=['ref'];saved.cloudCode='ROOM';saved.meta.refereeStationAssignments={'1':['ref']};saved.meta.refereeStationRestrictionEnabled=true;
  const previous=kind==='staff'?['old']:{assignments:{},names:{},assignedStaffUids:['old'],restrictionEnabled:false};
  const context={state:clone(saved),previous,requested:['ref'],refereeAssignmentDraftEnabled:true,cloudStatus:'connected',flushCloudStateWrites:async()=>true,window:{cloudSync:{saveStaffAssignments:async()=>({ok:true,committed:true,state:clone(saved)}),saveRefereeStationAssignments:async()=>({ok:true,committed:true,state:clone(saved)})}},defaultState:()=>({}),saveRecord:async()=>{throw new Error('IndexedDB local cache unavailable');},showToast:msg=>messages.push(msg),render:()=>finish(),console:{warn:()=>{}}};
  vm.createContext(context);vm.runInContext(core.slice(a,b+5),context);await done;assert.equal(context.cloudStatus,'connected');assert.deepEqual(Array.from(context.state.meta.assignedStaffUids),['ref']);assert(messages[0].includes('本機暫存'));assert(!messages[0].includes('未儲存'));assert(!messages[0].includes('還原'));
 });
}

for(const reason of ['already-completed','corrupt-data','unavailable','deadline-exceeded']){
 test('referee LINK ERROR is limited to transport failures: '+reason,async()=>{
  const start=core.indexOf('  if(action==="save-referee-station-assignment")'),a=core.indexOf('(async()=>{',start),b=core.indexOf('})();',a);
  let finish;const done=new Promise(resolve=>finish=resolve);const context={state:room(),previous:{assignments:{},names:{},assignedStaffUids:[],restrictionEnabled:false},refereeAssignmentDraftEnabled:true,cloudStatus:'connected',flushCloudStateWrites:async()=>true,window:{cloudSync:{saveRefereeStationAssignments:async()=>({ok:false,reason})}},showToast:()=>{},render:()=>finish(),console:{warn:()=>{}}};context.state.cloudCode='ROOM';vm.createContext(context);vm.runInContext(core.slice(a,b+5),context);await done;assert.equal(context.cloudStatus,['unavailable','deadline-exceeded'].includes(reason)?'error':'connected');
 });
}

function bindReferee(h){
 const doc=h.docs.get('tournaments/ROOM'),st=JSON.parse(doc.data);
 Object.assign(st.meta,{assignedStaffUids:['ref'],refereeStationAssignments:{'1':['ref']},refereeStationNames:{'1':['Referee']},refereeStationRestrictionEnabled:true});
 Object.assign(doc,{data:JSON.stringify(st),assignedStaffUids:['ref'],refereeStationAssignments:{'1':['ref']},refereeStationNames:{'1':['Referee']},refereeStationUids:['ref']});
 return st;
}
test('unchecking bound staff removes Court permissions and public labels atomically, even after stale sync',async()=>{
 const h=harness(),old=bindReferee(h);
 assert.equal((await h.api.saveStaffAssignments('ROOM',[])).ok,true);
 const doc=h.docs.get('tournaments/ROOM');
 assert.deepEqual(doc.assignedStaffUids,[]);assert.deepEqual(doc.refereeStationUids,[]);
 assert.deepEqual(doc.refereeStationAssignments,{'1':[]});assert.deepEqual(doc.refereeStationNames,{'1':[]});
 assert.deepEqual(JSON.parse(h.docs.get('publicTournaments/ROOM').bracketView).meta.refereeStationNames,{'1':[]});
 assert.equal(await h.api.pushUpdate('ROOM',old),true);
 assert.deepEqual(h.docs.get('tournaments/ROOM').refereeStationAssignments,{'1':[]});
});
test('staff save refreshes retained Court names from real profiles in private and public views',async()=>{
 const h=harness();bindReferee(h);
 assert.equal((await h.api.saveStaffAssignments('ROOM',['ref'])).ok,true);
 assert.deepEqual(h.docs.get('tournaments/ROOM').refereeStationNames,{'1':['王裁判']});
 assert.deepEqual(JSON.parse(h.docs.get('publicTournaments/ROOM').bracketView).meta.refereeStationNames,{'1':['王裁判']});
});
for(const realName of ['陳裁判','',null,42])test('Court save resolves real name or ID with missing-name annotation: '+realName,async()=>{
 const h=harness();h.docs.set('users/ref',{active:true,role:'staff',realName,gameId:'REF-ID',displayName:'Nickname'});
 const st=room();st.meta.refereeStationAssignments={'1':['ref']};
 const result=await h.api.saveRefereeStationAssignments('ROOM',st);assert.equal(result.ok,true);
 const expected=realName==='陳裁判'?'陳裁判':'REF-ID（缺少本名）';
 assert.deepEqual(h.docs.get('tournaments/ROOM').refereeStationNames,{'1':[expected]});
 assert.deepEqual(JSON.parse(h.docs.get('publicTournaments/ROOM').bracketView).meta.refereeStationNames,{'1':[expected]});
});
test('staff UI submits exactly the checked list without restoring bound referees',()=>{
 const a=core.indexOf('  if(action==="save-staff-assignment")'),b=core.indexOf('    (async()=>{',a);
 let requested;
 const context={action:'save-staff-assignment',staffAssignmentSaving:false,state:{cloudCode:'ROOM',meta:{assignedStaffUids:['ref','keep']}},window:{cloudSync:{saveStaffAssignments(){}}},document:{querySelectorAll:()=>[{checked:false,getAttribute:()=> 'ref'},{checked:true,getAttribute:()=> 'keep'}]},flattenedRefereeStationUids:()=>['ref'],render:()=>{},showToast:()=>{}};
 vm.createContext(context);vm.runInContext('(function(){'+core.slice(a,b)+'globalThis.submitted=requested;}})()',context);
 assert.deepEqual(Array.from(context.submitted),['keep']);
});

test('admin directory sync includes real name and game ID for creator-operated Court saves',async()=>{
 const writes=[];
 const context={authReady:true,fx:{doc:(_db,...parts)=>parts.join('/'),writeBatch:()=>({set:(ref,data)=>writes.push({ref,data}),commit:async()=>{}})},dbHandle:{},console};
 vm.createContext(context);vm.runInContext('api={'+method('syncStaffDirectory')+'}',context);
 assert.equal(await context.api.syncStaffDirectory([{uid:'ref',role:'staff',active:true,realName:' 王裁判 ',gameId:'REF-ID',displayName:'Nickname'}]),true);
 assert.equal(writes[0].data.realName,'王裁判');assert.equal(writes[0].data.gameId,'REF-ID');
});
test('legacy self-directory writes preserve admin-enriched names without a rule-rejected write',async()=>{
 let writes=0;
 const context={authReady:true,authHandle:{currentUser:{uid:'ref'}},USERS_COLLECTION:'users',dbHandle:{},fx:{doc:(_db,...parts)=>parts.join('/'),getDoc:async key=>({exists:()=>true,data:()=>key==='users/ref'?{role:'staff',active:true,realName:'王裁判'}:{realName:'王裁判',gameId:'REF-ID'}}),setDoc:async()=>writes++},console};
 vm.createContext(context);vm.runInContext('api={'+method('ensureMyStaffDirectory')+'}',context);
 assert.equal((await context.api.ensureMyStaffDirectory()).ok,true);assert.equal(writes,0);
});
