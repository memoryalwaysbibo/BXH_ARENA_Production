'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {create,PREFIX}=require('../modules/main-app/registration-feedback.js');
const CODE='BXH-FEED01';
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function memory(){const data=new Map();return {data,get length(){return data.size;},key:i=>[...data.keys()][i],getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};}
function fixture(options={}){
 let clock=0,uid='user1',counter=0;const timers=new Map(),storage=options.storage||memory(),queries=[],changes=[],recoveries=[];
 const read=options.read||(async()=>({ok:true,rows:[]}));
 const api=create({...options,getUid:()=>uid,storage,now:()=>clock,schedule:(fn,ms)=>{const id=++counter;timers.set(id,{at:clock+ms,fn});return id;},unschedule:id=>timers.delete(id),onChange:r=>changes.push(r),onRecovered:r=>recoveries.push(r),read:async (code,operation)=>{queries.push(code);return read(code,operation);}});
 async function advance(ms){const end=clock+ms;for(let safety=0;safety<1000;safety++){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;clock=next[1].at;timers.delete(next[0]);next[1].fn();await flush();}clock=end;await flush();}
 return {api,storage,queries,changes,recoveries,timers,advance,setUid:value=>{uid=value;api.restore();}};
}
test('100 repeated clicks share one request across the whole preflight and submit',async()=>{
 const f=fixture(),pending=deferred();let sends=0;const send=async p=>{sends++;p.submitting(['user1']);return pending.promise;};
 const calls=Array.from({length:100},()=>f.api.run(CODE,send));assert(calls.every(p=>p===calls[0]));await flush();assert.equal(sends,1);assert.equal(f.api.snapshot()[0].state,'submitting');
 pending.resolve({ok:true,status:'confirmed'});assert.equal((await calls[0]).status,'confirmed');assert.equal(f.storage.length,0);f.api.dispose();
});
test('slow submission reads once and an empty result is never considered failure or success',async()=>{
 const f=fixture(),pending=deferred();const flight=f.api.run(CODE,async p=>{p.submitting(['user1']);return pending.promise;});flight.catch(()=>{});await flush();await f.advance(8000);
 assert.equal(f.queries.length,1);assert.equal(f.api.snapshot()[0].state,'unconfirmed');assert.equal(f.storage.length,1);
 pending.resolve({ok:true,status:'waitlist'});assert.equal((await flight).status,'waitlist');f.api.dispose();
});
test('committed result recovers while original response remains stalled',async()=>{
 const f=fixture({read:async()=>({ok:true,rows:[{registrationId:'user1',status:'confirmed'}]})}),pending=deferred();
 const flight=f.api.run(CODE,async p=>{p.submitting(['user1']);return pending.promise;});await flush();await f.advance(8000);
 assert.equal((await flight).recovered,true);assert.equal(f.recoveries.length,1);pending.reject(Error('functions/unavailable'));await flush();assert.equal(f.api.snapshot()[0].state,'confirmed');f.api.dispose();
});
test('refresh restores only this account and reads without resubmitting',async()=>{
 const storage=memory();storage.setItem(PREFIX+'user1:'+CODE,JSON.stringify({version:1,uid:'user1',code:CODE,ids:['family_child1'],createdAt:1}));
 const f=fixture({storage,read:async()=>({ok:true,rows:[{registrationId:'family_child1',status:'waitlist'}]})});f.api.restore();await f.advance(0);
 assert.equal(f.api.snapshot()[0].state,'confirmed');assert.equal(f.queries.length,1);assert.equal(storage.length,0);f.api.dispose();
});
test('existing parent registration cannot falsely confirm a child request',async()=>{
 const f=fixture({read:async()=>({ok:true,rows:[{registrationId:'user1',status:'confirmed'}]})}),p=deferred();const flight=f.api.run(CODE,async progress=>{progress.submitting(['family_child1']);return p.promise;});flight.catch(()=>{});await flush();await f.advance(8000);
 assert.equal(f.api.snapshot()[0].state,'unconfirmed');f.api.dispose();
});
test('every selected child must be found before recovery reports success',async()=>{
 const f=fixture({read:async()=>({ok:true,rows:[{registrationId:'family_child1',status:'confirmed'}]})}),p=deferred();const flight=f.api.run(CODE,async progress=>{progress.submitting(['family_child1','family_child2']);return p.promise;});flight.catch(()=>{});await flush();await f.advance(8000);assert.equal(f.api.snapshot()[0].state,'unconfirmed');f.api.dispose();
});
test('cancelled and malformed read results remain unknown',async()=>{
 for(const response of [{ok:true,rows:[{registrationId:'user1',status:'cancelled'}]},{rows:[{registrationId:'user1',status:'confirmed'}]},null]){
  const f=fixture({read:async()=>response}),p=deferred();const flight=f.api.run(CODE,async progress=>{progress.submitting(['user1']);return p.promise;});flight.catch(()=>{});await flush();await f.advance(8000);assert.equal(f.api.snapshot()[0].state,'unconfirmed');f.api.dispose();
 }
});
test('preflight timeout cannot submit later even when the stalled read completes',async()=>{
 const f=fixture(),p=deferred();let writes=0;const flight=f.api.run(CODE,async progress=>{await p.promise;progress.assertCurrent();progress.submitting(['user1']);writes++;return {ok:true,status:'confirmed'};});flight.catch(()=>{});await flush();await f.advance(65000);await assert.rejects(flight,/preparation-timeout/);p.resolve();await flush();assert.equal(writes,0);f.api.dispose();
});
test('unknown transport outcome does not clear the journal or allow a second write',async()=>{
 const f=fixture();let writes=0;const send=async p=>{p.submitting(['user1']);writes++;throw Error('functions/deadline-exceeded');};
 await assert.rejects(f.api.run(CODE,send),/result-pending/);await assert.rejects(f.api.run(CODE,send),/result-pending/);assert.equal(writes,1);assert.equal(f.storage.length,1);f.api.dispose();
});
test('definitive full rejection releases the operation, permitting a new attempt',async()=>{
 const f=fixture();await assert.rejects(f.api.run(CODE,async p=>{p.submitting(['user1']);throw Error('full functions/failed-precondition');}),/full/);
 assert.equal(f.storage.length,0);assert.equal((await f.api.run(CODE,async p=>{p.submitting(['user1']);return {ok:true,status:'waitlist'};})).status,'waitlist');f.api.dispose();
});
test('failed local storage warns but allows in-page submission',async()=>{
 const storage={get length(){return 0;},getItem(){throw Error('blocked');},setItem(){throw Error('blocked');},removeItem(){throw Error('blocked');}};
 const f=fixture({storage}),p=deferred();const flight=f.api.run(CODE,async progress=>{progress.submitting(['user1']);return p.promise;});await flush();assert.equal(f.api.snapshot()[0].durable,false);p.resolve({ok:true,status:'confirmed'});await flight;f.api.dispose();
});
test('logout fences delayed preflight and a different account cannot see its journal',async()=>{
 const f=fixture(),p=deferred();let writes=0;const flight=f.api.run(CODE,async progress=>{await p.promise;progress.assertCurrent();writes++;return {ok:true,status:'confirmed'};});flight.catch(()=>{});await flush();f.setUid('user2');p.resolve();await assert.rejects(flight,/stale-session/);await flush();assert.equal(writes,0);assert.equal(f.api.snapshot().length,0);f.api.dispose();
});
test('hung recovery reads time out and automatic rechecks are bounded',async()=>{
 const f=fixture({read:()=>new Promise(()=>{})}),p=deferred();const flight=f.api.run(CODE,async progress=>{progress.submitting(['user1']);return p.promise;});flight.catch(()=>{});await flush();await f.advance(250000);
 assert.equal(f.queries.length,1,'UI timeout must not stack uncancelled callable requests');assert.equal(f.api.snapshot()[0].state,'unconfirmed');assert.equal(f.api.snapshot()[0].autoPaused,true);assert.equal(f.timers.size,0);f.api.dispose();
});
test('multiple manual checks coalesce into one read and query failures remain unknown',async()=>{
 const pending=deferred(),f=fixture({read:()=>pending.promise}),p=deferred();const flight=f.api.run(CODE,async progress=>{progress.submitting(['user1']);return p.promise;});flight.catch(()=>{});await flush();
 const checks=Array.from({length:10},()=>f.api.recheck(CODE));await flush();assert.equal(f.queries.length,1);pending.reject(Error('offline'));await Promise.all(checks);assert.equal(f.api.snapshot()[0].state,'unconfirmed');f.api.dispose();
});
test('journal contains identity keys only, never private registration response fields',async()=>{
 const f=fixture(),p=deferred();const flight=f.api.run(CODE,async progress=>{progress.submitting(['user1']);return p.promise;});flight.catch(()=>{});await flush();const r=JSON.parse([...f.storage.data.values()][0]);assert.deepEqual(Object.keys(r).sort(),['code','createdAt','ids','uid','version']);f.api.dispose();
});
test('after a reload, explicit retry preserves the exact original operation and allocation',async()=>{
 const storage=memory(),request={action:'join',code:CODE,childIds:[null],allocation:[{registrationId:'user1',status:'confirmed'}],childEligibilityConfirmed:true,operationId:'original-operation-123'};
 const first=fixture({storage});await assert.rejects(first.api.run(CODE,async p=>{p.submitting(['user1'],request);throw Error('functions/unavailable');}),/result-pending/);first.api.dispose();
 let received,committed=false;const next=fixture({storage,read:async()=>({ok:true,rows:committed?[{registrationId:'user1',status:'confirmed'}]:[]}),retry:async payload=>{received=payload;committed=true;return {ok:true,status:'confirmed'};}});next.api.restore();await next.advance(0);assert.equal(next.api.snapshot()[0].canRetry,true);
 assert.equal((await next.api.retryOriginal(CODE)).status,'confirmed');assert.deepEqual(received,request);assert.equal(storage.length,0);next.api.dispose();
});
test('unsafe persisted retry payload cannot be replayed',async()=>{
 const storage=memory();storage.setItem(PREFIX+'user1:'+CODE,JSON.stringify({version:1,uid:'user1',code:CODE,ids:['user1'],createdAt:1,retry:{action:'join',code:CODE,childIds:[null],operationId:'original-operation',childEligibilityConfirmed:true,phone:'private-data'}}));
 const f=fixture({storage,retry:()=>{throw Error('must not send');}});f.api.restore();await f.advance(0);assert.equal(f.api.snapshot()[0].canRetry,false);await assert.rejects(f.api.retryOriginal(CODE),/original-request-unavailable/);f.api.dispose();
});
test('an old successful receipt cannot resurrect a subsequently cancelled registration',async()=>{
 const storage=memory(),request={action:'join',code:CODE,childIds:[null],childEligibilityConfirmed:true,operationId:'old-operation-123'};
 storage.setItem(PREFIX+'user1:'+CODE,JSON.stringify({version:1,uid:'user1',code:CODE,ids:['user1'],createdAt:1,retry:request}));
 const f=fixture({storage,read:async()=>({ok:true,rows:[{registrationId:'user1',status:'cancelled'}]}),retry:async()=>({ok:true,status:'confirmed'})});f.api.restore();await f.advance(0);
 await assert.rejects(f.api.retryOriginal(CODE),/no-longer-active/);assert.equal(f.api.snapshot()[0].state,'failed');assert.equal(storage.length,0);assert.equal(f.recoveries.length,0);f.api.dispose();
});
test('ten-minute unresolved result can leave the panel without deleting the journal or cancelling',async()=>{
 const f=fixture(),p=deferred();let sends=0;
 const flight=f.api.run(CODE,async progress=>{sends++;progress.submitting(['user1']);return p.promise;});flight.catch(()=>{});
 await flush();await f.advance(600000);await assert.rejects(flight,/result-pending/);
 assert.equal(f.api.snapshot()[0].autoPaused,true);assert.equal(f.api.snapshot()[0].deadlineReached,true);
 f.api.dismiss(CODE);assert.equal(f.api.snapshot()[0].hidden,true);assert.equal(f.storage.length,1);assert.equal(sends,1);
 await assert.rejects(f.api.run(CODE,()=>{sends++;}),/result-pending/);assert.equal(sends,1);assert.equal(f.api.snapshot()[0].hidden,false);f.api.dispose();
});
test('accepted durable operation remains pending until current registration is read back',async()=>{
 let committed=false;const f=fixture({read:async()=>({ok:true,operation:{state:committed?'completed':'queued'},rows:committed?[{registrationId:'user1',status:'confirmed'}]:[]})});let settled=false;
 const request={action:'join',code:CODE,childIds:[null],childEligibilityConfirmed:true,operationId:'queued-operation-01'};
 const flight=f.api.run(CODE,async p=>{p.submitting(['user1'],request);return {ok:true,operation:{state:'queued'}};});flight.then(()=>{settled=true;});
 await flush();assert.equal(settled,false);assert.equal(f.api.snapshot()[0].queueState,'queued');
 committed=true;await f.advance(8000);assert.equal((await flight).status,'confirmed');assert.equal(f.storage.length,0);f.api.dispose();
});
test('asynchronous queue business rejection ends waiting and permits a new operation',async()=>{
 const f=fixture({read:async()=>({ok:true,rows:[],operation:{state:'rejected',reason:'full'}})});
 const request={action:'join',code:CODE,childIds:[null],childEligibilityConfirmed:true,operationId:'queued-full-operation'};
 await assert.rejects(f.api.run(CODE,async p=>{p.submitting(['user1'],request);return {ok:true,operation:{state:'queued'}};}),/full/);
 assert.equal(f.api.snapshot()[0].state,'failed');assert.equal(f.storage.length,0);f.api.dispose();
});
test('retry acceptance is not misreported as registration-no-longer-active while worker is queued',async()=>{
 const storage=memory(),request={action:'join',code:CODE,childIds:[null],childEligibilityConfirmed:true,operationId:'queued-retry-operation'};
 storage.setItem(PREFIX+'user1:'+CODE,JSON.stringify({version:1,uid:'user1',code:CODE,ids:['user1'],createdAt:1,retry:request}));
 let committed=false;const f=fixture({storage,read:async()=>({ok:true,rows:committed?[{registrationId:'user1',status:'confirmed'}]:[],operation:{state:committed?'completed':'queued'}}),retry:async()=>({ok:true,operation:{state:'queued'}})});
 f.api.restore();await f.advance(0);const retried=f.api.retryOriginal(CODE);await flush();assert.notEqual(f.api.snapshot()[0].state,'failed');
 committed=true;await f.advance(8000);assert.equal((await retried).status,'confirmed');f.api.dispose();
});
const cancelRequest={action:'cancel',code:CODE,operationId:'cancel-operation-01',registrationId:'family_child1',intent:'player',localId:''};
const cancelReceipt=(result={},operation={})=>({ok:true,operation:{state:'completed',operationId:cancelRequest.operationId,result:{ok:true,status:'cancelled',registrationId:cancelRequest.registrationId,autoPromoted:true,...result},...operation}});
test('cancellation ignores roster rows and mismatched receipts until its own transaction completes',async()=>{
 let response={ok:true,rows:[{registrationId:cancelRequest.registrationId,status:'cancelled'}]};
 const pending=deferred(),f=fixture({read:async (code,query)=>{
  assert.equal(code,CODE);assert.deepEqual(query,{action:'cancel',operationId:cancelRequest.operationId});return response;
 }});
 const flight=f.api.run(CODE,p=>{p.submitting([cancelRequest.registrationId],cancelRequest);return pending.promise;},'cancel');
 await flush();await f.advance(8000);assert.equal(f.api.snapshot()[0].state,'unconfirmed');
 await assert.rejects(f.api.run(CODE,()=>assert.fail('must not submit a new join')),/cancellation-pending/);
 response=cancelReceipt({registrationId:'different-child'});await f.advance(3001);await f.api.recheck(CODE);
 assert.equal(f.api.snapshot()[0].state,'unconfirmed');
 response=cancelReceipt({}, {operationId:'different-operation'});await f.advance(3001);await f.api.recheck(CODE);
 assert.equal(f.api.snapshot()[0].state,'unconfirmed');
 response=cancelReceipt({privateRoomState:'ignore'});await f.advance(3001);await f.api.recheck(CODE);
 assert.deepEqual(await flight,{ok:true,status:'cancelled',registrationId:cancelRequest.registrationId,autoPromoted:true,queueCancellation:true,recovered:true});
 pending.resolve({ok:true,operation:{state:'queued'}});await flush();
 assert.equal(f.api.snapshot()[0].state,'confirmed');assert.equal(f.storage.length,0);assert.equal(f.recoveries.length,0);f.api.dispose();
});
test('reload restores cancellation and retries only the original operation',async()=>{
 const storage=memory(),first=fixture({storage});
 await assert.rejects(first.api.run(CODE,p=>{p.submitting([cancelRequest.registrationId],cancelRequest);throw Error('functions/unavailable');},'cancel'),/cancellation-pending/);
 first.api.dispose();let retried=false;
 const second=fixture({storage,read:async()=>null,retry:async request=>{assert.deepEqual(request,cancelRequest);retried=true;return cancelReceipt();}});
 second.api.restore();await second.advance(0);
 assert.equal(second.api.snapshot()[0].action,'cancel');assert.equal(retried,false);
 assert.equal((await second.api.retryOriginal(CODE)).status,'cancelled');assert.equal(retried,true);
 assert.equal(second.recoveries.length,1);assert.equal(storage.length,0);second.api.dispose();
});
test('a cancellation rejection ends waiting only for the matching operation',async()=>{
 const f=fixture({read:async()=>cancelReceipt({}, {state:'rejected',reason:'cancel-deadline-passed'})});
 await assert.rejects(f.api.run(CODE,p=>{p.submitting([cancelRequest.registrationId],cancelRequest);return {ok:true,operation:{state:'queued'}};},'cancel'),/cancel-deadline-passed/);
 assert.equal(f.api.snapshot()[0].state,'failed');assert.equal(f.storage.length,0);f.api.dispose();
});
test('the shipped cancellation action uses the V2 queue and avoids a legacy resend after rollback',async()=>{
 let response=null;
 const f=fixture({read:async()=>response}),requests=[];
 const cloud=fs.readFileSync(require.resolve('../modules/cloud/cloud-runtime.js'),'utf8');
 function source(marker,end){const start=cloud.indexOf(marker),stop=cloud.indexOf(end,start);assert(start>=0&&stop>start);return cloud.slice(start,stop+end.length);}
 const submit=source('  function submitRegistrationCancellation(','\n  }');
 const cancel=source('    async cancelRoster(','\n    },');
 const playerCancel=source('    async cancelRegistrationAsPlayer(','\n    },');
 const context=vm.createContext({window:{BXH_REGISTRATION_FLOW_V2_ROOMS:[CODE],engagementService:{familyRegistration:async()=>({ok:true,rows:[{registrationId:cancelRequest.registrationId,status:'confirmed'}]})}},
  authReady:true,authHandle:{currentUser:{uid:'user1'}},dbHandle:{},fx:{doc:()=>null,getDoc:async()=>({exists:()=>true,data:()=>({battleMode:'individual'})})},
  chooseFamilyRegistrationToCancel:async rows=>rows[0].registrationId,getPlayerRegistrationFeedback:()=>f.api,
  crypto:{randomUUID:()=>cancelRequest.operationId},runMyEventsPlayerOperation:()=>assert.fail('legacy mutation'),
  callEngagementFunction:async(name,payload)=>{requests.push({name,payload});return {ok:true,operation:{state:'queued'}};}
 });
 const cloudSync=vm.runInContext(`${submit}\n({${cancel}${playerCancel}})`,context);
 const flight=cloudSync.cancelRegistrationAsPlayer(CODE);await flush();
 assert.equal(requests.length,1);
 assert.deepEqual(JSON.parse(JSON.stringify(requests[0])),{name:'registrationQueueV2',payload:{action:'submit',code:CODE,operation:{code:CODE,route:'roster',operationId:cancelRequest.operationId,payload:cancelRequest}}});
 context.window.BXH_REGISTRATION_FLOW_V2_ROOMS=[];
 await assert.rejects(cloudSync.cancelRegistrationAsPlayer(CODE),/cancellation-pending/);
 assert.equal(requests.length,1);
 response=cancelReceipt();await f.advance(8000);
 assert.equal((await flight).queueCancellation,true);assert.equal(f.api.cancellationPending(CODE),false);f.api.dispose();
});
test('My Events blocks a pending room and refreshes from the verified cancellation without an untracked warning',async()=>{
 const browser={setTimeout,clearTimeout,queueMicrotask};
 vm.runInNewContext(fs.readFileSync(require.resolve('../my-events-player-slice.js'),'utf8'),browser);
 let cancelled=false,pending=false,lists=0;
 const stamp={seconds:1,nanoseconds:0},scope='individual-family';
 const slice=browser.BXHMyEventsPlayerSlice.create({storage:memory(),queryStatus:async()=>assert.fail('unexpected legacy operation query'),
  cancellationPending:code=>code===CODE&&pending,summary:async()=>({code:CODE,eventAuthority:'official',cancellationDeadline:Date.now()+60000}),
  call:async name=>{
   if(name==='queryMyActiveEvents'){lists++;return {schemaVersion:24,scope,status:'ready',notices:[],complete:true,confirmedEmpty:cancelled,nextCursor:null,cards:cancelled?[]:[{code:CODE,phase:'waiting',participantKinds:['self'],registrationStatuses:['confirmed']}]};}
   return {schemaVersion:1,scope,status:'ready',notices:[],hasMore:false,nextCursor:null,roomIncarnation:stamp,roomUpdateTime:stamp,rows:[{tournamentCode:CODE,uid:'user1',registrationId:'user1',displayName:'Fixture',status:'confirmed'}]};
  },cooldown:async()=>{}
 });
 slice.bind('user1',1);await slice.ensure();assert.ok(slice.cancellationContext(CODE));
 pending=true;assert.equal(slice.cancellationContext(CODE),null);assert.equal(lists,1);
 cancelled=true;pending=false;slice.invalidateConfirmedCancellation();assert.equal(slice.cancellationContext(CODE),null);
 await slice.ensure();assert.equal(lists,2);assert.equal(slice.registration(CODE),null);
 assert.match(slice.render(),/沒有進行中的賽事/);assert.doesNotMatch(slice.render(),/缺少可追蹤憑證/);slice.reset();
});

