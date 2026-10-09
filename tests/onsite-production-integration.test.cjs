'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),cloud=fs.readFileSync(path.join(root,'modules/cloud/cloud-runtime.js'),'utf8'),core=fs.readFileSync(path.join(root,'modules/main-app/core.js'),'utf8'),integration=fs.readFileSync(path.join(root,'modules/main-app/onsite-waitlist-integration.js'),'utf8');
function method(name){const start=cloud.indexOf('    async '+name+'(');assert(start>=0,name);const end=cloud.indexOf('\n    },',start);assert(end>start,name);return cloud.slice(start,end+7).trim().replace(/,$/,'');}
function fn(src,name){const m=new RegExp('^(?:  )?(?:async )?function '+name+'\\(','m').exec(src);assert(m,name);const end=src.indexOf('\n'+(src[m.index]===' '?'  ':'')+'}',m.index);return src.slice(m.index,end+(src[m.index]===' '?4:2));}
const clone=x=>JSON.parse(JSON.stringify(x));
function memoryStorage(){const m=new Map();return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k),m};}
test('actual transport verifies AppCheck for authenticated onsite callable',async()=>{
 const calls=[];const ctx=vm.createContext({window:{},firebaseUser:{uid:'manager'},engagementSessionEpoch:1,authReady:true,authHandle:{currentUser:{uid:'manager'}},functionsHandle:{},fnx:{httpsCallable:(_h,name)=>async payload=>{calls.push({name,payload});return {data:{ok:true}};}},tryInitFirebase:async()=>true,withTimeout:p=>p,ensureHunterClashAppCheck:async()=>{calls.push('AppCheck');},ENGAGEMENT_CALL_TIMEOUT_MS:30000});vm.runInContext(fn(cloud,'callEngagementFunction'),ctx);
 for(const name of ['manageOnsiteWaitlist']){await ctx.callEngagementFunction(name,{code:'BXH-DEMO2026',action:'preview'});assert.equal(calls.at(-2),'AppCheck');assert.equal(calls.at(-1).name,name);assert.equal(calls.at(-1).payload.actorId,undefined);}
 ctx.ensureHunterClashAppCheck=async()=>{throw Error('blocked');};await assert.rejects(ctx.callEngagementFunction('manageOnsiteWaitlist',{}));assert.equal(calls.filter(x=>typeof x==='object').length,1);
});
test('child checkin sends exact player id and never guardian identity; pending survives interruption',async()=>{
 const storage=memoryStorage();const ctx=vm.createContext({window:{localStorage:storage,crypto:{randomUUID:()=> 'same-operation'}},document:{}});vm.runInContext(integration,ctx);let lost=true;const sent=[];const cfg={code:'BXH-ABCD',actorId:'staff',isCurrent:()=>true,api:async body=>{sent.push(clone(body));if(body.action==='preview')return {state:{revision:7}};if(lost)throw Error('network');return {ok:true};}};
 await assert.rejects(ctx.window.BXHOnsiteWaitlistIntegration.command(cfg,'checkIn',{playerId:'family_child-2',checkedIn:true}));lost=false;await ctx.window.BXHOnsiteWaitlistIntegration.command(cfg,'checkIn',{},true);assert.equal(sent[1].playerId,'family_child-2');assert.equal(sent[1].actorId,undefined);assert.deepEqual(sent[2],sent[1]);assert.equal(storage.m.size,0);
});
test('room/auth switch during checkin preview cannot submit a mutation',async()=>{
 const storage=memoryStorage();const ctx=vm.createContext({window:{localStorage:storage,crypto:{randomUUID:()=> 'same-operation'}},document:{}});vm.runInContext(integration,ctx);let current=true,calls=0;await assert.rejects(ctx.window.BXHOnsiteWaitlistIntegration.command({code:'BXH-ABCD',actorId:'staff',isCurrent:()=>current,api:async()=>{calls++;current=false;return {state:{revision:1}};}},'checkIn',{playerId:'child',checkedIn:true}),/room-context-changed/);assert.equal(calls,1);assert.equal(storage.m.size,0);
});
test('actual managed checkin and legacy controls are guarded before optimistic mutation',()=>{
 assert.match(core,/if\(p && peopleOnsiteWaitlistManaged\(\)\)\{peopleSetOnsiteCheckIn\(p,!!target.checked\);return;\}/);
 assert.match(core,/if\(peopleOnsiteWaitlistManaged\(\)\)\{\s+if\(!p.checkedIn\)\{peopleSetOnsiteCheckIn\(p,true\)/);
 assert.match(core,/if\(peopleOnsiteWaitlistManaged\(\)\) return refreshBackendRegistrationRoster\(context\)/);
 assert.match(core,/完成抽選，再進行賽事編排/);
 assert.match(core,/Number\(remote.data.onsiteWaitlistDrawRevision\|\|0\)<Number\(result.committedRevision\|\|0\)/);
});

const harnessSource=fs.readFileSync(path.join(__dirname,'community-quick-registration-cloud.test.cjs'),'utf8');
const fixture=new Function('require','__dirname',harnessSource.slice(0,harnessSource.indexOf('for (const capacity of [null'))+';return {harness,state};')(require,__dirname);
async function finalizedHarness(){
 const h=fixture.harness();const state=fixture.state();await h.api.createCommunityRoom(state);
 for(const key of ['tournaments/LOCAL','publicTournaments/LOCAL'])Object.assign(h.docs.get(key),{onsiteWaitlistServerOwned:true,onsiteWaitlistFinalized:true,onsiteWaitlistRuntimeRevision:7});
 const saved=JSON.parse(h.docs.get('tournaments/LOCAL').data);Object.assign(saved,{onsiteWaitlistServerOwned:true,onsiteWaitlistFinalized:true,onsiteWaitlistRuntimeRevision:7});saved.meta.registrationStatus='closed';h.docs.get('tournaments/LOCAL').data=JSON.stringify(saved);h.writes.length=0;return {h,state:saved};
}
test('finalized normal push increments private/public/state fence together',async()=>{
 const {h,state}=await finalizedHarness();state.meta.name='Normal manager edit';assert.equal(await h.api.pushUpdate('LOCAL',state),true);
 assert.equal(h.docs.get('tournaments/LOCAL').onsiteWaitlistRuntimeRevision,8);assert.equal(h.docs.get('publicTournaments/LOCAL').onsiteWaitlistRuntimeRevision,8);
 assert.equal(JSON.parse(h.docs.get('tournaments/LOCAL').data).onsiteWaitlistRuntimeRevision,8);assert.equal(JSON.parse(h.docs.get('publicTournaments/LOCAL').bracketView).onsiteWaitlistRuntimeRevision,8);assert.equal(state.onsiteWaitlistRuntimeRevision,8);
});
test('stale and markerless original snapshots cannot inherit current fence',async()=>{
 for(const stale of [6,undefined]){const {h,state}=await finalizedHarness();state.onsiteWaitlistRuntimeRevision=stale;assert.equal(await h.api.pushUpdate('LOCAL',state),false);assert.equal(h.writes.length,0);assert.equal(h.ctx.window.__BXH_LAST_CLOUD_ERROR_CODE,'onsite-runtime-stale');}
});
test('active draw whole-state writes fail closed before finalize',async()=>{
 const {h,state}=await finalizedHarness();h.docs.get('tournaments/LOCAL').onsiteWaitlistFinalized=false;state.onsiteWaitlistFinalized=false;assert.equal(await h.api.pushUpdate('LOCAL',state),false);assert.equal(h.writes.length,0);assert.equal(h.ctx.window.__BXH_LAST_CLOUD_ERROR_CODE,'onsite-waitlist-managed');
});
test('Firestore transaction retry keeps the caller original fence',async()=>{
 const {h,state}=await finalizedHarness();const first=h.ctx.fx.runTransaction;let attempted=false;
 h.ctx.fx.runTransaction=async(db,fn)=>{
   const original=clone(h.docs.get('tournaments/LOCAL'));
   await fn({get:async key=>({exists:()=>h.docs.has(key),data:()=>clone(h.docs.get(key))}),set:()=>{attempted=true;},update:()=>{}});
   h.docs.set('tournaments/LOCAL',{...original,onsiteWaitlistRuntimeRevision:8,data:JSON.stringify({...JSON.parse(original.data),onsiteWaitlistRuntimeRevision:8})});
   return first(db,fn);
 };
 assert.equal(await h.api.pushUpdate('LOCAL',state),false);assert.equal(attempted,true);assert.equal(h.writes.length,0);assert.equal(h.ctx.window.__BXH_LAST_CLOUD_ERROR_CODE,'onsite-runtime-stale');
});
test('ship candidate has no new runtime callable or scoring policy',()=>{assert.doesNotMatch(cloud,/manageOnsiteTournamentRuntime|mutateOnsiteRuntime/);assert.doesNotMatch(core,/不支援撤回已確認結果/);});

test('late checkin completion cannot clear a newer room operation busy state',async()=>{
 let resolve;const pending=new Promise(r=>{resolve=r;});const ctx=vm.createContext({state:{id:'a',cloudCode:'BXH-AAAA'},firebaseUser:{uid:'one'},peopleRosterBusy:false,onsiteCheckinContext:null,canManageOnsiteWaitlist:()=>true,render(){},showToast(){},window:{BXHOnsiteWaitlistIntegration:{command:()=>pending,pendingCommand:()=>null},cloudSync:{}}});
 vm.runInContext(fn(core,'peopleSetOnsiteCheckIn'),ctx);const task=ctx.peopleSetOnsiteCheckIn({id:'child'},true);
 ctx.state={id:'b',cloudCode:'BXH-BBBB'};ctx.firebaseUser={uid:'two'};const newer={code:'BXH-BBBB'};ctx.onsiteCheckinContext=newer;ctx.peopleRosterBusy=true;resolve({ok:true});await task;
 assert.equal(ctx.peopleRosterBusy,true);assert.equal(ctx.onsiteCheckinContext,newer);
});

test('activation matches the callable manager scope without broader editor grants',()=>{
 const cases=[
  [{active:true,role:'admin'}, {meta:{eventAuthority:'official'}},true],
  [{active:true,role:'super_admin'}, {meta:{eventAuthority:'official'}},true],
  [{active:true,role:'staff'}, {meta:{eventAuthority:'official',assignedStaffUids:['u']}},true],
  [{active:true,role:'staff'}, {meta:{eventAuthority:'official'}},false],
  [{active:true,role:'partner_organizer'}, {createdBy:'u',meta:{eventAuthority:'official'}},true],
  [{active:true,role:'player',partnerOrganizer:{status:'active'}}, {createdBy:'u',meta:{eventAuthority:'official'}},false],
  [{active:true,role:'player'}, {eventStaffAssignments:{u:{status:'accepted',duties:['referee']}},meta:{eventAuthority:'official'}},false],
  [{active:true,role:'player'}, {ownerUid:'u',meta:{eventAuthority:'community'}},true],
  [{active:false,role:'admin'}, {meta:{}},false],
  [{active:true,role:'admin',deleted:true}, {meta:{}},false],
  [{active:true,role:'admin',isTestAccount:true}, {meta:{}},false],
  [{active:true,role:'admin',accountStatus:'frozen'}, {meta:{}},false]
 ];
 for(const [userProfile,state,expected] of cases){const ctx=vm.createContext({userProfile,state,firebaseUser:{uid:'u'}});vm.runInContext(fn(core,'canManageOnsiteWaitlist'),ctx);assert.equal(ctx.canManageOnsiteWaitlist(),expected,JSON.stringify({userProfile,state}));}
});
test('new activation is individual and pre-bracket; finalized historical records remain readable',()=>{
 const ctx=vm.createContext({state:{cloudCode:'BXH-ROOM',meta:{battleMode:'individual'}},canManageOnsiteWaitlist:()=>true,peopleRegistrationSelectionManaged:()=>false});vm.runInContext(fn(core,'peopleOnsiteWaitlistAvailable'),ctx);assert.equal(ctx.peopleOnsiteWaitlistAvailable(),true);ctx.state.meta.battleMode='team';assert.equal(ctx.peopleOnsiteWaitlistAvailable(),false);ctx.state.meta.battleMode='individual';ctx.state.bracketSize=32;assert.equal(ctx.peopleOnsiteWaitlistAvailable(),false);ctx.state.bracketSize=0;ctx.state.startedAt=1;assert.equal(ctx.peopleOnsiteWaitlistAvailable(),false);ctx.state.onsiteWaitlistFinalized=true;assert.equal(ctx.peopleOnsiteWaitlistAvailable(),true);
});
