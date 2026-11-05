'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const project='demo-bxh-bucket-operations';
assert.equal(process.env.GCLOUD_PROJECT,project);
assert(/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''));
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
require('firebase-functions/v2/https');require('firebase-functions/v2/firestore');require('firebase-functions/v2/scheduler');
const {specs,actions,fixture,bucket,code,uid}=require('./probe.cjs');
const app=initializeApp({projectId:project}),db=getFirestore(app);
db.settings({host:process.env.FIRESTORE_EMULATOR_HOST,ssl:false});
// Only the existing callable guard sees this synthetic environment. Every SDK
// request stays on the explicit demo app and loopback Emulator host above.
process.env.GCLOUD_PROJECT='bxh-arena';
const started=Date.now(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'bucket-operations-native-')),handlers=new Map();
const cols=['tournaments','publicTournaments','users','eventStaffAssignments','userMail','mailboxStats','tournamentActivity'];
function handler(spec,candidate){const key=spec.function+candidate;if(handlers.has(key))return handlers.get(key);
 const dest=path.join(temp,key);fs.mkdirSync(dest,{recursive:true});fs.cpSync(path.join(__dirname,'fixtures',String(spec.sourceSet)),dest,{recursive:true});
 if(candidate)fs.copyFileSync(path.resolve(__dirname,'../../../release/buckets/operations/candidate',String(spec.sourceSet),spec.path),path.join(dest,spec.path));
 // Deterministic business RNG, captured only while the actual source loads.
 // SDK/gRPC clocks and transports are untouched.
 const crypto=require('node:crypto'),int=crypto.randomInt,uuid=crypto.randomUUID;let mod;
 try{crypto.randomInt=min=>min;crypto.randomUUID=()=> 'synthetic-operation-id';mod=require(path.join(dest,spec.path));}finally{crypto.randomInt=int;crypto.randomUUID=uuid;}
 const fn=mod[spec.function].run;assert.equal(typeof fn,'function',spec.function+' native handler missing');handlers.set(key,fn);return fn;
}
async function clear(){for(const name of cols)await db.recursiveDelete(db.collection(name));}
async function seed(f){await clear();const b=db.batch();for(const [p,v]of f.m.rows)b.set(db.doc(p),v);await b.commit();}
const tracker=s=>s.function.startsWith('track');
async function input(spec,action,f){
 if(!tracker(spec))return f.request;
 if(spec.function==='trackTournamentActivity')return {params:{code},data:{before:await db.doc('missing/root').get(),after:await db.doc('tournaments/'+code).get()}};
 const ref=db.doc('tournaments/'+code+'/registrations/target');
 if(action==='delete'){await ref.set({uid:'target',status:'confirmed'});const before=await ref.get();await ref.delete();return {params:{code,uid:'target'},data:{before,after:await ref.get()},time:new Date().toISOString()};}
 return {params:{code,uid:'target'},data:{before:await db.doc('missing/registration').get(),after:await ref.get()}};
}
function normalize(v,key=''){
 if(v&&typeof v.toMillis==='function')return '<server-timestamp>';
 if(typeof v==='number'&&['updatedAt','invitedAt','respondedAt','revokedAt','handledAt','createdAt','at','lastAt'].includes(key)&&v>=started-10000&&v<=Date.now()+10000)return '<wallclock>';
 if(typeof v==='string'&&/^[\[{]/.test(v)){try{return normalize(JSON.parse(v));}catch{}}
 if(Array.isArray(v))return v.map(x=>normalize(x));
 if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([k])=>k!=='sourceCreatedAt').map(([k,x])=>[k,normalize(x,k)]));return v;
}
async function state(){const rows=[];async function walk(col){for(const ref of await col.listDocuments()){const snap=await ref.get();if(snap.exists)rows.push([ref.path,normalize(snap.data())]);for(const child of await ref.listCollections())await walk(child);}}
 for(const col of cols)await walk(db.collection(col));return rows.sort(([a],[b])=>a.localeCompare(b));
}
(async()=>{let checks=0;
 try{
  for(const spec of specs)for(const action of actions(spec)){
   const f=fixture(spec,action);let original;
   for(const candidate of [false,true]){await seed(f);const req=await input(spec,action,f),result=await handler(spec,candidate)(req),view={result:normalize(result),rows:await state()};if(!candidate)original=view;else assert.deepEqual(view,original,spec.function+' '+action+' native legacy drift');}checks++;
   for(const marker of ['scoreStorage','scoreBucketProjection','bucketMigration','deletionStatus'])for(const value of [null,false,{},'unknown',{status:'deleting'}])for(const side of ['tournaments','publicTournaments']){
    await seed(f);const req=await input(spec,action,f);await db.doc(side+'/'+code).update({[marker]:value});const before=await state();
    if(tracker(spec))await handler(spec,true)(req);else await assert.rejects(handler(spec,true)(req),/bucket-scoring-required/);
    assert.deepEqual(await state(),before);checks++;
   }
   if(!(spec.function==='eventStaffService'&&action==='invite')&&spec.function!=='drawTournamentRaffle'){
    await seed(f);const req=await input(spec,action,f),ref=db.doc('tournaments/'+code),saved=(await ref.get()).data();await ref.delete();await ref.set(saved);const before=await state();
    if(tracker(spec))await handler(spec,true)(req);else await assert.rejects(handler(spec,true)(req),/room-generation-changed/);assert.deepEqual(await state(),before);checks++;
   }
  }
  // Concurrent duplicate draw operations share the original receipt and ledger.
  {const spec=specs.find(s=>s.function==='drawTournamentRaffle'),f=fixture(spec);await seed(f);const fn=handler(spec,true),result=await Promise.all([fn(f.request),fn(f.request)]);
   assert.equal(result.filter(r=>r.replayed).length,1);assert.equal((await db.collection('tournaments/'+code+'/raffles').get()).size,1);assert.equal((await db.doc('tournaments/'+code+'/raffleControl/current').get()).data().winnerKeys.length,1);checks++;
  }
  // A delayed deletion event cannot mutate metadata for a replacement signup.
  {const spec=specs.find(s=>s.function==='trackTournamentRegistrationActivity'),f=fixture(spec,'delete');await seed(f);const req=await input(spec,'delete',f);await db.doc('tournaments/'+code+'/registrations/target').set({status:'confirmed'});const before=await state();await handler(spec,true)(req);assert.deepEqual(await state(),before);checks++;}
  {const spec=specs.find(s=>s.function==='eventStaffService');for(const action of ['accept','reject'])for(const missing of [false,true]){
   const f=fixture(spec,action);await seed(f);if(missing)await db.doc('users/target').delete();else await db.doc('users/target').update({active:false});const before=await state();await assert.rejects(handler(spec,true)(f.request),/account-inactive/);assert.deepEqual(await state(),before);checks++;
  }}
  // Exercise the metadata-only bucket path with real SDK createTime snapshots.
  {const spec=specs.find(s=>s.function==='eventStaffService');for(const action of ['invite','accept','reject','revoke']){
   const f=fixture(spec,action);bucket(f);await seed(f);
   const tr=db.doc('tournaments/'+code),pr=db.doc('publicTournaments/'+code),beforePrivate=(await tr.get()).data(),beforePublic=(await pr.get()).data();
   const result=await handler(spec,true)(f.request);assert(result.ok);
   const afterPrivate=(await tr.get()).data(),afterPublic=(await pr.get()).data();
   assert.equal(afterPrivate.data,beforePrivate.data);assert.deepEqual(afterPrivate.scoreStorage,beforePrivate.scoreStorage);assert.deepEqual(afterPublic,beforePublic);
   assert.deepEqual(Object.keys(afterPrivate).filter(k=>JSON.stringify(afterPrivate[k])!==JSON.stringify(beforePrivate[k])).sort(),['eventStaffAssignments','updatedAt']);checks++;
  }}
  // Inject one SDK ABORTED attempt, then replace the peer before the next read.
  // This deterministically tests retry binding; it is not a natural contention claim.
  {const spec=specs.find(s=>s.function==='eventStaffService');for(const action of ['invite','accept','reject','revoke']){
   const f=fixture(spec,action);bucket(f);await seed(f);const before=await state(),publicRef=db.doc('publicTournaments/'+code),saved=(await publicRef.get()).data();
   const native=db.runTransaction;let attempts=0;
   db.runTransaction=function(callback,...options){return native.call(this,async tx=>{
    attempts++;if(attempts===2){await publicRef.delete();await publicRef.set(saved);}
    const result=await callback(tx);if(attempts===1)throw Object.assign(new Error('synthetic-retry-boundary'),{code:10});return result;
   },...options);};
   try{await assert.rejects(handler(spec,true)(f.request),/room-generation-changed/);assert.equal(attempts,2);}
   finally{db.runTransaction=native;}
   assert.deepEqual(await state(),before);checks++;
  }}
  // A deleted recipient must not be recreated by its membership projection.
  {const spec=specs.find(s=>s.function==='eventStaffService');for(const marked of [false,true])for(const duringRetry of [false,true]){
   const f=fixture(spec,'revoke');if(marked)bucket(f);await seed(f);
   const target=db.doc('users/target'),native=db.runTransaction;let attempts=0;
   if(!duringRetry)await target.delete();
   else db.runTransaction=function(callback,...options){return native.call(this,async tx=>{
    attempts++;if(attempts===2)await target.delete();
    const result=await callback(tx);if(attempts===1)throw Object.assign(new Error('synthetic-account-deletion-retry'),{code:10});return result;
   },...options);};
   try{const result=await handler(spec,true)(f.request);assert(result.ok);if(duringRetry)assert.equal(attempts,2);}
   finally{db.runTransaction=native;}
   assert.equal((await target.get()).exists,false,'revocation recreated deleted account');
   assert.equal((await db.doc('tournaments/'+code).get()).data().eventStaffAssignments.target.status,'revoked');checks++;
  }}
  console.log(JSON.stringify({nativeOperationsChecks:checks,project,productionWrites:0,productionRequests:0,scope:'real Admin SDK, captured QR proxy and Firestore snapshots; synthetic auth/events, injected retry and deterministic business RNG'}));
 }finally{await clear();await db.terminate();await deleteApp(app);fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