test('management queue restores the same promotion receipt after a lost response and rollout close',async()=>{
 const cloud=fs.readFileSync(require.resolve('../modules/cloud/cloud-runtime.js'),'utf8');
 const helper=cloud.slice(cloud.indexOf('  const managementQueueOperations='),cloud.indexOf('  let playerRegistrationFeedback='));
 const sessionStorage=memory(),requests=[];
 const payload={code:CODE,action:'promote',registrationId:'candidate',expandBy:0};
 function open(enabled){
  const context={
   window:{sessionStorage,BXH_REGISTRATION_FLOW_V2_ROOMS:enabled?[CODE]:[]},
   authReady:true,authHandle:{currentUser:{uid:'staff1'}},
   crypto:{randomUUID:()=>assert.fail('unexpected new operation ID')},
   callEngagementFunction:async(name,request)=>{
    assert.equal(name,'registrationRosterQueueV2');
    requests.push(request);
    if(request.action==='promote')throw Object.assign(Error('lost response'),{code:'functions/unavailable'});
    return {operation:{operationId:request.operationId,state:'completed',result:{ok:true,status:'confirmed',registrationId:'candidate'}}};
   }
  };
  return vm.runInNewContext(helper+'\nregistrationManagementOperation;',context);
 }
 assert.equal(await open(false)(payload,'original-promotion'),null);
 await assert.rejects(open(true)(payload,'original-promotion'),/registration-management-pending/);
 assert.equal(sessionStorage.length,1);
 const result=await open(false)(payload,'different-retry-id');
 assert.equal(result.status,'confirmed');assert.equal(result.verified,true);
 assert.deepEqual(requests.map(({action,operationId})=>[action,operationId]),[['promote','original-promotion'],['status','original-promotion']]);
 assert.equal(sessionStorage.length,0);
});

