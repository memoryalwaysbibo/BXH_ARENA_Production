'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createSummarySync}=require('./summary-sync.cjs');
const {applyHold,summary}=require('./hold-core.cjs');
function fixture(version=3){
 const code='BXH-ABC123',room='tournaments/'+code,pub='publicTournaments/'+code,ledger=room+'/registrationV3State/ledger';
 const initial={capacity:192,occupiedCount:0,pendingReviewCount:0,confirmedCount:0,sequence:0,revision:0};
 const data=new Map([[room,{registrationFlowVersion:version,...summary(initial),data:'unchanged'}],[pub,{registrationFlowVersion:version,...summary(initial),bracketView:'unchanged'}],[ledger,initial]]);
 const ref=path=>({path,collection:n=>ref(path+'/'+n),doc:n=>ref(path+'/'+n)});
 let fail=false;
 const db={doc:ref,async runTransaction(fn){
  const draft=structuredClone(data);
  const result=await fn({getAll:async(...refs)=>refs.map(r=>({exists:draft.has(r.path),data:()=>draft.get(r.path)})),update:(r,v)=>draft.set(r.path,{...draft.get(r.path),...v})});
  if(fail)throw Error('simulated-commit-failure');
  for(const [k,v] of draft)data.set(k,v);return result;
 }};
 const metrics=[],sync=createSummarySync({db,observe:m=>metrics.push(m)});
 return {data,room,pub,ledger,metrics,sync:()=>sync(code),fail:v=>{fail=v;}};
}
test('one publication coalesces 192 revisions; repeated delivery is a no-op',async()=>{
 const f=fixture();let l=f.data.get(f.ledger);
 for(let i=0;i<192;i++)l=applyHold(l,null,{action:'join',uid:'p'+i,operationId:'join-'+i,now:i}).ledger;
 f.data.set(f.ledger,l);
 assert.equal((await f.sync()).revision,192);
 for(const path of [f.room,f.pub]){
  assert.equal(f.data.get(path).pendingReviewCount,192);
  assert.equal(f.data.get(path).availableCount,0);
  assert.equal(f.data.get(path).registrationSummaryRevision,192);
 }
 assert.equal(f.metrics[0].reads,3);assert.equal(f.metrics[0].committedWrites,2);
 assert.equal((await f.sync()).changed,false);assert.equal(f.metrics[1].committedWrites,0);
 assert.equal(f.data.get(f.room).data,'unchanged');assert.equal(f.data.get(f.pub).bracketView,'unchanged');
});
test('failed publication preserves ledger; retry publishes latest data',async()=>{
 const f=fixture(),x=applyHold(f.data.get(f.ledger),null,{action:'join',uid:'p',operationId:'join-01',now:1});
 f.data.set(f.ledger,x.ledger);f.fail(true);
 await assert.rejects(f.sync(),/simulated-commit-failure/);
 assert.equal(f.data.get(f.ledger).occupiedCount,1);
 assert.equal(f.data.get(f.pub).occupiedCount,0);
 f.fail(false);await f.sync();assert.equal(f.data.get(f.pub).occupiedCount,1);
});
test('V1/V2 ignored without writes and future revisions rejected',async()=>{
 for(const v of [1,2]){const f=fixture(v),before=structuredClone(f.data);await assert.rejects(f.sync(),/registration-v3-required/);assert.deepEqual(f.data,before);}
 const f=fixture();f.data.get(f.pub).registrationSummaryRevision=99;
 await assert.rejects(f.sync(),/registration-state-conflict/);
});

test('formal revisions project approved roster only when needed',async()=>{
 const code='BXH-ABC123',room='tournaments/'+code,pub='publicTournaments/'+code,ledger=room+'/registrationV3State/ledger';
 const state=JSON.stringify({meta:{checkinRequired:true},players:[],matches:[]});
 const held=applyHold({capacity:2,occupiedCount:0,pendingReviewCount:0,confirmedCount:0,sequence:0,revision:0},null,{action:'join',uid:'p',operationId:'join-01',now:1});
 const approved=applyHold(held.ledger,held.hold,{action:'approve',expectedAttemptId:held.hold.attemptId,now:2});
 const data=new Map([[room,{registrationFlowVersion:3,capacity:2,data:state}],[pub,{registrationFlowVersion:3,capacity:2,bracketView:state}],[ledger,approved.ledger]]);
 const ref=path=>({path,collection:n=>ref(path+'/'+n),doc:n=>ref(path+'/'+n),where(){return this;}});
 let queries=0;
 const db={doc:ref,runTransaction:fn=>fn({getAll:async(...refs)=>refs.map(r=>({exists:data.has(r.path),data:()=>data.get(r.path)})),
  get:async()=>{queries++;return {size:1,docs:[{id:'p',data:()=>({uid:'p',displayName:'Player',status:'confirmed'})}]};},
  update:(r,v)=>data.set(r.path,{...data.get(r.path),...v})})};
 const sync=createSummarySync({db});
 await sync(code);
 assert.equal(JSON.parse(data.get(pub).bracketView).players.length,1);
 assert.equal(data.get(pub).registrationFormalRevision,1);
 await sync(code);assert.equal(queries,1);
 const second=applyHold(approved.ledger,null,{action:'join',uid:'q',operationId:'join-02',now:3});
 data.set(ledger,second.ledger);await sync(code);assert.equal(queries,1);
 assert.equal(data.get(pub).pendingReviewCount,1);
});
