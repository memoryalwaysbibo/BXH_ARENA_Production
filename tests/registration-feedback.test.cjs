'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {create,PREFIX}=require('../modules/main-app/registration-feedback.js');
const CODE='BXH-FEED01';
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function memory(){const data=new Map();return {data,get length(){return data.size;},key:i=>[...data.keys()][i],getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};}
function fixture(options={}){
 let clock=0,uid='user1',counter=0;const timers=new Map(),storage=options.storage||memory(),queries=[],changes=[],recoveries=[];
 const read=options.read||(async()=>({ok:true,rows:[]}));
 const api=create({...options,getUid:()=>uid,storage,now:()=>clock,schedule:(fn,ms)=>{const id=++counter;timers.set(id,{at:clock+ms,fn});return id;},unschedule:id=>timers.delete(id),onChange:r=>changes.push(r),onRecovered:r=>recoveries.push(r),read:async code=>{queries.push(code);return read(code);}});
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
 assert.equal(f.queries.length,5);assert.equal(f.api.snapshot()[0].state,'unconfirmed');assert.equal(f.timers.size,0);f.api.dispose();
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
