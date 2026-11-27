'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHoldService}=require('./hold-service.cjs');
function fixture({capacity=1,version=3,count=2}={}){
 const code='BXH-ABC123',base='tournaments/'+code,ledger=base+'/registrationV3State/ledger';
 const data=new Map([[base,{registrationFlowVersion:version,tournamentPhase:'waiting',capacity}],
 [ledger,{capacity,occupiedCount:0,pendingReviewCount:0,confirmedCount:0,sequence:0,revision:0}],
 ['users/manager',{active:true,role:'admin'}]]);
 const ids=Array.from({length:count},(_,i)=>'player'+i);
 for(const uid of ids)data.set('users/'+uid,{active:true,realName:uid,phone:'private'});
 const snap=(path,store)=>({exists:store.has(path),data:()=>structuredClone(store.get(path))});
 const ref=path=>({path,collection:name=>ref(path+'/'+name),doc:name=>ref(path+'/'+name)});
 let tail=Promise.resolve();
 const db={doc:ref,runTransaction(fn){
  const result=tail.then(async()=>{
   const draft=structuredClone(data);
   const tx={getAll:async(...refs)=>refs.map(r=>snap(r.path,draft)),
    set:(r,v)=>draft.set(r.path,structuredClone(v)),
    create:(r,v)=>{assert(!draft.has(r.path));draft.set(r.path,structuredClone(v));}};
   const value=await fn(tx);data.clear();for(const [k,v] of draft)data.set(k,v);return value;
  });
  tail=result.catch(()=>{});return result;
 }};
 const metrics=[];
 const service=()=>createHoldService({db,authorizeJoin:c=>c.uid===c.registrationId,
  authorizeReview:c=>c.user.role==='admin',authorizeCancel:c=>c.uid===c.registrationId,observe:m=>metrics.push(m)});
 let handler=service();
 const call=(actor,action,operationId,registrationId=actor,expectedAttemptId)=>handler({auth:{uid:actor},data:{code,action,operationId,registrationId,expectedAttemptId}});
 return {data,ledger,base,ids,metrics,call,restart:()=>{handler=service();}};
}
test('persistent hold, restart and receipt replay; A contains only approved data',async()=>{
 const f=fixture();
 const held=await f.call('player0','join','join-0001');
 const hold=f.data.get(f.base+'/registrationV3Holds/player0');
 assert.deepEqual(Object.keys(hold).sort(),['attemptId','sequence','status','submittedAt','uid','updatedAt']);
 assert.equal(f.data.has(f.base+'/registrations/player0'),false);
 assert.equal(f.metrics[0].reads,5);assert.equal(f.metrics[0].committedWrites,3);
 f.restart();
 assert.equal((await f.call('player0','join','join-0001')).replayed,true);
 assert.equal(f.metrics[1].committedWrites,0);
 await assert.rejects(f.call('player1','approve','approve-01','player0',held.attemptId),/permission-denied/);
 const approved=await f.call('manager','approve','approve-02','player0',held.attemptId);
 assert.equal(approved.summary.occupiedCount,1);
 assert.equal(f.data.get(f.base+'/registrations/player0').status,'confirmed');
 assert.equal(f.metrics.at(-1).reads,7);assert.equal(f.metrics.at(-1).committedWrites,4);
 await f.call('player0','cancel','cancel-001','player0',held.attemptId);
 assert.equal(f.data.get(f.ledger).occupiedCount,0);
 assert.equal(f.data.get(f.base+'/registrations/player0').status,'cancelled');
});
test('192 simulated concurrent callers, exact capacity and rejection recovery',async()=>{
 const f=fixture({capacity:192,count:193});
 const results=await Promise.allSettled(f.ids.map(uid=>f.call(uid,'join','join-'+uid)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,192);
 assert.equal(results[192].reason.message,'full');
 assert.equal(f.data.get(f.ledger).occupiedCount,192);
 const attempts=results.slice(0,192).map(r=>r.value);
 assert.equal(new Set(attempts.map(x=>x.sequence)).size,192);
 await f.call('manager','reject','reject-001','player0',attempts[0].attemptId);
 assert.equal(f.data.get(f.ledger).occupiedCount,191);
 assert.equal((await f.call('player192','join','join-retry')).summary.occupiedCount,192);
 assert.equal(f.data.has(f.base+'/registrations/player0'),false);
});
test('legacy room is not changed',async()=>{
 for(const version of [1,2]){
  const f=fixture({version}),before=structuredClone(f.data);
  await assert.rejects(f.call('player0','join','join-0001'),/registration-v3-required/);
  assert.deepEqual(f.data,before);
 }
});
