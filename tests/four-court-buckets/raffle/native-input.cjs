'use strict';
const assert=require('node:assert/strict');
const project='demo-bxh-bucket-raffle';
assert.equal(process.env.GCLOUD_PROJECT,project,'isolated demo project required');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8198','loopback emulator required');
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {fixture,code}=require('../completion/fixture.cjs');
const core=require('../operations/fixtures/5/operations-core.js');
const {createRaffleInput}=require('../../../release/buckets/raffle/input.cjs');
const {participantKey}=require('../../../release/buckets/raffle/identity.cjs');
const {createRafflePreview}=require('../../../release/buckets/raffle/preview.cjs');
class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
const app=initializeApp({projectId:project}),db=getFirestore(app),read=createRaffleInput(core);
const rootPath='tournaments/'+code,pubPath='publicTournaments/'+code;
let checks=0;
async function seed(f){
 // Flush only this guarded demo emulator; seed roots and buckets in one batch.
 const response=await fetch('http://127.0.0.1:8198/emulator/v1/projects/'+project+'/databases/(default)/documents',{method:'DELETE'});
 assert.equal(response.status,200);
 const batch=db.batch();for(const [path,data] of f.m.rows)batch.set(db.doc(path),data);await batch.commit();
}
async function contents(){
 const paths=[rootPath,pubPath,...Array.from({length:8},(_,i)=>rootPath+'/matchBuckets/court-'+(i+1))];
 return JSON.stringify((await db.getAll(...paths.map(p=>db.doc(p)))).map(s=>[s.ref.path,s.exists,s.data(),s.createTime]));
}
async function invoke({mode='first_round',excluded=[],observed={},identityVersion='legacy'}={},afterRead){
 let attempts=0;
 const selectedRead=identityVersion==='legacy'?read:createRaffleInput(core,{identityVersion});
 const value=await db.runTransaction(async tx=>{
  attempts++;
  const [root,pub]=await tx.getAll(db.doc(rootPath),db.doc(pubPath));
  const result=await selectedRead({db,tx,root,pub,code,mode,excluded,observed});
  if(afterRead)await afterRead(attempts);
  return result;
 });
 return {value,attempts};
}
async function unchanged(fn){const before=await contents();await fn();assert.equal(await contents(),before);checks++;}
(async()=>{try{
 for(const courts of [4,6,12]){
  const f=fixture({courts}),top=f.m.rows.get(rootPath),stale=JSON.parse(top.data);
  for(const m of stale.matches.filter(m=>m.bracket==='SE'&&m.round===0))[m.winnerId,m.loserId]=[m.loserId,m.winnerId];
  f.m.put(rootPath,{...top,data:JSON.stringify(stale)});await seed(f);
  assert.deepEqual(core.candidates(stale,'first_round').map(p=>p.playerId),['p1','p3']);
  await unchanged(async()=>{const {value}=await invoke();assert.deepEqual(value.pool.map(p=>p.playerId),['p2','p4']);assert.equal(value.candidateHash,core.poolHash(core.candidates(f.state,'first_round')));});
 }
 for(const mode of ['general','first_round']){
  const f=fixture({bucket:false});await seed(f);
  await unchanged(async()=>assert.deepEqual((await invoke({mode})).value,{pool:core.candidates(f.state,mode),candidateHash:core.poolHash(core.candidates(f.state,mode))}));
 }
 await seed(fixture());await unchanged(async()=>{const {value}=await invoke({mode:'general',excluded:['uid:u2']});assert.equal(value.pool.length,3);assert(!value.pool.some(x=>x.key==='uid:u2'));});
 for(const bucket of [false,true]){
  const f=fixture({bucket}),top=f.m.rows.get(rootPath),state=JSON.parse(top.data);
  state.players[1].registrationUid=state.players[0].registrationUid;state.players[1].name=state.players[0].name;
  f.m.put(rootPath,{...top,data:JSON.stringify(state)});await seed(f);
  const identityVersion='participant-v1',observed={},excluded=[participantKey(state.players[0])];
  await unchanged(async()=>{const {value}=await invoke({mode:'general',identityVersion,observed});assert.equal(value.pool.length,4);assert.equal(new Set(value.pool.map(x=>x.key)).size,4);assert.equal(value.candidateHash,core.poolHash(value.pool));});
  state.players[0].name='Renamed demo player';await db.doc(rootPath).update({data:JSON.stringify(state)});
  await unchanged(async()=>{const {value}=await invoke({mode:'general',identityVersion,observed,excluded});assert.equal(value.pool.length,3);assert(!value.pool.some(x=>x.playerId==='p1'));assert(value.pool.some(x=>x.playerId==='p2'));});
  await unchanged(()=>assert.rejects(invoke({mode:'general',identityVersion,excluded:['uid:u1']}),/raffle-exclusion-identity-version/));
 }
 for(const bucket of [false,true]){
  const f=fixture({bucket}),top=f.m.rows.get(rootPath),s=JSON.parse(top.data);
  s.players[1].registrationUid=s.players[0].registrationUid;s.players[1].name=s.players[0].name;
  f.m.put(rootPath,{...top,data:JSON.stringify(s)});await seed(f);
  const preview=createRafflePreview({db,core,HttpsError}),request={auth:{uid:'admin'},data:{code:code.toLowerCase(),mode:'general'}};
  await unchanged(async()=>{const value=await preview(request);assert.equal(value.count,4);assert.equal(value.candidateHash,core.poolHash(value.candidates));});
  await db.doc(rootPath+'/raffleControl/current').set({winnerKeys:['uid:u1']});
  await unchanged(async()=>assert.equal((await preview(request)).count,2));
  const born=(await db.doc(rootPath).get()).createTime,publicBorn=(await db.doc(pubPath).get()).createTime;
  await db.doc(rootPath+'/raffleControl/current').set({identityVersion:'participant-v1',sourceCreatedAt:born.seconds+':'+born.nanoseconds,sourcePublicCreatedAt:publicBorn.seconds+':'+publicBorn.nanoseconds,sourceBucketEpoch:f.top.scoreStorage?.epoch||null,winnerKeys:[participantKey(s.players[0])]});
  await unchanged(async()=>{const value=await preview(request);assert.equal(value.count,3);assert(value.candidates.some(x=>x.playerId==='p2'));assert(!value.candidates.some(x=>x.playerId==='p1'));});
 }
 // Synthetic ABORTED retry on the real SDK: role removal occurs before callback
 // two, outside the first callback's released read locks. Auth payload is a fixture.
 {await seed(fixture());let callbacks=0;const bound={doc:db.doc.bind(db),runTransaction:cb=>db.runTransaction(async tx=>{
   callbacks++;if(callbacks===2)await db.doc('users/admin').update({role:'player'});
   const result=await cb(tx);if(callbacks===1)throw Object.assign(Error('test-only-aborted'),{code:10});return result;
  })};
  const preview=createRafflePreview({db:bound,core,HttpsError});
  await assert.rejects(preview({auth:{uid:'admin'},data:{code,mode:'general'}}),e=>e.code==='permission-denied');assert.equal(callbacks,2);checks++;
 }
 for(const change of [
  f=>f.m.remove(rootPath+'/matchBuckets/court-2'),
  f=>f.m.put(rootPath+'/matchBuckets/court-1',{...f.buckets[0],epoch:'wrong'}),
  f=>f.m.put(rootPath+'/matchBuckets/court-1',{...f.buckets[0],matches:'{bad'}),
  f=>f.m.put(pubPath,{...f.pub,scoreBucketProjection:{epoch:'epoch-1',versions:{'court-1':8,'court-2':0}}}),
  f=>f.m.put(pubPath,{...f.pub,scoreStorage:null}),
  f=>f.m.put(rootPath,{...f.top,scoreBucketProjection:null}),
  f=>f.m.put(rootPath,{...f.top,archiveStatus:'completed'}),
 ]){const f=fixture();change(f);await seed(f);await unchanged(()=>assert.rejects(invoke()));}
 for(const side of [rootPath,pubPath])for(const field of ['bucketMigration','deletionStatus'])for(const value of [null,false]){
  const f=fixture();f.m.put(side,{...f.m.rows.get(side),[field]:value});await seed(f);await unchanged(()=>assert.rejects(invoke()));
 }
 for(const side of [rootPath,pubPath]){
  const f=fixture();await seed(f);const observed={};await invoke({observed});
  const ref=db.doc(side),before=await ref.get();await ref.delete();await ref.set(before.data());
  assert(!before.createTime.isEqual((await ref.get()).createTime));
  await unchanged(()=>assert.rejects(invoke({observed})));
 }
 {const f=fixture();await seed(f);const observed={};await invoke({observed});
  const batch=db.batch();batch.update(db.doc(rootPath),{'scoreStorage.epoch':'epoch-2'});batch.update(db.doc(pubPath),{'scoreBucketProjection.epoch':'epoch-2'});
  for(const b of f.buckets)batch.update(db.doc(rootPath+'/matchBuckets/'+b.bucketId),{epoch:'epoch-2'});await batch.commit();
  await unchanged(()=>assert.rejects(invoke({observed}),/raffle-room-changed/));
 }
 {await seed(fixture());const observed={},first=(await invoke({observed})).value;await db.doc(rootPath+'/matchBuckets/court-1').update({revision:8});await unchanged(async()=>assert.deepEqual((await invoke({observed})).value,first));}
 // Deterministic SDK ABORTED injection verifies callback retry context. This is
 // not a natural-contention or callable acceptance test. Interference happens
 // only at the next callback, after the previous transaction released locks.
 {await seed(fixture());const observed={};let callbacks=0;
  await assert.rejects(db.runTransaction(async tx=>{
   callbacks++;
   if(callbacks===2){const ref=db.doc(pubPath),s=await ref.get();await ref.delete();await ref.set(s.data());}
   const [root,pub]=await tx.getAll(db.doc(rootPath),db.doc(pubPath));
   const value=await read({db,tx,root,pub,code,mode:'first_round',observed});
   if(callbacks===1)throw Object.assign(Error('test-only-aborted'),{code:10});
   return value;
  }),/raffle-room-changed/);assert.equal(callbacks,2);checks++;
 }
 console.log(JSON.stringify({nativeRaffleInputChecks:checks,project,productionRequests:0,productionWrites:0,callableWired:false,scope:'SDK snapshots and deterministic retry; no Auth/App Check/Eventarc acceptance'}));
 }finally{await db.terminate();await deleteApp(app);}
})().catch(e=>{console.error(e);process.exitCode=1;});
