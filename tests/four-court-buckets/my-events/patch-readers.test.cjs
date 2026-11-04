'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),vm=require('node:vm');
const {patchReader}=require('../../../release/buckets/my-events/patch-readers.cjs');
const B=require('../../../release/buckets/completion/protocol/state.cjs');
const {readRoomLifecycle}=require('../../../release/buckets/my-events/lifecycle.cjs');
const base=__dirname;
const fileOf=kind=>path.join(base,kind==='list'?'deployed-auth-reader.cjs':'deployed-detail-reader.cjs');
const code='BXH-TEST01',uid='u1',time={seconds:10,nanoseconds:0};
function load(kind){
 const file=fileOf(kind);
 const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));
 m.require=id=>{
  if(id==='./admission.cjs')return {createLimiter:()=>({take:()=>()=>{}})};
  if(id==='./cursor.cjs')return {createCursorCodec:()=>({decode:()=>({after:null}),encode:()=>''})};
  if(id==='./detail-cursor.cjs')return {decode:()=>null,encode:()=>''};
  if(id==='./owners.js')return {collectOwners:()=>({status:'supported',ownerUids:[uid]})};
  if(id==='./lifecycle.js')return require('./deployed-lifecycle.cjs');
  return module.require(id);
 };
 const source=patchReader(kind,fs.readFileSync(file,'utf8'));
 new vm.Script(source,{filename:file});m._compile(source,file);return m.exports;
}
function bridge(){
 const values=new Map(),queries=[];
 const ref=p=>({path:p,id:p.split('/').at(-1),collection:x=>({doc:y=>ref(p+'/'+x+'/'+y)})});
 const snap=(p,value,exists=value!==undefined)=>({id:p.split('/').at(-1),ref:ref(p),exists,readTime:time,createTime:time,updateTime:time,data:()=>value});
 const query=p=>{
  const q={path:p,where(){return q;},orderBy(){return q;},limit(){return q;},startAfter(){return q;}};
  return q;
 };
 const db={doc:ref,collection:query,async run(_name,cb,opts){
  assert.equal(opts.readOnly,true);
  return {value:await cb({get:async target=>{
   if(target.path==='users/'+uid+'/myEventRooms')return {docs:[snap(target.path+'/'+code,values.get(target.path+'/'+code))],size:1,readTime:time};
   if(!target.id){queries.push(target.path);return {docs:[],size:0,readTime:time};}
   return snap(target.path,values.get(target.path));
  }})};
 }};
 // The fake query for user memberships has a path with no id; all other
 // queries are empty. References expose id, queries do not.
 values.set('users/'+uid,{active:true});
 values.set('myEventsMembershipControl/rollout',{schemaVersion:24,release:'individual-family-v24',scope:'individual-family',enabled:true,baselineComplete:true,bootstrap:{schemaVersion:26,runId:'run1',engineVersion:'membership-v26-generation-1'}});
 values.set('myEventBootstrapRunsV26/run1',{schemaVersion:26,runId:'run1',engineVersion:'membership-v26-generation-1',scope:'individual-family',state:'complete',phase:'complete',pending:false,roomDiscoveryDone:true,summaryDiscoveryDone:true,queuedRooms:1,completedRooms:1,failedRooms:0,rebuiltRooms:1,quarantinedRooms:0,disposition:'clean',completedAt:1,captureMode:'same-service-engine'});
 values.set('users/'+uid+'/myEventRooms/'+code,{code,ownerUid:uid,schemaVersion:24,release:'individual-family-v24',candidate:true,state:'ready',roomIncarnation:time,counts:{selfConfirmed:1,selfWaitlist:0,familyConfirmed:0,familyWaitlist:0,unsupported:0}});
 values.set('tournaments/'+code,{data:'{}',tournamentPhase:'live'});
 return {db,queries,values};
}
test('source pins and exact one-call substitution are stable',()=>{
 for(const kind of ['list','detail']){
  const file=fileOf(kind);
  const source=fs.readFileSync(file,'utf8'),patched=patchReader(kind,source);
  assert.equal(source.split('const life=normalizeRoom(room.data());').length,2);
  assert.equal(patched.split('await resolveRoomLifecycle({db:bridge,tx,room,code,normalizeRoom});').length,2);
  assert.throws(()=>patchReader(kind,source+' '),/reader-source-drift/);
  new vm.Script(patched);
 }
});
test('enabled readers require an explicit transactional adapter',()=>{
 for(const kind of ['list','detail']){
  const exports=load(kind),make=kind==='list'?exports.createAuthenticatedReader:exports.createDetailReader;
  assert.throws(()=>make({enabled:true,bridge:bridge().db,verifyAuth:async()=>({uid})}),/trusted-auth-sdk-normalizer-required/);
 }
});
test('list reader invokes injected lifecycle after auth and membership checks',async()=>{
 const {db}=bridge(),calls=[];
 const read=load('list').createAuthenticatedReader({enabled:true,bridge:db,verifyAuth:async()=>({uid}),resolveRoomLifecycle:async args=>{calls.push(args);return {status:'supported',phase:'live',active:true};}});
 const result=await read({data:{}});
 assert.equal(result.status,'ready');assert.equal(result.cards.length,1);
 assert.equal(result.cards[0].phase,'live');assert.equal(calls.length,1);
 assert.equal(calls[0].code,code);assert.equal(calls[0].room.ref.path,'tournaments/'+code);
});
test('detail reader does not expose ended room after injected lifecycle',async()=>{
 const {db}=bridge(),calls=[];
 const read=load('detail').createDetailReader({enabled:true,bridge:db,verifyAuth:async()=>({uid}),resolveRoomLifecycle:async args=>{calls.push(args);return {status:'supported',phase:'done',active:false};}});
 const result=await read({data:{code}});
 assert.equal(result.status,'inactive');assert.equal(result.reason,'room-ended');
 assert.equal(calls.length,1);assert.equal(calls[0].code,code);
});
function splitRoom(f){
 const state={id:'room-1',cloudCode:code,meta:{stations:6},players:[],
  matches:[{id:'m1',station:1,completed:true,isBye:false,a:{playerId:'a'},b:{playerId:'b'},dispatchRevision:0,refereeSeatScoreRevision:0}],startedAt:1};
 const manifest=B.makeManifest(state,'epoch-1'),buckets=B.encode(state,manifest);
 f.values.set('tournaments/'+code,{data:JSON.stringify(state),tournamentPhase:'live',scoreStorage:manifest});
 f.values.set('publicTournaments/'+code,{scoreBucketProjection:{epoch:manifest.epoch,versions:Object.fromEntries(buckets.map(x=>[x.bucketId,x.revision]))}});
 for(const b of buckets)f.values.set('tournaments/'+code+'/matchBuckets/'+b.bucketId,b);
}
test('authenticated list consumes verified six-court buckets in one transaction',async()=>{
 const f=bridge();splitRoom(f);
 const read=load('list').createAuthenticatedReader({enabled:true,bridge:f.db,verifyAuth:async()=>({uid}),resolveRoomLifecycle:readRoomLifecycle});
 const result=await read({data:{}});
 assert.equal(result.status,'ready');assert.deepEqual(result.cards.map(x=>x.phase),['settling']);
});
test('authenticated list with missing bucket shows unresolved notice, no card',async()=>{
 const f=bridge();splitRoom(f);f.values.delete('tournaments/'+code+'/matchBuckets/court-2');
 const read=load('list').createAuthenticatedReader({enabled:true,bridge:f.db,verifyAuth:async()=>({uid}),resolveRoomLifecycle:readRoomLifecycle});
 const result=await read({data:{}});
 assert.equal(result.status,'synchronizing');assert.equal(result.cards.length,0);
 assert.ok(result.notices.includes('room-unavailable'));
});
test('authenticated detail reads the same verified split phase',async()=>{
 const f=bridge();splitRoom(f);
 const read=load('detail').createDetailReader({enabled:true,bridge:f.db,verifyAuth:async()=>({uid}),resolveRoomLifecycle:readRoomLifecycle});
 const result=await read({data:{code}});
 assert.equal(result.phase,'settling');
 assert.equal(result.status,'synchronizing'); // no synthetic registration row
 assert.ok(result.notices.includes('details-unconfirmed'));
});
