'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {createRequire}=require('node:module');
const {runInNewContext}=require('node:vm');

function fixture(){
 const file=require.resolve('../backend/bindings.cjs'),localRequire=createRequire(file);
 const pilot='BXH-XXDNAH',olds=['BXH-BZ2JW6','BXH-XJ7WJ5'];
 const status=[],writes=[],drains=[];
 let gate={roomCode:pilot,workersEnabled:true,intakeEnabled:true,lifecycleEnabled:true};
 const db={doc:()=>({get:async()=>({data:()=>gate})})};
 const queue={status:async(...args)=>{status.push(args);return {operation:{state:'completed'}};},
  enqueue:async(...args)=>{writes.push(args);return {operation:{state:'queued'}};},
  drainCreatedJob:async code=>drains.push(code),sweep:async code=>drains.push(code)};
 const family=Object.assign(()=>async()=>({ok:true,rows:[]}),{v2CapacityAware:true});
 class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
 const bind=(_options,run)=>({run});
 const stubs={
  'firebase-functions/v2/https':{onCall:bind,HttpsError},
  'firebase-functions/v2/firestore':{onDocumentCreated:bind},
  'firebase-functions/v2/scheduler':{onSchedule:bind},
  './queue.cjs':{createQueue:()=>queue},
  './lifecycle.cjs':{createDrawHandler:()=>async()=>{},createStartHandler:()=>async()=>{}}
 };
 const module={exports:{}};
 runInNewContext(readFileSync(file,'utf8'),{module,require:id=>stubs[id]??localRequire(id)});
 const create=(options={})=>module.exports.createPilotBindings({pilotRoom:pilot,
  retiredRoom:olds[0],retiredRooms:[olds[1]],db,FieldValue:{},createFamilyRegistration:family,
  rosterFactory:()=>{},promotionFactory:()=>{},authorizeManagement:()=>{},...options});
 const call=(endpoint,code,data,uid='synthetic-actor')=>endpoint.run({auth:{uid},data:{code,...data}});
 return {pilot,olds,status,writes,drains,create,call,close:()=>{gate={...gate,workersEnabled:false,intakeEnabled:false};}};
}

test('both retired pilots can read actor-scoped receipts while only the current pilot accepts work',async()=>{
 const f=fixture(),endpoints=f.create(),operationId='synthetic-operation';
 for(const code of f.olds){
  for(const action of ['mine','status']){
   const result=await f.call(endpoints.registrationQueueV2,code,{action,operationId});
   assert.equal(result.operation.state,'completed');
  }
  assert.equal((await f.call(endpoints.registrationRosterQueueV2,code,{action:'status',operationId})).operation.state,'completed');
  const operation={code,route:'family',payload:{action:'join',code}};
  await assert.rejects(f.call(endpoints.registrationQueueV2,code,{action:'submit',operation}),/registration-queue-disabled/);
  await assert.rejects(f.call(endpoints.registrationQueueV2,code,{action:'preview'}),/registration-queue-disabled/);
  await assert.rejects(f.call(endpoints.registrationRosterQueueV2,code,{action:'configure',operationId,enabled:true}),/registration-queue-disabled/);
 }
 assert.equal(f.status.length,6);
 assert.ok(f.status.every(args=>args[0]==='synthetic-actor'&&f.olds.includes(args[1])&&args[2]===operationId));
 const code=f.pilot,operation={code,route:'family',payload:{action:'join',code}};
 assert.equal((await f.call(endpoints.registrationQueueV2,code,{action:'submit',operation})).operation.state,'queued');
 assert.equal(f.writes.length,1);
 await assert.rejects(f.call(endpoints.registrationQueueV2,'BXH-OTHER',{action:'status',operationId}),/registration-queue-disabled/);
 await assert.rejects(endpoints.registrationQueueV2.run({data:{code:f.olds[0],action:'status',operationId}}),{code:'unauthenticated'});
});

test('closed intake keeps both old pilots queryable and background work stays scoped to the current pilot',async()=>{
 const f=fixture(),endpoints=f.create();
 for(const code of f.olds)await endpoints.registrationQueueV2Worker.run({params:{code,job:'synthetic-job'}});
 await endpoints.registrationQueueV2Worker.run({params:{code:f.pilot,job:'synthetic-job'}});
 await endpoints.registrationQueueV2Sweep.run({});assert.deepEqual(f.drains,[f.pilot,f.pilot]);
 f.close();
 for(const code of f.olds)assert.equal((await f.call(endpoints.registrationQueueV2,code,
  {action:'mine',operationId:'synthetic-operation'})).operation.state,'completed');
 await endpoints.registrationQueueV2Worker.run({params:{code:f.pilot,job:'synthetic-job'}});
 await endpoints.registrationQueueV2Sweep.run({});assert.equal(f.drains.length,2);
 const code=f.pilot,operation={code,route:'family',payload:{action:'join',code}};
 await assert.rejects(f.call(endpoints.registrationQueueV2,code,{action:'submit',operation}),/registration-queue-disabled/);
});

test('retired room lists reject duplicates, current pilot, invalid values and excess entries',()=>{
 const f=fixture();
 for(const options of [{retiredRooms:[f.olds[0]]},{retiredRooms:[f.pilot]},
  {retiredRooms:'BXH-OTHER'},{retiredRooms:['bad']},{retiredRooms:Array(9).fill('BXH-OTHER')}]){
  assert.throws(()=>f.create(options),/invalid-retired-room/);
 }
 assert.doesNotThrow(()=>f.create({retiredRooms:[]}));
 assert.doesNotThrow(()=>f.create({retiredRoom:null,retiredRooms:f.olds}));
});
