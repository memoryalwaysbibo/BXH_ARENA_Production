'use strict';
const assert=require('node:assert/strict');
const project='demo-bxh-bucket-activity',host='127.0.0.1:8188';
assert.equal(process.env.GCLOUD_PROJECT,project);assert.equal(process.env.FIRESTORE_EMULATOR_HOST,host);
const {initializeApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
initializeApp({projectId:project});const db=getFirestore();db.settings({host,ssl:false});
const P=require('./probe.cjs'),{fixture,load,code}=P,R=require('node:path').resolve(__dirname,'../../../release/buckets/activity'),A=require(R+'/certificate.cjs');
async function reset(){const r=await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`,{method:'DELETE'});assert(r.ok);}
async function seed(options={}){
 await reset();const f=fixture(options);const batch=db.batch();for(const [p,v]of f.m.rows)batch.set(db.doc(p),v);await batch.commit();
 if(options.bucket){const snap=await db.doc('tournaments/'+code).get();f.top.bucketCompletion.sourceCreatedAt=A.identity(snap);await db.doc('tournaments/'+code).set(f.top);}
 return f;
}
async function ev(){return {params:{code},data:{after:await db.doc('tournaments/'+code).get()}};}
async function invoke(f,event,opts={}){return load(f,true,{db,...opts}).activityTournamentCompleted(event||await ev());}
async function balance(uid='a'){return (await db.doc('activityPointWallets/'+uid).get()).data()?.balance||0;}
async function count(){return (await db.collectionGroup('entries').get()).size;}
async function hook(f,change,{afterCommit=false}={}){
 const run=db.runTransaction.bind(db);let calls=0;db.runTransaction=async(...args)=>{calls++;if(calls===2&&!afterCommit)await change();const r=await run(...args);if(calls===2&&afterCommit)await change();return r;};
 try{return await invoke(f);}finally{db.runTransaction=run;}
}
(async()=>{let checks=0;
 for(const bucket of [false,true])for(const legacy of [false,true]){
  if(bucket&&legacy)continue;
  const f=await seed({bucket,legacy});await invoke(f);assert.equal(await balance(),legacy?3:10);assert.equal(await count(),3);const root=(await db.doc('tournaments/'+code).get()).data();assert.deepEqual(root,f.top);checks++;
  await invoke(f);assert.equal(await count(),3);checks++;
 }
 for(const kind of ['missing','replacement','cancelled']){
  const f=await seed(),event=await ev(),ref=db.doc('tournaments/'+code);
  if(kind==='missing')await ref.delete();
  if(kind==='replacement'){await ref.delete();await ref.set(f.top);}
  if(kind==='cancelled')await ref.update({eventCancelled:true});
  await invoke(f,event);assert.equal(await count(),0);checks++;
 }
 for(const side of ['tournaments','publicTournaments'])for(const key of ['bucketMigration','deletionStatus'])for(const value of [null,false,{}]){
  const f=await seed();await db.doc(side+'/'+code).update({[key]:value});await invoke(f);assert.equal(await count(),0);checks++;
 }
 for(const bucket of [false,true])for(const kind of ['missing','replacement','publicReuse','cancelled','inactive','deleted','tester','marked']){
  const f=await seed({bucket});await hook(f,async()=>{
   const root=db.doc('tournaments/'+code),pub=db.doc('publicTournaments/'+code);
   if(kind==='missing')await root.delete();
   if(kind==='replacement'){await root.delete();await root.set(f.top);}
   if(kind==='publicReuse'){await pub.delete();await pub.set(f.pub);}
   if(kind==='cancelled')await root.update({eventCancelled:true});
   if(kind==='inactive')await db.doc('users/a').update({active:false});
   if(kind==='deleted')await db.doc('users/a').update({deleted:true});
   if(kind==='tester')await db.doc('users/a').update({role:'tester'});
   if(kind==='marked')await pub.update({deletionStatus:null});
  });assert.equal(await balance(),0,kind);checks++;
 }
 for(const kind of ['missingCert','badDigest','missingBucket','badRevision','publicVector','badEpoch','badBirth','wrongPrivateMarker']){
  const f=await seed({bucket:true}),root=db.doc('tournaments/'+code);
  if(kind==='missingCert'){const t=structuredClone(f.top);delete t.bucketCompletion;await root.set(t);}
  if(kind==='badDigest')await root.update({'bucketCompletion.stateDigest':'bad'});
  if(kind==='missingBucket')await db.doc(`tournaments/${code}/matchBuckets/court-2`).delete();
  if(kind==='badRevision')await db.doc(`tournaments/${code}/matchBuckets/court-1`).update({revision:99});
  if(kind==='publicVector')await db.doc('publicTournaments/'+code).update({'scoreBucketProjection.versions.court-1':99});
  if(kind==='badEpoch')await db.doc(`tournaments/${code}/matchBuckets/court-1`).update({epoch:'old'});
  if(kind==='badBirth')await root.update({'bucketCompletion.sourceCreatedAt':'old'});
  if(kind==='wrongPrivateMarker')await root.update({scoreBucketProjection:{}});
  await invoke(f);assert.equal(await count(),0,kind);checks++;
 }
 {const f=await seed({bucket:true});await Promise.all([invoke(f),invoke(f)]);assert.equal(await balance(),10);assert.equal(await count(),3);checks++;}
 for(const bucket of [false,true]){
  const f=await seed({bucket});await assert.rejects(()=>hook(f,async()=>{throw Error('synthetic-commit-response-lost');},{afterCommit:true}),/synthetic-commit-response-lost/);assert.equal(await balance(),10);assert.equal(await count(),1);
  await invoke(f);assert.equal(await balance(),10);assert.equal(await count(),3);checks++;
 }
 {const f=await seed();await hook(f,async()=>{await db.doc('tournaments/'+code).update({eventCancelled:true});},{afterCommit:true});assert.equal(await balance('a'),10);assert.equal(await balance('b'),0);assert.equal(await balance('host'),0);checks++;}
 // The current snapshot is read transactionally, not the stale event's scores.
 {const f=await seed(),event=await ev();const s=structuredClone(f.state);s.matches[0].forfeit=true;await db.doc('tournaments/'+code).update({data:JSON.stringify(s)});await invoke(f,event);assert.equal(await count(),0);checks++;}
 // Parent recreate in one transaction must not inherit an old event identity.
 {const f=await seed(),event=await ev();await db.doc('tournaments/'+code).delete();await db.doc('tournaments/'+code).set(f.top);await invoke(f,event);assert.equal(await count(),0);checks++;}

 let scheduledChecks=0;
 const scheduled=f=>load(f,true,{db,project:'bxh-arena'}).activityCompletedTournamentBackfill();
 for(const bucket of [false,true]){
  const f=await seed({bucket});await scheduled(f);assert.equal(await count(),3);await scheduled(f);assert.equal(await count(),3);scheduledChecks+=2;
  const g=await seed({bucket}),run=db.runTransaction.bind(db);let first=true;
  db.runTransaction=async(...args)=>{if(first){first=false;const root=db.doc('tournaments/'+code);await root.delete();await root.set(g.top);}return run(...args);};
  try{await scheduled(g);}finally{db.runTransaction=run;}
  assert.equal(await count(),0);scheduledChecks++;
  const h=await seed({bucket});let calls=0;db.runTransaction=async(...args)=>{if(++calls===2)await db.doc('users/a').update({active:false});return run(...args);};
  try{await scheduled(h);}finally{db.runTransaction=run;}
  assert.equal(await balance(),0);scheduledChecks++;
  const i=await seed({bucket});calls=0;db.runTransaction=async(...args)=>{const r=await run(...args);if(++calls===2)throw Error('synthetic-scheduled-response-lost');return r;};
  try{await scheduled(i);}finally{db.runTransaction=run;}
  assert.equal(await count(),1);await scheduled(i);assert.equal(await count(),3);assert.equal(await balance(),10);scheduledChecks++;
 }
 console.log(JSON.stringify({nativeBackfillChecks:scheduledChecks,productionWrites:0,scope:'real Firestore SDK scheduled scan, current-room authority and retry; synthetic project/account/event boundaries'}));
 console.log(JSON.stringify({nativeActivityChecks:checks,project,productionRequests:0,productionWrites:0,scope:'real Firestore SDK transactions; synthetic events/accounts and injected business clock; no live Auth/Eventarc or production endpoint'}));
 await db.terminate();
})().catch(e=>{console.error(e);process.exitCode=1;});
