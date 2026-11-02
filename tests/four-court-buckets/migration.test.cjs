'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const P=require('../../referee-seats/functions/bucket-migration-plan.cjs'),B=require('../../referee-seats/functions/bucket-state.cjs'),{createBucketMigrationService,checkRuntime}=require('../../referee-seats/functions/bucket-migration-service.cjs'),{fixture}=require('./trusted-fixture.cjs');
function input(action='activate'){
 const f=fixture('BXH-PLAN6',6,false),epoch='migration-epoch-1';delete f.room.scoreStorage;
 return {action,code:f.state.cloudCode,epoch,room:f.room,publicDocument:{bracketView:JSON.stringify(f.state),updatedAt:1},buckets:[],versions:{root:'1:0',public:'1:0',release:'1:0'}};
}
test('activation plans are deterministic, contain no player data, and detect any source change',()=>{
 const x=input(),a=P.prepare(x).plan;assert.equal(a.buckets,2);assert.equal(a.courts,6);assert.equal(a.players,undefined);assert.equal(a.data,undefined);
 assert.equal(P.prepare({...x,room:Object.fromEntries(Object.entries(x.room).reverse())}).plan.sourceDigest,a.sourceDigest);
 assert.notEqual(P.prepare({...x,versions:{...x.versions,root:'2:0'}}).plan.sourceDigest,a.sourceDigest);
 assert.notEqual(P.prepare({...x,room:{...x.room,updatedAt:2}}).plan.sourceDigest,a.sourceDigest);
 assert.throws(()=>P.prepare({...x,room:{...x.room,updatedAt:'unverified'}}),/invalid-migration-version/);
});
test('activation refuses unrelated orphan buckets, unsupported modes and duplicate match ids',()=>{
 const x=input();assert.throws(()=>P.prepare({...x,buckets:[{id:'court-99',data:{orphan:true}}]}),/orphan-bucket-set/);
 assert.throws(()=>P.prepare({...x,room:{...x.room,createdByRole:'partner_organizer'}}),/unsupported-migration-room/);
 const state=JSON.parse(x.room.data);state.meta.formatType='double';assert.throws(()=>P.prepare({...x,room:{...x.room,data:JSON.stringify(state)}}),/unsupported-migration-room/);
 state.meta.formatType='single';state.matches[1].id=state.matches[0].id;assert.throws(()=>P.prepare({...x,room:{...x.room,data:JSON.stringify(state)}}),/invalid-match-identity/);
 assert.throws(()=>P.prepare({...x,room:{...x.room,scoreStorage:null}}),/already-bucketed/);
});
test('rollback planning materializes complete bucket scores and ledger instead of stale root JSON',()=>{
 const x=input('rollback'),state=JSON.parse(x.room.data),m=B.makeManifest(state,x.epoch);x.room.scoreStorage=m;
 const buckets=B.encode(state,m),rows=JSON.parse(buckets[0].matches);rows[0].scoreA=3;rows[0].log=[{points:3}];rows[0].refereeSeatScoreRevision=1;buckets[0]={...buckets[0],revision:1,matches:JSON.stringify(rows)};
 x.buckets=buckets.map(data=>({id:data.bucketId,data,updateTime:'2:0'}));const prepared=P.prepare(x);assert.equal(prepared.state.matches[0].scoreA,3);assert.equal(prepared.state.matches[0].log.length,1);assert.equal(JSON.parse(x.room.data).matches[0].scoreA,0);
 assert.throws(()=>P.prepare({...x,buckets:x.buckets.slice(0,1)}),/bucket-missing/);
 assert.throws(()=>P.prepare({...x,buckets:[...x.buckets,{id:'court-99',data:{}}]}),/bucket-context/);
 assert.throws(()=>P.prepare({...x,epoch:'wrong'}),/epoch-mismatch/);
});
test('migration uses a separate closed runtime gate, allowing emergency rollback with scoring runtime off',()=>{
 const db={projectId:'bxh-migration-test'},env={BXH_BUCKET_MIGRATION_ENABLED:'true',BXH_BUCKET_PROJECT_ID:db.projectId,GCLOUD_PROJECT:db.projectId};
 assert.doesNotThrow(()=>checkRuntime(db,{runtime:'production',env}));assert.throws(()=>checkRuntime(db,{runtime:'production',env:{}}),/migration-runtime-disabled/);
 assert.throws(()=>checkRuntime(db,{runtime:'production',env:{...env,FIRESTORE_EMULATOR_HOST:'127.0.0.1:8188'}}),/bucket-runtime-mismatch/);
 assert.throws(()=>checkRuntime(db,{runtime:'production',env:{...env,GCLOUD_PROJECT:'another'}}),/bucket-project-mismatch/);
 assert.throws(()=>checkRuntime(db,{runtime:'emulator',env}),/emulator-only/);assert.throws(()=>P.budget([{large:'x'.repeat(750001)}]),/migration-size-budget/);
});
test('preflight performs no writes and a stale plan or non-super-admin commits nothing',async()=>{
 const x=input(),time={seconds:1,nanoseconds:0};let writes=0,role='super_admin';const ref=path=>({path,collection:name=>({doc:id=>ref(path+'/'+name+'/'+id),limit:()=>({query:true})})});
 const snap=data=>({exists:data!==undefined,data:()=>data,updateTime:time});
 const db={projectId:'demo-bxh-four-court-buckets',doc:ref,runTransaction:run=>run({getAll:async(...refs)=>refs.map(r=>snap(r.path==='tournaments/'+x.code?x.room:r.path==='publicTournaments/'+x.code?x.publicDocument:r.path==='systemConfig/fourCourtScoreBuckets'?{enabled:true,migrationEnabled:true}:r.path==='users/operator'?{active:true,role}:undefined)),get:async r=>r.query?({docs:[]}):snap(r.path==='publicTournaments/'+x.code?x.publicDocument:undefined),create:()=>{writes++;},update:()=>{writes++;},delete:()=>{writes++;}})};
 const service=createBucketMigrationService(db,{env:{FIRESTORE_EMULATOR_HOST:'127.0.0.1:8188'}}),request={action:'activate',code:x.code,epoch:x.epoch,actorUid:'operator'};
 const plan=await service.preflight(request);assert(plan.sourceDigest);assert.equal(writes,0);
 await assert.rejects(service.commit({...request,operationId:'migration-operation-0001',sourceDigest:'0'.repeat(64)}),/migration-plan-stale/);assert.equal(writes,0);
 role='admin';await assert.rejects(service.preflight(request),/migration-operator-required/);assert.equal(writes,0);
});
test('production activation preflight additionally requires scoring, private reads, projection and exact migration epoch gates',async()=>{
 const x=input(),time={seconds:1,nanoseconds:0},env={BXH_BUCKET_MIGRATION_ENABLED:'true',BXH_BUCKET_RUNTIME_ENABLED:'true',BXH_BUCKET_PROJECT_ID:'bxh-migration-test',GCLOUD_PROJECT:'bxh-migration-test'};
 const allowed={enabled:true,migrationEnabled:true,productionEnabled:true,privateReadsEnabled:true,automaticPublicProjectionEnabled:true,productionRooms:{[x.code]:x.epoch},migrationRooms:{[x.code]:x.epoch}};let config=allowed;
 const ref=path=>({path,collection:name=>({doc:id=>ref(path+'/'+name+'/'+id),limit:()=>({query:true})})}),snap=data=>({exists:data!==undefined,data:()=>data,updateTime:time});
 const db={projectId:env.GCLOUD_PROJECT,doc:ref,runTransaction:run=>run({getAll:async(...refs)=>refs.map(r=>snap(r.path==='tournaments/'+x.code?x.room:r.path==='publicTournaments/'+x.code?x.publicDocument:r.path==='systemConfig/fourCourtScoreBuckets'?config:{active:true,role:'super_admin'})),get:async r=>r.query?{docs:[]}:snap(r.path==='publicTournaments/'+x.code?x.publicDocument:undefined)})};
 const service=createBucketMigrationService(db,{runtime:'production',env}),request={action:'activate',code:x.code,epoch:x.epoch,actorUid:'operator'};assert((await service.preflight(request)).sourceDigest);
 for(const patch of [{enabled:false},{migrationEnabled:false},{productionEnabled:false},{productionRooms:{}},{migrationRooms:{}},{migrationRooms:{[x.code]:'old-epoch'}},{privateReadsEnabled:false},{automaticPublicProjectionEnabled:false}]){config={...allowed,...patch};await assert.rejects(service.preflight(request),/migration-release-not-ready|bucket-room-not-enabled|migration-room-not-enabled/);}
});
