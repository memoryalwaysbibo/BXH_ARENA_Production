'use strict';
// Deterministic coordination tests. These do not model Firestore latency or
// pessimistic-lock scheduling; the emulator recovery suite remains required.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createQueue}=require('../backend/queue.cjs');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const code='BXH-TEST';
const leasePath='_registrationQueueV2/'+code;
const jobsPath=leasePath+'/_registrationQueueJobsV2';

function fixture(){
 let now=1000,transactions=0,tail=Promise.resolve(),beforeTransaction=null;
 const rows=new Map(),handlerCalls=[],timings=[];
 const copy=x=>x===undefined?undefined:structuredClone(x);
 const snapshot=ref=>({id:ref.id,ref,exists:rows.has(ref.path),data:()=>copy(rows.get(ref.path))});
 function ref(path){return {path,id:path.split('/').at(-1),
  get:async()=>snapshot(ref(path)),collection:name=>collection(path+'/'+name)};}
 function collection(path,filters=[],order=null,count=Infinity){return {
  doc:id=>ref(path+'/'+id),
  where:(field,op,value)=>collection(path,[...filters,{field,op,value}],order,count),
  orderBy:field=>collection(path,filters,field,count),
  limit:n=>collection(path,filters,order,n),
  get:async()=>{
   let docs=[...rows.keys()].filter(p=>p.startsWith(path+'/')&&!p.slice(path.length+1).includes('/'))
    .map(p=>snapshot(ref(p))).filter(s=>filters.every(f=>f.op==='in'&&f.value.includes(s.data()[f.field])));
   if(order)docs.sort((a,b)=>a.data()[order]-b.data()[order]||a.id.localeCompare(b.id));
   docs=docs.slice(0,count);return {docs,empty:docs.length===0};
  }
 };}
 const db={doc:ref,collection,
  async runTransaction(work){
   const prior=tail,done=deferred();tail=done.promise;await prior;transactions++;
   try{
    if(beforeTransaction){const hook=beforeTransaction;beforeTransaction=null;hook();}
    const writes=[];
    const tx={get:async r=>snapshot(r),getAll:async(...refs)=>refs.map(snapshot),
     set:(r,d,options)=>writes.push([r,d,!!options?.merge]),
     update:(r,d)=>{assert(rows.has(r.path),'update must target an existing document');writes.push([r,d,true]);}};
    const result=await work(tx);
    for(const [r,d,merge]of writes)rows.set(r.path,merge?{...rows.get(r.path),...copy(d)}:copy(d));
    return result;
   }finally{done.resolve();}
  }
 };
 function job(id,at=now){const value={uid:'synthetic-'+id,code,route:'family',operationId:id,
  payload:{action:'join',code,operationId:id},state:'queued',attempts:0,acceptedAt:at};
  rows.set(jobsPath+'/'+id,value);return ref(jobsPath+'/'+id);}
 const handler=store=>async req=>store.runTransaction(async tx=>{
  handlerCalls.push(req.data.operationId);
  tx.set(store.doc('results/'+req.data.operationId),{written:true});
  return {ok:true,status:'confirmed'};
 });
 function service(options={}){return createQueue(db,{
  handlers:{family:handler,roster:handler},FieldValue:{serverTimestamp:()=>now},
  clock:()=>now,onTiming:x=>timings.push(x),...options});}
 return {db,rows,job,service,handlerCalls,timings,get transactions(){return transactions;},
  advance:n=>{now+=n;},beforeNextTransaction:hook=>{beforeTransaction=hook;}};
}

test('busy cross-process lease avoids an acquisition transaction',async()=>{
 const f=fixture();f.rows.set(leasePath,{owner:'other',token:'foreign',until:2000});
 assert.deepEqual(await f.service().drain(code),{busy:true,processed:0});
 assert.equal(f.transactions,0);
 assert.equal(f.rows.get(leasePath).token,'foreign');
});

test('fast-path read never grants ownership and acquisition rechecks a racing lease',async()=>{
 const f=fixture();f.beforeNextTransaction(()=>f.rows.set(leasePath,{owner:'other',token:'new',until:2000}));
 assert.deepEqual(await f.service().drain(code),{busy:true,processed:0});
 assert.equal(f.transactions,1);assert.equal(f.rows.get(leasePath).token,'new');
});