test('management queue matches the requested auto-fill value and the demotion receipt',async()=>{
 const cloud=fs.readFileSync(require.resolve('../modules/cloud/cloud-runtime.js'),'utf8');
 const helper=cloud.slice(cloud.indexOf('  const managementQueueOperations='),cloud.indexOf('  let playerRegistrationFeedback='));
 const sessionStorage=memory(),requests=[];
 const context={
  window:{sessionStorage,BXH_REGISTRATION_FLOW_V2_ROOMS:[CODE]},
  authReady:true,authHandle:{currentUser:{uid:'staff1'}},
  callEngagementFunction:async(name,request)=>{
   assert.equal(name,'registrationRosterQueueV2');
   requests.push(request);
   const result=request.action==='status'?{ok:true,enabled:false}:
    request.action==='configure'?{ok:true,enabled:false}:{ok:true,status:'waitlist',registrationId:'candidate'};
   return {operation:{operationId:request.operationId,state:'completed',result}};
  }
 };
 const run=vm.runInNewContext(helper+'\nregistrationManagementOperation;',context);
 await assert.rejects(run({code:CODE,action:'configure',enabled:true},'enable-original'),/registration-management-pending/);
 assert.equal((await run({code:CODE,action:'configure',enabled:false},'disable-original')).enabled,false);
 assert.equal((await run({code:CODE,action:'demote',registrationId:'candidate'},'demote-original')).status,'waitlist');
 assert.equal(sessionStorage.length,1);
 assert.deepEqual(requests.map(x=>x.operationId),['enable-original','disable-original','demote-original']);
});

