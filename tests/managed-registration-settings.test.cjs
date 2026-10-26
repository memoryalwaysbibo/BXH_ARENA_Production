'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),core=fs.readFileSync(path.join(root,'modules/main-app/core.js'),'utf8');
const cloudFixture=fs.readFileSync(path.join(__dirname,'community-quick-registration-cloud.test.cjs'),'utf8');
const quietRequire=name=>name==='node:test'?()=>{}:require(name);
const fixture=new Function('require','__dirname',cloudFixture.slice(0,cloudFixture.indexOf('for (const capacity of [null'))+';return {harness,state};')(quietRequire,__dirname);
const clone=x=>JSON.parse(JSON.stringify(x));
function fn(name){const m=new RegExp('^(?:async )?function '+name+'\\(','m').exec(core);assert(m,name);return core.slice(m.index,core.indexOf('\n}',m.index)+2);}
async function finalized(){
 const h=fixture.harness();await h.api.createCommunityRoom(fixture.state());
 const state=JSON.parse(h.docs.get('tournaments/LOCAL').data);
 Object.assign(state,{onsiteWaitlistServerOwned:true,onsiteWaitlistFinalized:true,onsiteWaitlistRuntimeRevision:7});
 Object.assign(state.meta,{registrationCapacity:32,registrationStatus:'closed',registrationAutoFillEnabled:false,waitlistEnabled:false});
 for(const [key,field]of [['tournaments/LOCAL','data'],['publicTournaments/LOCAL','bracketView']])Object.assign(h.docs.get(key),{onsiteWaitlistServerOwned:true,onsiteWaitlistFinalized:true,onsiteWaitlistRuntimeRevision:7,capacity:32,[field]:JSON.stringify(state)});
 h.writes.length=0;return {h,state};
}
test('explicit changed capacity is rejected rather than silently saved as the old value',async()=>{
 const {h,state}=await finalized();state.meta.registrationCapacity=64;
 assert.equal(await h.api.pushUpdate('LOCAL',state,{registrationSettings:true}),false);
 assert.equal(h.ctx.window.__BXH_LAST_CLOUD_ERROR_CODE,'onsite-registration-settings-managed');assert.equal(h.writes.length,0);assert.equal(h.docs.get('tournaments/LOCAL').capacity,32);
});
test('each protected time, enabled flag, waitlist limit and auto-fill edit is rejected atomically',async()=>{
 for(const patch of [{registrationEnabled:false},{registrationOpenAt:1800000000000},{registrationCloseAt:1800000001000},{waitlistCapacity:8},{cancellationDeadline:1800000002000},{registrationAutoFillEnabled:true}]){
  const {h,state}=await finalized();Object.assign(state.meta,patch);assert.equal(await h.api.pushUpdate('LOCAL',state,{registrationSettings:true}),false,JSON.stringify(patch));assert.equal(h.writes.length,0);assert.equal(h.ctx.window.__BXH_LAST_CLOUD_ERROR_CODE,'onsite-registration-settings-managed');
 }
});
test('name/fee/description changes still save when protected settings are unchanged',async()=>{
 const {h,state}=await finalized();Object.assign(state.meta,{name:'Updated name',registrationFee:200,eventDescription:'Updated description'});
 assert.equal(await h.api.pushUpdate('LOCAL',state,{registrationSettings:true}),true);
 const saved=JSON.parse(h.docs.get('tournaments/LOCAL').data);assert.equal(saved.meta.name,'Updated name');assert.equal(saved.meta.registrationFee,200);assert.equal(saved.meta.registrationCapacity,32);assert.equal(saved.onsiteWaitlistRuntimeRevision,8);
});
test('ordinary non-settings saves retain canonical rebasing compatibility',async()=>{
 const {h,state}=await finalized();state.meta.registrationCapacity=64;assert.equal(await h.api.pushUpdate('LOCAL',state),true);assert.equal(h.docs.get('tournaments/LOCAL').capacity,32);
});
test('unmanaged rooms still accept explicit capacity changes',async()=>{
 const h=fixture.harness(),state=fixture.state();await h.api.createCommunityRoom(state);state.meta.registrationCapacity=64;assert.equal(await h.api.pushUpdate('LOCAL',state,{registrationSettings:true}),true);assert.equal(h.docs.get('tournaments/LOCAL').capacity,64);
});
test('zero and null waitlist/time representations do not falsely reject metadata edits',async()=>{
 const {h,state}=await finalized();state.meta.waitlistCapacity=0;state.meta.registrationCloseAt=null;assert.equal(await h.api.pushUpdate('LOCAL',state,{registrationSettings:true}),true);
});
function savingContext(extra={}){
 const calls={cached:[],writes:[],toasts:[],reset:0};
 const ctx=vm.createContext({window:{},state:{id:'room',cloudCode:'BXH-ROOM',meta:{registrationEnabled:false}},currentRole:'admin',communitySettingsWriteGate:null,
  touchCommunityActivity(){},cloneStateForSave:clone,cloudAvailable:()=>true,saveRecord:async s=>{calls.cached.push(clone(s));return true;},
  enqueueCloudStateWrite:async(code,s,options)=>{calls.writes.push({code,options});return true;},cloudStatus:'connected',cloudAccessLimited:false,cloudAccessMessage:'',
  showToast:(message,error)=>calls.toasts.push({message,error}),render(){},resetRegistrationFormDraft(){calls.reset++;},resetSettingsFormDraft(){},registrationSettingsSaveEpoch:0,...extra});
 vm.runInContext(fn('saveState'),ctx);return {ctx,calls};
}
test('explicit save sends intent and caches only after cloud acceptance',async()=>{
 const {ctx,calls}=savingContext(),options={registrationSettings:true};assert.equal(await ctx.saveState(options),true);assert.equal(calls.writes[0].options.registrationSettings,true);assert.equal(options.cloudSaved,true);assert.equal(calls.cached.length,1);
});
test('policy rejection never caches a failed draft or queues an unmarked retry',async()=>{
 const {ctx,calls}=savingContext();ctx.enqueueCloudStateWrite=async()=>{ctx.window.__BXH_LAST_CLOUD_ERROR_CODE='onsite-registration-settings-managed';return false;};ctx.queueCloudSyncRetry=()=>{throw Error('must not queue');};
 assert.equal(await ctx.saveState({registrationSettings:true}),false);assert.equal(calls.cached.length,0);assert.equal(ctx.cloudStatus,'connected');assert.equal(ctx.cloudAccessLimited,false);
});
test('offline explicit edits do not become cached authoritative settings',async()=>{
 const {ctx,calls}=savingContext({cloudAvailable:()=>false});assert.equal(await ctx.saveState({registrationSettings:true}),false);assert.equal(calls.cached.length,0);assert.equal(calls.writes.length,0);assert.equal(ctx.window.__BXH_LAST_CLOUD_ERROR_CODE,'unavailable');
});
test('community detached saves also propagate explicit settings intent',async()=>{
 const {ctx,calls}=savingContext(),o={settingsToken:{isCurrent:()=>true}};assert.equal(await ctx.saveState(o),true);assert.equal(calls.writes[0].options.registrationSettings,true);assert.equal(o.cloudSaved,true);
});
test('failed save restores prior metadata, keeps drafts, and cannot report success',async()=>{
 const {ctx,calls}=savingContext();ctx.saveState=async()=>{ctx.window.__BXH_LAST_CLOUD_ERROR_CODE='onsite-registration-settings-managed';return false;};vm.runInContext(fn('reportManagedRegistrationSettings')+'\n'+fn('saveRegistrationSettingsAndReport'),ctx);
 const previous={name:'before'};ctx.state.meta={name:'edited'};assert.equal(await ctx.saveRegistrationSettingsAndReport(previous,'saved'),false);assert.equal(ctx.state.meta.name,'before');assert.equal(calls.reset,0);assert(calls.toasts.every(x=>x.message!=='saved'));assert(calls.toasts[0].message.includes('備取／抽籤'));
});
test('cloud-accepted local cache failure is not reported as a failed cloud save',async()=>{
 const {ctx,calls}=savingContext();ctx.saveState=async options=>{options.cloudSaved=true;return false;};vm.runInContext(fn('saveRegistrationSettingsAndReport'),ctx);assert.equal(await ctx.saveRegistrationSettingsAndReport({},'saved'),true);assert.equal(calls.reset,1);assert(calls.toasts[0].message.includes('已儲存到雲端'));
});
test('late save completion cannot roll back a different room',async()=>{
 const {ctx,calls}=savingContext();let finish;ctx.saveState=()=>new Promise(r=>finish=r);vm.runInContext(fn('saveRegistrationSettingsAndReport'),ctx);const pending=ctx.saveRegistrationSettingsAndReport({name:'old'},'saved');ctx.state={id:'other',meta:{name:'other'}};finish(false);assert.equal(await pending,false);assert.equal(ctx.state.meta.name,'other');assert.equal(calls.toasts.length,0);
});
test('preflight locks only changed protected settings and permits ordinary metadata',()=>{
 const ctx=vm.createContext({state:{onsiteWaitlistServerOwned:true,meta:{registrationEnabled:true,registrationCapacity:32,waitlistCapacity:0}}});vm.runInContext(fn('onsiteRegistrationSettingsLocked')+'\n'+fn('managedRegistrationSettingsChanged'),ctx);
 assert.equal(ctx.managedRegistrationSettingsChanged({registrationCapacity:64}),true);assert.equal(ctx.managedRegistrationSettingsChanged({name:'Updated'}),false);assert.equal(ctx.managedRegistrationSettingsChanged({registrationCapacity:32,waitlistCapacity:null}),false);ctx.state.onsiteWaitlistServerOwned=false;assert.equal(ctx.managedRegistrationSettingsChanged({registrationCapacity:64}),false);
});
test('same-room realtime replacement still reports an accepted save',async()=>{
 const {ctx,calls}=savingContext();let finish;ctx.saveState=()=>new Promise(r=>finish=r);vm.runInContext(fn('saveRegistrationSettingsAndReport'),ctx);
 const pending=ctx.saveRegistrationSettingsAndReport({},'saved');ctx.state=clone(ctx.state);finish(true);assert.equal(await pending,true);assert.equal(calls.reset,1);assert.equal(calls.toasts[0].message,'saved');
});
test('failed completion preserves a newer same-room snapshot',async()=>{
 const {ctx,calls}=savingContext();let finish;ctx.saveState=()=>new Promise(r=>finish=r);vm.runInContext(fn('saveRegistrationSettingsAndReport'),ctx);
 const pending=ctx.saveRegistrationSettingsAndReport({name:'old'},'saved');ctx.state=clone(ctx.state);ctx.state.meta.name='remote';finish(false);assert.equal(await pending,false);assert.equal(ctx.state.meta.name,'remote');assert.equal(calls.reset,0);
});