test('twenty same-process event deliveries share one active batch and write once',async()=>{
 const f=fixture(),entered=deferred(),resume=deferred();f.job('one');
 const worker=f.service({beforeExecute:async()=>{entered.resolve();await resume.promise;}});
 const first=worker.drainCreatedJob(code,'one');await entered.promise;
 const calls=Array.from({length:19},()=>worker.drainCreatedJob(code,'one'));
 await new Promise(resolve=>setImmediate(resolve));resume.resolve();
 await Promise.all([first,...calls]);
 assert.deepEqual(f.handlerCalls,['one']);
 assert.equal(f.rows.get(jobsPath+'/one').attempts,1);
 assert.equal(f.timings.filter(x=>x.phase==='lease-acquire').length,1);
 assert.equal(f.timings.filter(x=>x.phase==='local-drain-wait').length,19);
});

test('another process retains retryable delivery until the active job commits',async()=>{
 const f=fixture(),entered=deferred(),resume=deferred();f.job('one');
 const active=f.service({beforeExecute:async()=>{entered.resolve();await resume.promise;}});
 const delivery=active.drainCreatedJob(code,'one');await entered.promise;
 const before=f.transactions,other=f.service();
 await assert.rejects(other.drainCreatedJob(code,'one'),/queue-delivery-pending/);
 assert.equal(f.transactions,before);
 resume.resolve();await delivery;await other.drainCreatedJob(code,'one');
 assert.deepEqual(f.handlerCalls,['one']);
});

test('arrival after the shared snapshot remains retryable and is later written once',async()=>{
 const f=fixture(),entered=deferred(),resume=deferred();f.job('one');
 const worker=f.service({beforeExecute:async()=>{entered.resolve();await resume.promise;}});
 const first=worker.drainCreatedJob(code,'one');await entered.promise;f.job('two',1001);
 const second=assert.rejects(worker.drainCreatedJob(code,'two'),/queue-delivery-pending/);
 await new Promise(resolve=>setImmediate(resolve));resume.resolve();await Promise.all([first,second]);
 assert.equal(f.rows.get(jobsPath+'/two').state,'queued');
 await worker.drainCreatedJob(code,'two');await worker.drainCreatedJob(code,'two');
 assert.deepEqual(f.handlerCalls,['one','two']);
 assert.equal(f.rows.get(jobsPath+'/two').attempts,1);
});

test('first active batch limit still bounds work and pending trigger is not acknowledged',async()=>{
 const f=fixture();f.job('one');f.job('two',1001);const worker=f.service();
 await assert.rejects(worker.drainCreatedJob(code,'two',{limit:1}),/queue-delivery-pending/);
 assert.deepEqual(f.handlerCalls,['one']);
 await worker.drainCreatedJob(code,'two',{limit:1});assert.deepEqual(f.handlerCalls,['one','two']);
});

test('lease expiry still fences the old worker after another process takes over',async()=>{
 const f=fixture(),entered=deferred(),resume=deferred();f.job('one');
 const old=f.service({leaseMs:100,beforeExecute:async()=>{entered.resolve();await resume.promise;}});
 const delivery=old.drain(code);await entered.promise;f.advance(101);
 await f.service().drain(code);resume.resolve();await delivery;
 assert.deepEqual(f.handlerCalls,['one']);
 assert.equal(f.rows.get(jobsPath+'/one').state,'completed');
});

test('a failed drain clears local sharing so event retry can acquire again',async()=>{
 const f=fixture();f.job('one');let first=true;
 const worker=f.service({onTiming:()=>{throw Error('logger-down');},
  beforeExecute:async()=>{if(first){first=false;throw Error('transient-handler-failure');}}});
 await assert.rejects(worker.drainCreatedJob(code,'one'),/queue-delivery-pending/);
 assert.equal(f.rows.get(jobsPath+'/one').state,'queued');f.advance(1001);
 await worker.drainCreatedJob(code,'one');
 assert.equal(f.rows.get(jobsPath+'/one').state,'completed');assert.deepEqual(f.handlerCalls,['one']);
});
