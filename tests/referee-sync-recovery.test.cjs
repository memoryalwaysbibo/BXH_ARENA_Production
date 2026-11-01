'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const api=require('../modules/main-app/referee-sync-recovery.js');
const copy=x=>JSON.parse(JSON.stringify(x));
function harness(){
 const snapshot={id:'room',cloudCode:'BXH-RECOV1',startedAt:1,meta:{battleMode:'individual'},players:[],matches:[{id:'m1',scoreA:4},{id:'m2',scoreA:2}]};
 const remote=copy(snapshot);remote.matches[0].scoreA=3;remote.matches[1].scoreA=5;
 const map=new Map(),calls={read:0,cache:0,reload:0};let current=true;
 const options={snapshot,uid:'referee1',code:snapshot.cloudCode,now:()=>1000,storage:{set:async(k,v)=>{map.set(k,v);return {key:k,value:v};},get:async k=>map.has(k)?{key:k,value:map.get(k)}:null},isCurrent:()=>current,
  readRemote:async()=>{calls.read++;return {ok:true,data:copy(remote)};},cacheRemote:async data=>{calls.cache++;calls.cached=copy(data);return true;},reload:()=>calls.reload++};
 return {options,map,calls,remote,setCurrent:v=>current=v};
}
test('verified local snapshot and fresh canonical cache precede reload; other court is never merged from old data',async()=>{
 const h=harness(),before=JSON.stringify(h.options.snapshot);assert.equal((await api.backupAndReload(h.options)).ok,true);
 assert.deepEqual(h.calls.cached,h.remote);assert.equal(h.calls.reload,1);assert.equal(JSON.stringify(h.options.snapshot),before);
 const saved=await api.latest(h.options);assert.deepEqual(saved.snapshot,h.options.snapshot);assert.equal(saved.snapshot.matches[0].scoreA,4);assert.equal(h.calls.cached.matches[0].scoreA,3);assert.equal(h.calls.cached.matches[1].scoreA,5);
});
for(const reason of ['quota','false','mismatch'])test('backup '+reason+' stops before remote read/cache/reload',async()=>{
 const h=harness();if(reason==='quota')h.options.storage.set=async()=>{throw Error('quota');};if(reason==='false')h.options.storage.set=async()=>false;if(reason==='mismatch')h.options.storage.get=async()=>({value:'wrong'});
 assert.equal((await api.backupAndReload(h.options)).ok,false);assert.deepEqual(h.calls,{read:0,cache:0,reload:0});
});
test('failed server read preserves backup without replacing current cache or reloading',async()=>{
 const h=harness();h.options.readRemote=async()=>({ok:false,reason:'private'});
 assert.equal((await api.backupAndReload(h.options)).reason,'remote-read-failed');assert.equal(h.calls.reload,0);assert.equal(h.calls.cache,0);assert((await api.latest(h.options)).snapshot);
});
for(const field of ['id','cloudCode'])test('wrong remote '+field+' cannot be cached',async()=>{
 const h=harness();h.remote[field]='different';assert.equal((await api.backupAndReload(h.options)).reason,'remote-context-mismatch');assert.equal(h.calls.cache,0);assert.equal(h.calls.reload,0);
});
test('room/account/local-state change during read cancels reload',async()=>{
 const h=harness();h.options.readRemote=async()=>{h.setCurrent(false);return {ok:true,data:h.remote};};
 assert.equal((await api.backupAndReload(h.options)).reason,'context-changed');assert.equal(h.calls.cache,0);assert.equal(h.calls.reload,0);
});
test('cache failure never reloads and never deletes the verified local backup',async()=>{
 const h=harness();h.options.cacheRemote=async()=>false;assert.equal((await api.backupAndReload(h.options)).reason,'remote-cache-failed');assert.equal(h.calls.reload,0);assert(await api.latest(h.options));
});
test('stalled storage times out instead of holding the recovery button forever',async()=>{
 const h=harness();h.options.timeoutMs=20;h.options.storage.set=()=>new Promise(()=>{});
 assert.equal((await api.backupAndReload(h.options)).reason,'recovery-timeout');assert.equal(api.isBusy(),false);assert.equal(h.calls.reload,0);
});
test('double click runs only one recovery',async()=>{
 const h=harness();let release;h.options.readRemote=()=>new Promise(r=>release=r);
 const first=api.backupAndReload(h.options);while(!release)await new Promise(r=>setImmediate(r));
 assert.equal((await api.backupAndReload(h.options)).reason,'busy');release({ok:true,data:h.remote});assert.equal((await first).ok,true);assert.equal(h.calls.reload,1);
});
test('backup export is account- and room-scoped, and rejects a tampered payload',async()=>{
 const h=harness();await api.backupAndReload(h.options);
 assert.equal(await api.latest({...h.options,uid:'other'}),null);assert.equal(await api.latest({...h.options,code:'BXH-OTHER1'}),null);
 const pointer=h.map.get('bxh-referee-sync-recovery:referee1:BXH-RECOV1:latest'),data=JSON.parse(h.map.get(pointer));data.uid='other';h.map.set(pointer,JSON.stringify(data));
 await assert.rejects(api.latest(h.options),/backup-context-mismatch/);
});
const core=fs.readFileSync('modules/main-app/core.js','utf8');
function extract(name){let a=core.indexOf('function '+name+'(');const b=core.indexOf('\n}',a);assert(a>=0&&b>a,name);if(core.slice(a-6,a)==='async ')a-=6;return core.slice(a,b+2);}
test('recovery integration uses server-only read, preserves cloud data, and resets failed promise only by reload',async()=>{
 const h=harness();let cached,serverOnly,cloudWrites=0,reloads=0;
 const c={state:copy(h.options.snapshot),window:{storage:h.options.storage,BXHRefereeSyncRecovery:api,cloudSync:{joinRoom:async(code,options)=>{serverOnly=options.serverOnly;return {ok:true,data:h.remote};},pushUpdate:async()=>cloudWrites++},location:{reload:()=>reloads++}},currentAuthUid:()=>h.options.uid,canOperateCurrentTournament:()=>true,saveRecord:async s=>{cached=copy(s);return true;},rememberRefereeWorkstation:()=>{},showToast:()=>{},render:()=>{},setTimeout,clearTimeout,cloudWriteChain:Promise.resolve(false)};
 vm.createContext(c);vm.runInContext(extract('canUseRefereeSyncRecovery')+'\n'+extract('performRefereeSyncRecovery'),c);
 await c.performRefereeSyncRecovery({uid:h.options.uid,id:c.state.id,code:c.state.cloudCode});
 assert.equal(serverOnly,true);assert.deepEqual(cached,h.remote);assert.equal(cloudWrites,0);assert.equal(reloads,1);assert.equal(await c.cloudWriteChain,false,'running context must not bypass old write barrier');
 const fresh={cloudWriteChain:Promise.resolve()};vm.createContext(fresh);vm.runInContext(extract('flushCloudStateWrites'),fresh);assert.equal(await fresh.flushCloudStateWrites(),true);
});
test('public/non-operating users have no recovery controls',()=>{
 const c={state:{id:'room',cloudCode:'BXH-RECOV1',startedAt:1,meta:{}},currentAuthUid:()=> 'player',canOperateCurrentTournament:()=>false};vm.createContext(c);vm.runInContext(extract('canUseRefereeSyncRecovery')+'\n'+extract('refereeSyncRecoveryControlsHtml'),c);assert.equal(c.refereeSyncRecoveryControlsHtml(),'');
});
