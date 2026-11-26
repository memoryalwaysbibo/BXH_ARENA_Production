'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createService} = require('./service.cjs');
const {summarize} = require('./core.cjs');

function fixture(version=3) {
 const code='BXH-ABC123', base='tournaments/'+code, pub='publicTournaments/'+code;
 const runtime=JSON.stringify({meta:{checkinRequired:true},players:[],matches:[]});
 const fields={registrationFlowVersion:version,tournamentPhase:'waiting',...summarize(1,[])};
 const data=new Map([[base,{...fields,data:runtime}],[pub,{...fields,bracketView:runtime}],['users/playerA',{active:true,realName:'A'}],['users/playerB',{active:true,realName:'B'}],['users/manager',{active:true,role:'admin'}]]);
 const snap=(path,store)=>({id:path.split('/').at(-1),exists:store.has(path),data:()=>store.get(path)});
 const ref=path=>({path,collection:name=>ref(path+'/'+name),doc:name=>ref(path+'/'+name)});
 let pending=Promise.resolve();
 const db={doc:ref,runTransaction(fn){
  const run=pending.then(async()=>{
   const draft=structuredClone(data);
   const tx={
    getAll:(...refs)=>Promise.resolve(refs.map(r=>snap(r.path,draft))),
    get:async r=>({docs:[...draft.keys()].filter(k=>k.startsWith(r.path+'/')&&!k.slice(r.path.length+1).includes('/')).map(k=>snap(k,draft))}),
    set:(r,value)=>draft.set(r.path,value),
    update:(r,value)=>draft.set(r.path,{...draft.get(r.path),...value}),
    create:(r,value)=>{assert(!draft.has(r.path)); draft.set(r.path,value);}
   };
   const result=await fn(tx);
   data.clear(); for(const [k,v] of draft)data.set(k,v);
   return result;
  });
  pending=run.catch(()=>{});return run;
 }};
 const service=createService({db,authorizeJoin:ctx=>ctx.uid===ctx.registrationId,authorizeReview:ctx=>ctx.user.role==='admin',authorizeCancel:ctx=>ctx.uid===ctx.registrationId});
 const call=(uid,action,operationId,registrationId=uid,expectedAttemptId)=>service({auth:{uid},data:{code,action,operationId,registrationId,expectedAttemptId}});
 return {call,data,base,pub};
}
test('transaction commits row, both summaries and roster; replay does not decrement again',async()=>{
 const f=fixture();
 const held=await f.call('playerA','join','join-0001');
 assert.equal(held.status,'pending_review');
 assert.equal(f.data.get(f.base).availableCount,0);
 assert.equal(f.data.get(f.pub).pendingReviewCount,1);
 assert.equal(JSON.parse(f.data.get(f.pub).bracketView).players.length,0);
 const approved=await f.call('manager','approve','approve-01','playerA',held.attemptId);
 assert.equal(approved.summary.confirmedCount,1);
 assert.equal(JSON.parse(f.data.get(f.pub).bracketView).players.length,1);
 assert.equal((await f.call('manager','approve','approve-01','playerA',held.attemptId)).replayed,true);
 assert.equal(f.data.get(f.pub).confirmedCount,1);
});
test('only one hold for final seat, stale review of old attempt rejected',async()=>{
 const f=fixture();
 const results=await Promise.allSettled([f.call('playerA','join','join-0001'),f.call('playerB','join','join-0002')]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const held=results[0].value;
 await assert.rejects(f.call('playerB','approve','approve-01','playerA',held.attemptId),/permission-denied/);
 await f.call('manager','reject','reject-001','playerA',held.attemptId);
 const again=await f.call('playerA','join','join-0003');
 assert.notEqual(again.attemptId,held.attemptId);
 await assert.rejects(f.call('manager','approve','approve-02','playerA',held.attemptId),/registration-attempt-changed/);
 assert.equal(f.data.get(f.base).pendingReviewCount,1);
});
test('V1 and V2 untouched by V3 transaction',async()=>{
 for(const version of [1,2]){
  const f=fixture(version),before=structuredClone(f.data);
  await assert.rejects(f.call('playerA','join','join-0001'),/registration-v3-required/);
  assert.deepEqual(f.data,before);
 }
});
