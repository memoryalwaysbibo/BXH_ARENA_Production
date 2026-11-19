'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createPublisher}=require('./publisher.cjs'),{createScoringWithOutbox}=require('./scoring-adapter.cjs'),{fixture}=require('../engine-fixture.cjs');
const clone=x=>x===undefined?undefined:structuredClone(x);
class AtomicStore{
 constructor(){this.rows=new Map;this.crash=null;}
 doc(path){return {path,collection:name=>({doc:id=>this.doc(path+'/'+name+'/'+id)})};}
 async runTransaction(fn){
  const next=new Map([...this.rows].map(([k,v])=>[k,clone(v)]));let writes=false;
  const put=(ref,v,merge)=>{writes=true;if(merge&&!next.has(ref.path))throw Error('missing');next.set(ref.path,merge?{...next.get(ref.path),...clone(v)}:clone(v));};
  const result=await fn({get:async ref=>{if(writes)throw Error('read-after-write');const value=next.get(ref.path);return {exists:value!==undefined,data:()=>clone(value)};},create:(r,v)=>{if(next.has(r.path))throw Error('exists');put(r,v,false);},update:(r,v)=>put(r,v,true),set:(r,v,o)=>put(r,v,!!o?.merge)});
  if(this.crash==='before'){this.crash=null;throw Error('simulated-before-commit');}
  this.rows=next;if(this.crash==='after'){this.crash=null;throw Error('simulated-lost-ack');}return result;
 }
}
function setup(){
 const db=new AtomicStore,f=fixture(),room='BXH-DEMO96',config={mode:'offline-test',projectId:'demo-bxh-arena-e2e',room,epoch:'demo-epoch-1'};
 for(const s of Object.values(f.room.refereeSeatsV1.courts))s.main.name='Synthetic Referee';
 Object.assign(f.room,{data:JSON.stringify(f.state),visibility:'public'});
 db.rows.set('tournaments/'+room,clone(f.room));db.rows.set('publicTournaments/'+room,{bracketView:JSON.stringify(f.projection())});db.rows.set('users/demo-ref',f.user);db.rows.set('systemConfig/refereeSeatsV1',{enabled:true,perCourtScoringVerified:true});
 const p=createPublisher(db,config),score=createScoringWithOutbox(db,p,{clock:()=>3000});let n=0;
 function request(){const saved=JSON.parse(db.rows.get('tournaments/'+room).data),m=saved.matches.find(x=>x.id===f.current()[0].id);return {auth:{uid:'demo-ref'},data:{...f.request('score',m.id,{side:'A',points:1,finish:'spin'}),code:room,operationId:'demo-durable-operation-'+(++n),expectedScoreRevision:m.refereeSeatScoreRevision||0}};}
 return {db,p,score,request,room};
}
test('actual scoring service atomically queues authoritative public event; worker never changes score',async()=>{
 const x=setup();await x.score(x.request());assert.equal(x.db.rows.get('tournaments/'+x.room).stagingPublicationRevision,1);
 const before=clone(x.db.rows.get('tournaments/'+x.room));assert.equal((await x.p.publish(1)).type,'checkpoint');assert.deepEqual(x.db.rows.get('tournaments/'+x.room),before);
 const view=x.db.rows.get('stagingScorePublisher/'+x.room).view;assert(!('refereeSeatsV1' in view.meta));assert.equal(view.matches.find(m=>m.scoreA===1).scoreA,1);
});
test('score transaction crash rolls back both score and outbox; retry then duplicate does not re-score',async()=>{
 const x=setup(),req=x.request(),before=clone(x.db.rows);x.db.crash='before';await assert.rejects(x.score(req),/simulated/);assert.deepEqual(x.db.rows,before);await x.score(req);await x.score(req);assert.equal(x.db.rows.get('tournaments/'+x.room).stagingPublicationRevision,1);
});
test('worker lost ack after commit then process recreation retry is idempotent',async()=>{
 const x=setup();await x.score(x.request());x.db.crash='after';await assert.rejects(x.p.publish(1),/lost-ack/);const before=clone(x.db.rows);const p=createPublisher(x.db,{mode:'offline-test',projectId:'demo-bxh-arena-e2e',room:x.room,epoch:'demo-epoch-1'});assert.equal((await p.publish(1)).duplicate,true);assert.deepEqual(x.db.rows,before);
});
test('worker pre-commit crash leaves event durable and public state absent; retry succeeds',async()=>{const x=setup();await x.score(x.request());x.db.crash='before';await assert.rejects(x.p.publish(1));assert(!x.db.rows.has('stagingScorePublisher/'+x.room));assert.equal((await x.p.publish(1)).revision,1);});
test('gap and out-of-order choose checkpoint; old deliveries cannot regress; consecutive update is delta',async()=>{const x=setup();await x.score(x.request());await x.score(x.request());assert.equal((await x.p.publish(2)).type,'checkpoint');assert.equal((await x.p.publish(1)).duplicate,true);await x.score(x.request());assert.equal((await x.p.publish(3)).type,'delta');});
test('missing event and revoked visibility are fail closed',async()=>{const x=setup();await x.score(x.request());await assert.rejects(x.p.publish(2),/missing/);x.db.rows.get('tournaments/'+x.room).visibility='private';await assert.rejects(x.p.publish(1),/eligible/);});
test('cloud targets and arbitrary rooms rejected even if named staging',()=>{for(const projectId of ['bxh-arena','bxh-arena-staging'])assert.throws(()=>createPublisher(new AtomicStore,{mode:'offline-test',projectId,room:'BXH-DEMO96',epoch:'demo-e'}),/isolated/);});
test('actual handler authorization denial makes no publication',async()=>{const x=setup(),req=x.request();req.auth.uid='unknown';const before=clone(x.db.rows);await assert.rejects(x.score(req),/station-not-assigned/);assert.deepEqual(x.db.rows,before);});
test('score lost commit acknowledgement retry neither increments score nor outbox',async()=>{const x=setup(),req=x.request();x.db.crash='after';await assert.rejects(x.score(req),/lost-ack/);const before=clone(x.db.rows);await x.score(req);assert.deepEqual(x.db.rows,before);});
test('receiver applies emitted checkpoint and delta with exact authoritative parity',async()=>{const x=setup(),B=require('../bridge.cjs'),receiver=B.receiver();for(let i=1;i<=2;i++){await x.score(x.request());await x.p.publish(i);const doc=x.db.rows.get('labRooms/'+x.room+'/deltas/'+String(i).padStart(12,'0'));assert(receiver.apply(JSON.parse(doc.packet)).ok);assert.deepEqual(receiver.snapshot().view,x.db.rows.get('stagingScorePublisher/'+x.room).view);}});
test('epoch mismatch does not overwrite existing published state',async()=>{const x=setup();await x.score(x.request());x.db.rows.set('stagingScorePublisher/'+x.room,{epoch:'demo-previous',revision:1});await assert.rejects(x.p.publish(1),/epoch-reset-required/);assert.equal(x.db.rows.get('stagingScorePublisher/'+x.room).epoch,'demo-previous');});
