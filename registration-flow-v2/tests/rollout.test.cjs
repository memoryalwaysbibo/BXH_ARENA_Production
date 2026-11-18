'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {readFileSync}=require('node:fs'),{createRequire}=require('node:module'),{runInNewContext}=require('node:vm');
function fixture(){
 const pilot='BXH-XXDNAH',a='BXH-ROOM01',b='BXH-ROOM02',old='BXH-BZ2JW6',legacy='BXH-LEGACY';
 const docs=new Map([
  ['systemSettings/registrationFlowV2Pilot',{roomCode:pilot,workersEnabled:true,intakeEnabled:true,lifecycleEnabled:true}],
  ['systemSettings/registrationFlowV2Rollout',{roomCodes:[a,b],workersEnabled:true,intakeEnabled:true,lifecycleEnabled:true}],
  ...[pilot,a,b,old].map(code=>['tournaments/'+code,{registrationQueueVersion:2}]),
  ['tournaments/'+legacy,{}],
 ]);
 const ref=path=>({path,get:async()=>({data:()=>docs.get(path)})});
 const db={doc:ref},tx={get:reference=>reference.get()};
 const writes=[],drains=[],reads=[],scopes=[];let queueOptions;
 const queue={status:async(uid,code,id)=>{reads.push({uid,code,id});return {ok:true,operation:{operationId:id,state:'completed'}};},
  enqueue:async(uid,operation)=>{if(!await queueOptions.authorizeIntake(operation.code,tx))throw Error('registration-queue-disabled');writes.push(operation.code);return {ok:true,operation:{state:'queued'}};},
  drainCreatedJob:async code=>drains.push(code),
  sweep:async(code,options)=>{scopes.push(code);for(const pending of [pilot,a,b,old,legacy])if(code===pending||code===null&&await options.allowRoom(pending))drains.push(pending);},
 };
 class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
 const bind=(_options,run)=>({run});
 const file=require.resolve('../backend/bindings.cjs'),localRequire=createRequire(file),bindings={exports:{}};
 const stubs={
  'firebase-functions/v2/https':{onCall:bind,HttpsError},
  'firebase-functions/v2/firestore':{onDocumentCreated:bind},'firebase-functions/v2/scheduler':{onSchedule:bind},
  './queue.cjs':{createQueue:(_db,options)=>{queueOptions=options;return queue;}},
  './lifecycle.cjs':{createStartHandler:({enabled})=>async req=>{if(!await enabled(req.data.code,tx))throw Error('registration-queue-disabled');return {ok:true};},createDrawHandler:({enabled})=>async req=>{if(!await enabled(req.data.code,tx))throw Error('registration-queue-disabled');return {ok:true};}},
 };
 runInNewContext(readFileSync(file,'utf8'),{module:bindings,require:id=>stubs[id]??localRequire(id)});
 const rollout={exports:{}};
 runInNewContext(readFileSync(require.resolve('../backend/rollout.cjs'),'utf8'),{module:rollout,require:()=>bindings.exports});
 const family=Object.assign(()=>async()=>({ok:true,rows:[]}),{v2CapacityAware:true});
 const endpoints=rollout.exports.createRolloutBindings({pilotRoom:pilot,retiredRooms:[old],db,FieldValue:{},createFamilyRegistration:family,rosterFactory:()=>{},promotionFactory:()=>{},authorizeManagement:()=>{}});
 const call=(endpoint,code,data={})=>endpoint.run({auth:{uid:'actor'},data:{code,...data}});
 const submit=code=>call(endpoints.registrationQueueV2,code,{action:'submit',operation:{code,route:'family',payload:{action:'join',code}}});
 return {pilot,a,b,old,legacy,docs,writes,drains,reads,scopes,endpoints,call,submit};
}
test('two owned rollout rooms and the original pilot accept work; legacy and retired rooms do not',async()=>{
 const f=fixture();for(const code of [f.pilot,f.a,f.b])assert.equal((await f.submit(code)).operation.state,'queued');
 for(const code of [f.old,f.legacy,'bad'])await assert.rejects(f.submit(code),/registration-queue-disabled/);
 assert.deepEqual(f.writes,[f.pilot,f.a,f.b]);
 f.docs.set('systemSettings/registrationFlowV2Rollout',{roomCodes:[f.legacy],workersEnabled:true,intakeEnabled:true});
 await assert.rejects(f.submit(f.legacy),/registration-queue-disabled/);
});
test('closing intake preserves original receipts and drains already accepted jobs',async()=>{
 const f=fixture();await f.submit(f.a);f.docs.get('systemSettings/registrationFlowV2Rollout').intakeEnabled=false;
 await assert.rejects(f.submit(f.a),/registration-queue-disabled/);
 assert.equal((await f.call(f.endpoints.registrationQueueV2,f.a,{action:'status',operationId:'original-operation'})).operation.state,'completed');
 assert.equal((await f.call(f.endpoints.registrationQueueV2,f.a,{action:'mine',operationId:'original-operation'})).ok,true);
 await f.endpoints.registrationQueueV2Worker.run({params:{code:f.a,job:'original-job'}});
 assert.deepEqual(f.drains,[f.a]);assert.equal(f.writes.length,1);assert(f.reads.every(r=>r.uid==='actor'));
});
test('removing intake membership does not strand jobs, and sweeping excludes retired and legacy rooms',async()=>{
 const f=fixture();f.docs.get('systemSettings/registrationFlowV2Rollout').roomCodes=[f.b];
 await assert.rejects(f.submit(f.a),/registration-queue-disabled/);
 await f.endpoints.registrationQueueV2Sweep.run({});assert.deepEqual(f.scopes,[null]);
 assert.deepEqual(f.drains,[f.pilot,f.a,f.b]);
});
test('worker stop and explicit pilot stop take precedence over the old pilot gate',async()=>{
 const f=fixture();Object.assign(f.docs.get('systemSettings/registrationFlowV2Rollout'),{roomCodes:[f.pilot,f.a],workersEnabled:false});
 for(const code of [f.pilot,f.a]){
  await assert.rejects(f.submit(code),/registration-queue-disabled/);
  await f.endpoints.registrationQueueV2Worker.run({params:{code,job:'job'}});
 }
 await f.endpoints.registrationQueueV2Sweep.run({});assert.deepEqual(f.drains,[]);
});
test('absent or malformed rollout configuration preserves only the existing pilot',async()=>{
 const f=fixture();
 for(const config of [undefined,{roomCodes:[f.a,f.a],workersEnabled:true,intakeEnabled:true},{roomCodes:[f.old],workersEnabled:true,intakeEnabled:true},{roomCodes:['bad'],workersEnabled:true,intakeEnabled:true}]){
  f.docs.set('systemSettings/registrationFlowV2Rollout',config);
  await f.submit(f.pilot);await assert.rejects(f.submit(f.a),/registration-queue-disabled/);
 }
});
test('draw and start use their own rollout gate and cannot write after intake-only activation',async()=>{
 const f=fixture();for(const endpoint of [f.endpoints.registrationDrawV2,f.endpoints.registrationStartV2]){
  assert.equal((await f.call(endpoint,f.a)).ok,true);
  f.docs.get('systemSettings/registrationFlowV2Rollout').lifecycleEnabled=false;
  await assert.rejects(f.call(endpoint,f.a),/registration-queue-disabled/);
  f.docs.get('systemSettings/registrationFlowV2Rollout').lifecycleEnabled=true;
 }
});
test('the real global sweep filters retired rooms before acquiring a lease',async()=>{
 const {createQueue}=require('../backend/queue.cjs');let transactions=0;
 const pending={docs:[{ref:{parent:{parent:{parent:{path:'_registrationQueueV2'}}}},data:()=>({code:'BXH-OLDROOM'})}]};
 const query={where:()=>query,limit:()=>query,get:async()=>pending};
 const queue=createQueue({collection:()=>({}),collectionGroup:()=>query,runTransaction:()=>{transactions++;throw Error('must not acquire');}},{handlers:{family:()=>{},roster:()=>{}},FieldValue:{}});
 const checked=[];assert.deepEqual(await queue.sweep(null,{allowRoom:async code=>{checked.push(code);return false;}}),{rooms:0});
 assert.deepEqual(checked,['BXH-OLDROOM']);assert.equal(transactions,0);
});
