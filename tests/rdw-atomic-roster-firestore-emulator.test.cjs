'use strict';
// P3-24: real Firebase Admin SDK + Firestore Emulator integration.
// Never attempt to connect to production.
const test=require('node:test'),assert=require('node:assert/strict');
if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('Firestore Emulator required');
if((process.env.GCLOUD_PROJECT||'demo-bxh-arena-e2e')!=='demo-bxh-arena-e2e')throw Error('demo-only project required');
const admin=require('firebase-admin');
if(!admin.apps.length)admin.initializeApp({projectId:'demo-bxh-arena-e2e'});
const db=admin.firestore();
const {commitAtomicRosterStart}=require('../scripts/lib/rdw-atomic-roster-start.cjs');
const prefix='p324-'+Date.now()+'-'+process.pid;
function refs(label){const root=db.collection('rdwEmulatorTests').doc(prefix+'-'+label);return {eventRef:root,snapshotRef:db.collection('rdwEmulatorTests').doc(prefix+'-'+label+'-snapshot'),auditRef:db.collection('rdwEmulatorTests').doc(prefix+'-'+label+'-audit')};}
async function setup(label,size=8){
 const r=refs(label),rosterUids=Array.from({length:size},(_,i)=>'fixture_uid_'+i);
 await r.eventRef.create({code:'BXH-P324',drawRevision:4,started:false,rosterUids});
 const verifiedTiers=rosterUids.map((uid,i)=>({ok:true,uid,tier:i%2?'c':'e',computedAt:1000,sourceDigest:'a'.repeat(64),sourceScope:'public-official-canonical-self-history-v1'}));
 const args={...r,eventCode:'BXH-P324',drawRevision:4,actorUid:'fixture-host',authorized:true,rosterValid:true,drawRevisionValid:true,rosterUids,verifiedTiers,capturedAt:2000,serverTime:2000,failureReason:'rdw-timeout',idempotencyKey:'p324:'+label};
 return {r,args,run:overrides=>db.runTransaction(tx=>commitAtomicRosterStart({...args,...overrides,tx}))};
}
for(const size of [8,32,128,320])test('Firestore Emulator: '+size+' player snapshot and start commit together',async()=>{
 const f=await setup('verified-'+size,size),result=await f.run();
 assert.equal(result.mode,'rdw-verified');
 const [event,snapshot,audit]=await Promise.all([f.r.eventRef.get(),f.r.snapshotRef.get(),f.r.auditRef.get()]);
 assert.equal(event.data().started,true);assert.equal(event.data().rdwEligible,true);
 assert.equal(snapshot.data().rosterSize,size);assert.equal(snapshot.data().sealed,true);assert.equal(audit.exists,false);
});
test('Firestore Emulator: failed transaction rolls back both snapshot and start',async()=>{
 const f=await setup('rollback');
 await assert.rejects(db.runTransaction(async tx=>{
  await commitAtomicRosterStart({...f.args,tx});
  throw Error('simulated-crash-after-queued-writes');
 }),/simulated-crash/);
 const [e,s]=await Promise.all([f.r.eventRef.get(),f.r.snapshotRef.get()]);
 assert.equal(e.data().started,false);assert.equal(s.exists,false);
});
test('Firestore Emulator: PASS audit and start are atomic and RDW stays ineligible',async()=>{
 const f=await setup('pass');
 const result=await f.run({verifiedTiers:null,passRequested:true});
 assert.equal(result.mode,'rdw-pass');
 const [e,a,s]=await Promise.all([f.r.eventRef.get(),f.r.auditRef.get(),f.r.snapshotRef.get()]);
 assert.equal(e.data().started,true);assert.equal(e.data().rdwEligible,false);
 assert.equal(a.data().actorUid,'fixture-host');assert.equal(s.exists,false);
});
test('Firestore Emulator: failed PASS rolls back audit and start',async()=>{
 const f=await setup('pass-rollback');
 await assert.rejects(db.runTransaction(async tx=>{
  await commitAtomicRosterStart({...f.args,verifiedTiers:null,passRequested:true,tx});
  throw Error('crash-before-commit');
 }),/crash-before-commit/);
 const [e,a]=await Promise.all([f.r.eventRef.get(),f.r.auditRef.get()]);
 assert.equal(e.data().started,false);assert.equal(a.exists,false);
});
test('Firestore Emulator: concurrent starts permit only one commit',async()=>{
 const f=await setup('concurrent');
 const results=await Promise.allSettled([f.run(),f.run()]);
 assert.equal(results.filter(r=>r.status==='fulfilled'&&r.value.committed).length,1);
 assert.equal(results.filter(r=>r.status==='rejected').length,1);
 assert.match(results.find(r=>r.status==='rejected').reason.message,/event-already-started|ABORTED|already exists/i);
 const [e,s]=await Promise.all([f.r.eventRef.get(),f.r.snapshotRef.get()]);
 assert.equal(e.data().started,true);assert.equal(s.exists,true);
 await assert.rejects(f.run(),/event-already-started/);
});
test('Firestore Emulator: changed roster or missing authorization blocks writes',async()=>{
 for(const label of ['roster','auth']){
  const f=await setup('deny-'+label);
  if(label==='roster')await assert.rejects(f.run({rosterUids:[...f.args.rosterUids].reverse()}),/event-roster-mismatch/);
  else assert.equal((await f.run({authorized:false})).committed,false);
  const [e,s,a]=await Promise.all([f.r.eventRef.get(),f.r.snapshotRef.get(),f.r.auditRef.get()]);
  assert.equal(e.data().started,false);assert.equal(s.exists,false);assert.equal(a.exists,false);
 }
});
