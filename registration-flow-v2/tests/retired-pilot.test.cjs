'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {createRequire}=require('node:module');
const {runInNewContext}=require('node:vm');

test('the retired pilot preserves authorized receipts without accepting new work',async()=>{
 const old='BXH-BZ2JW6',next='BXH-XJ7WJ5',uid='fixture';
 const file=require.resolve('../backend/bindings.cjs');
 const localRequire=createRequire(file);
 const status=[],writes=[],drains=[];
 const snapshot=data=>({data:()=>data,exists:data!==undefined});
 const phase={id:'room',startedAt:1};
 let prior;
 let gate={roomCode:next,workersEnabled:false,intakeEnabled:false,lifecycleEnabled:false};
 const reference=path=>({path,get:async()=>snapshot(gate),
  collection:name=>({doc:id=>reference(path+'/'+name+'/'+id)})});
 const db={doc:reference,runTransaction:callback=>callback({
  getAll:async()=>[snapshot({active:true,role:'super_admin'}),snapshot({data:JSON.stringify(phase)}),
   snapshot({bracketView:JSON.stringify(phase)}),snapshot(prior)],
  get:async()=>snapshot(gate),
  update:()=>assert.fail('retired lifecycle cannot write'),
 })};
 const queue={
  status:async(...args)=>{status.push(args);return {operation:{state:'completed'}};},
  enqueue:async(...args)=>{writes.push(args);return {operation:{state:'queued'}};},
  drainCreatedJob:async code=>drains.push(code),
  sweep:async code=>drains.push(code),
 };
 class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
 const bind=(_options,run)=>({run});
 const stubs={
  'firebase-functions/v2/https':{onCall:bind,HttpsError},
  'firebase-functions/v2/firestore':{onDocumentCreated:bind},
  'firebase-functions/v2/scheduler':{onSchedule:bind},
  './queue.cjs':{createQueue:()=>queue},
 };
 const mod={exports:{}};
 runInNewContext(readFileSync(file,'utf8'),{module:mod,require:id=>stubs[id]??localRequire(id)});
 const family=Object.assign(()=>async({auth,data})=>{
  assert.equal(auth.uid,uid);
  assert.equal(data.code,old);
  assert.equal(data.action,'mine');
  return {ok:true,rows:[]};
 },{v2CapacityAware:true});
 const create=(retiredRoom=old)=>mod.exports.createPilotBindings({pilotRoom:next,retiredRoom,db,FieldValue:{},
  createFamilyRegistration:family,rosterFactory:()=>{},promotionFactory:()=>{},authorizeManagement:()=>{}});
 assert.throws(()=>create(next),/invalid-retired-room/);
 const {registrationQueueV2:player,registrationRosterQueueV2:manager,registrationDrawV2:draw,
  registrationStartV2:start,registrationQueueV2Worker:worker,registrationQueueV2Sweep:sweep}=create();
 const call=(endpoint,code,data)=>endpoint.run({auth:{uid},data:{code,...data}});
 const operationId='operation-id';
 assert.equal((await call(player,old,{action:'mine',operationId})).operation.state,'completed');
 assert.equal((await call(manager,old,{action:'status',operationId})).operation.state,'completed');
 assert.deepEqual(status,[[uid,old,operationId],[uid,old,operationId]]);
 await assert.rejects(player.run({data:{code:old,action:'mine'}}),{code:'unauthenticated'});
 await assert.rejects(call(player,'BXH-OTHER',{action:'status',operationId}),/registration-queue-disabled/);

 gate={roomCode:next,workersEnabled:true,intakeEnabled:true,lifecycleEnabled:true};
 const signup=code=>({action:'submit',operation:{code,route:'family',payload:{code,action:'join'}}});
 await assert.rejects(call(player,old,signup(old)),/registration-queue-disabled/);
 await assert.rejects(call(manager,old,{action:'configure',operationId,enabled:true}),/registration-queue-disabled/);
 assert.equal((await call(player,next,signup(next))).operation.state,'queued');
 assert.equal(writes.length,1);

 const payload={roomId:'room',rosterRevision:0,operationId};
 await assert.rejects(call(draw,old,{...payload,baseDrawId:null}),/registration-queue-disabled/);
 await assert.rejects(call(start,old,{...payload,drawId:'draw'}),/registration-queue-disabled/);
 const {createHash}=require('node:crypto');
 const receiptFor=id=>({requestHash:createHash('sha256').update(JSON.stringify(['room',id,0,false])).digest('hex'),
  result:{ok:true,drawId:'draw'}});
 prior=receiptFor(null);
 assert.equal((await call(draw,old,{...payload,baseDrawId:null})).replayed,true);
 prior=receiptFor('draw');
 assert.equal((await call(start,old,{...payload,drawId:'draw'})).replayed,true);
 await assert.rejects(call(start,old,{...payload,drawId:'different'}),/operation-conflict/);

 await worker.run({params:{code:old,job:'fixture'}});
 await worker.run({params:{code:next,job:'fixture'}});
 await sweep.run({});
 assert.deepEqual(drains,[next,next]);
});
