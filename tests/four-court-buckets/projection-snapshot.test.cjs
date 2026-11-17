'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./trusted-fixture.cjs'),B=require('../../referee-seats/functions/bucket-state.cjs');
const {createBucketPublicProjection}=require('../../referee-seats/functions/bucket-public-projection.cjs');
function setup(between=()=>{}){
 const f=fixture('BXH-PUBSNAP6',6,false),root='tournaments/'+f.state.cloudCode,pub='publicTournaments/'+f.state.cloudCode;
 const docs=new Map([[root,f.room],[pub,{bracketView:JSON.stringify(f.state),updatedAt:1}],['systemConfig/fourCourtScoreBuckets',{enabled:true,automaticPublicProjectionEnabled:true}]]),versions=new Map(),transactions=[],writes=[];
 for(const b of B.encode(f.state,f.room.scoreStorage))docs.set(root+'/matchBuckets/'+b.bucketId,b);
 const stamp=n=>({isEqual:other=>other?.value===n,value:n});
 const ref=path=>({path,collection:name=>({doc:id=>ref(path+'/'+name+'/'+id)})});
 const put=(p,value)=>{docs.set(p,structuredClone(value));versions.set(p,(versions.get(p)||0)+1);};
 const db={projectId:'demo-bxh-four-court-buckets',doc:ref,async runTransaction(fn,options){
  const readOnly=options?.readOnly===true,record={readOnly,reads:[]};transactions.push(record);
  const get=async r=>{record.reads.push(r.path);const data=structuredClone(docs.get(r.path));return {exists:docs.has(r.path),data:()=>data,updateTime:stamp(versions.get(r.path)||0)};};
  const result=await fn({get,getAll:(...refs)=>Promise.all(refs.map(get)),update(r,fields){assert(!readOnly);writes.push(r.path);put(r.path,{...docs.get(r.path),...fields});}});
  if(readOnly)between({docs,put,root,pub,f});return result;
 }};
 const old=process.env.FIRESTORE_EMULATOR_HOST;process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8188';let publish;
 try{publish=createBucketPublicProjection(db,{clock:()=>1000});}finally{if(old===undefined)delete process.env.FIRESTORE_EMULATOR_HOST;else process.env.FIRESTORE_EMULATOR_HOST=old;}
 return {docs,put,root,pub,f,transactions,writes,publish:()=>publish(f.state.cloudCode,{automatic:true})};
}
test('projection reads buckets only in a read-only snapshot and writes only public output',async()=>{
 const h=setup();assert((await h.publish()).ok);assert.equal(h.transactions.length,2);
 assert(h.transactions[0].readOnly);assert(h.transactions[0].reads.some(p=>p.includes('/matchBuckets/')));
 assert(!h.transactions[1].readOnly);assert(!h.transactions[1].reads.some(p=>p.includes('/matchBuckets/')));
 assert.deepEqual(h.writes,[h.pub]);assert.equal(JSON.parse(h.docs.get(h.pub).bracketView).updatedAt,1000);
 const before=h.writes.length;assert((await h.publish()).skipped);assert.equal(h.writes.length,before);
});
test('structural changes after the snapshot reject publication, including PASS and rollback',async()=>{
 const h=setup(({docs,put,root})=>put(root,{...docs.get(root),updatedAt:2}));
 await assert.rejects(h.publish(),/projection-source-changed/);assert.equal(h.writes.length,0);
});
test('late and incomparable bucket vectors never overwrite a newer public score',async()=>{
 for(const versions of [{'court-1':1,'court-2':0},{'court-1':1,'court-2':2}]){
  const h=setup(({docs,put,pub,f})=>put(pub,{...docs.get(pub),scoreBucketProjection:{epoch:f.room.scoreStorage.epoch,versions},bracketView:'preserve-newer-public'}));
  const result=await h.publish();assert.equal(result.reason,'newer-projection');assert.equal(h.writes.length,0);
  assert.equal(h.docs.get(h.pub).bracketView,'preserve-newer-public');
 }
});
test('rollout revocation, publication shutdown and unrelated public writes are rechecked before writing',async()=>{
 const disabled=setup(({docs,put})=>put('systemConfig/fourCourtScoreBuckets',{enabled:false}));
 await assert.rejects(disabled.publish(),/release-not-ready/);assert.equal(disabled.writes.length,0);
 const stopped=setup(({docs,put})=>put('systemConfig/fourCourtScoreBuckets',{enabled:true,automaticPublicProjectionEnabled:false}));
 assert.equal((await stopped.publish()).reason,'automatic-projection-disabled');assert.equal(stopped.writes.length,0);
 const changed=setup(({docs,put,pub})=>put(pub,{...docs.get(pub),otherField:'new'}));
 await assert.rejects(changed.publish(),/projection-source-changed/);assert.equal(changed.writes.length,0);
});
test('bucket integrity and missing snapshots fail before entering the write transaction',async()=>{
 const h=setup();h.docs.delete(h.root+'/matchBuckets/court-2');
 await assert.rejects(h.publish(),/bucket-context/);assert.equal(h.transactions.length,1);assert.equal(h.writes.length,0);
});
