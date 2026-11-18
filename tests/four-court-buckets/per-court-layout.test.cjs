'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const B=require('../../referee-seats/functions/bucket-state.cjs'),P=require('../../referee-seats/functions/bucket-migration-plan.cjs');
const {fixture}=require('./trusted-fixture.cjs');
test('production v2 requires an extra server-owned release gate',()=>{
 const {createBucketRuntime}=require('../../referee-seats/functions/bucket-runtime.cjs'),project='bxh-layout-test';
 const gate=createBucketRuntime({projectId:project},{runtime:'production',env:{BXH_BUCKET_RUNTIME_ENABLED:'true',BXH_BUCKET_PROJECT_ID:project,GCLOUD_PROJECT:project}});
 const m={schema:B.perCourtSchema,code:'BXH-LAYOUT6',epoch:'layout-epoch'},config={enabled:true,productionEnabled:true,productionRooms:{'BXH-LAYOUT6':'layout-epoch'}};
 assert.throws(()=>gate.assertRoom(config,m),/bucket-room-not-enabled/);
 assert.doesNotThrow(()=>gate.assertRoom({...config,perCourtStorageEnabled:true},m));
});
for(const count of [1,4,5,12])test(count+' courts keep legacy grouping and isolate v2 court data',()=>{
 const f=fixture('BXH-LAYOUT'+count,count,false),v1=f.room.scoreStorage,v2=B.makeManifest(f.state,'new-layout-epoch',B.perCourtSchema);
 assert.equal(v1.bucketCount,Math.ceil(count/4));assert.equal(v2.bucketCount,count);
 const rows=B.encode(f.state,v2);assert.equal(rows.length,count);
 rows.forEach((row,i)=>{assert.equal(row.schema,B.perCourtSchema);assert.equal(JSON.parse(row.matches).length,1);assert.equal(JSON.parse(row.matches)[0].station,i+1);assert.equal(B.route(i+1,count,v2.schema),'court-'+(i+1));});
 assert.equal(B.context({...f.room,scoreStorage:v2},f.state).schema,B.perCourtSchema);
 assert.deepEqual(B.materialize(f.state,v2,rows),f.state);
 assert.throws(()=>B.materialize(f.state,v2,B.encode(f.state,v1)),/bucket-context|bucket-missing/);
 if(count>1)assert.throws(()=>B.context({...f.room,scoreStorage:{...v1,schema:B.perCourtSchema}},f.state),/bucket-not-ready/);
});
test('migration activation and rollback plans carry the explicit per-court schema',()=>{
 const f=fixture('BXH-LAYOUTM',6,false);delete f.room.scoreStorage;
 const input={action:'activate',code:f.state.cloudCode,epoch:'layout-new-epoch',room:f.room,publicDocument:{bracketView:JSON.stringify(f.state),updatedAt:1},buckets:[],versions:{root:'1:0',public:'1:0',release:'1:0'}};
 const old=P.prepare(input),next=P.prepare({...input,storageSchema:B.perCourtSchema});
 assert.equal(old.plan.version,1);assert.equal(old.plan.buckets,2);assert.equal(next.plan.version,2);assert.equal(next.plan.storageSchema,B.perCourtSchema);assert.equal(next.plan.buckets,6);assert.notEqual(old.plan.sourceDigest,next.plan.sourceDigest);
 const rollback=P.prepare({...input,action:'rollback',room:{...f.room,scoreStorage:next.manifest},buckets:next.encoded.map(data=>({id:data.bucketId,data}))});
 assert.equal(rollback.plan.version,2);assert.equal(rollback.plan.buckets,6);assert.deepEqual(rollback.state.matches,f.state.matches);
});