test('self signup previews a populated or unreadable public roster in a finite V2 room',async()=>{
 const family=fs.readFileSync(require.resolve('../family-ui.js'),'utf8');
 const start=family.indexOf('async function chooseFamilyParticipant(');
 const end=family.indexOf('// v13.40.0',start);
 const requests=[];
 const context={
  currentAuthUid:()=> 'player',
  engagementSessionEpoch:1,
  window:{BXH_REGISTRATION_FLOW_V2_ROOMS:[CODE],engagementService:{
   familyRegistration:async data=>{
    requests.push(data);
    return {ok:true,allocation:[{registrationId:'player',status:'waitlist'}]};
   }
  }}
 };
 const choose=vm.runInNewContext(family.slice(start,end)+'\nchooseFamilyParticipant;',context);
 const event={capacity:2,confirmedCount:1};
 assert.equal((await choose({...event,bracketView:'{"players":[]}'},CODE,true)).allocation[0].status,'confirmed');
 assert.equal(requests.length,0);
 for(const bracketView of ['{"players":[{"id":"onsite"}]}','invalid',undefined]){
  assert.equal((await choose({...event,bracketView},CODE,true)).allocation[0].status,'waitlist');
 }
 assert.deepEqual(requests.map(x=>x.action),['preview','preview','preview']);
});

test('onsite batch recovery reuses the submitted operation without storing guest names in its key',async()=>{
 const cloud=fs.readFileSync(require.resolve('../modules/cloud/cloud-runtime.js'),'utf8');
 const helper=cloud.slice(cloud.indexOf('  const managementQueueOperations='),cloud.indexOf('  let playerRegistrationFeedback='));
 const sessionStorage=memory(),requests=[];
 function open(){
  const context={
   window:{sessionStorage,BXH_REGISTRATION_FLOW_V2_ROOMS:[CODE]},
   authReady:true,authHandle:{currentUser:{uid:'host'}},
   TextEncoder,crypto:require('node:crypto').webcrypto,
   callEngagementFunction:async(name,request)=>{
    assert.equal(name,'registrationRosterQueueV2');
    requests.push(request);
    if(request.action==='addLocal')throw Object.assign(Error('lost response'),{code:'functions/unavailable'});
    return {operation:{operationId:request.operationId,state:'completed',result:{ok:true,status:'added',addedCount:2,checkedIn:false}}};
   }
  };
  return vm.runInNewContext(helper+'\nregistrationManagementOperation;',context);
 }
 const payload={code:CODE,action:'addLocal',names:['Guest A','Guest B']};
 await assert.rejects(open()(payload,'original-onsite-batch'),/registration-management-pending/);
 assert.equal(sessionStorage.length,1);
 assert.doesNotMatch(sessionStorage.key(0),/Guest/);
 const result=await open()(payload,'unneeded-retry-id');
 assert.equal(result.addedCount,2);assert.equal(result.checkedIn,false);
 assert.deepEqual(requests.map(({action,operationId})=>[action,operationId]),[['addLocal','original-onsite-batch'],['status','original-onsite-batch']]);
 assert.equal(sessionStorage.length,0);
});
