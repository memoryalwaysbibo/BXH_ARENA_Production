'use strict';
// Actual Firestore Emulator server-side transaction tests via Firebase Admin SDK.
const test=require('node:test'),assert=require('node:assert/strict');
const admin=require('firebase-admin');
if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('FIRESTORE_EMULATOR_HOST required; refusing production access');
const project=process.env.GCLOUD_PROJECT||'demo-bxh-arena-e2e';
if(!project.startsWith('demo-'))throw Error('demo project required');
if(!admin.apps.length)admin.initializeApp({projectId:project});
const db=admin.firestore();
const prefix='rdw-emulator-'+Date.now()+'-'+process.pid;
const event=db.collection('rdwEmulatorTests').doc(prefix+'-event');
const audit=db.collection('rdwEmulatorTests').doc(prefix+'-audit');
test('Admin SDK Emulator transaction commits PASS audit and start atomically',async()=>{
 await event.create({code:'BXH-TEST',started:false,drawRevision:1});
 await db.runTransaction(async tx=>{
  const [e,a]=await Promise.all([tx.get(event),tx.get(audit)]);
  assert.equal(e.exists,true);assert.equal(a.exists,false);
  tx.create(audit,{actorUid:'test-host',reason:'rdw-timeout',rdwEligible:false});
  tx.update(event,{started:true,rdwStartMode:'rdw-pass'});
 });
 assert.equal((await event.get()).data().started,true);
 assert.equal((await audit.get()).data().actorUid,'test-host');
 await assert.rejects(db.runTransaction(async tx=>{const e=await tx.get(event);assert.equal(e.data().started,true);tx.create(audit,{actorUid:'duplicate'});}),/already exists|ALREADY_EXISTS|6/);
 assert.equal((await audit.get()).data().actorUid,'test-host');
});
test('Admin SDK Emulator rollback leaves start unchanged after conflicting audit create',async()=>{
 const e=db.collection('rdwEmulatorTests').doc(prefix+'-rollback-event');
 const a=db.collection('rdwEmulatorTests').doc(prefix+'-rollback-audit');
 await e.create({code:'BXH-TEST',started:false});await a.create({actorUid:'prior'});
 await assert.rejects(db.runTransaction(async tx=>{
  const eventSnap=await tx.get(e);assert.equal(eventSnap.data().started,false);
  tx.update(e,{started:true});tx.create(a,{actorUid:'new'});
 }),/already exists|ALREADY_EXISTS|6/);
 assert.equal((await e.get()).data().started,false);
 assert.equal((await a.get()).data().actorUid,'prior');
});

const {startInEmulator}=require('../scripts/lib/rdw-emulator-start-adapter.cjs');
test('Emulator invokes actual RDW start contract for verified snapshot',async()=>{
 const e=db.collection('rdwEmulatorTests').doc(prefix+'-contract-event');
 const s=db.collection('rdwEmulatorTests').doc(prefix+'-contract-snapshot');
 await e.create({code:'BXH-TEST',drawRevision:2,started:false});
 await s.create({source:'server',verified:true,eventCode:'BXH-TEST',drawRevision:2,sealed:true});
 const result=await startInEmulator({db,eventRef:e,snapshotRef:s,eventCode:'BXH-TEST',drawRevision:2,actorUid:'host',authorized:true,rosterValid:true,drawRevisionValid:true,snapshotState:'verified',readbackStatus:'verified'});
 assert.equal(result.mode,'rdw-verified');assert.equal((await e.get()).data().rdwEligible,true);
});
test('Emulator invokes actual RDW PASS contract with atomic audit',async()=>{
 const e=db.collection('rdwEmulatorTests').doc(prefix+'-pass-event');
 const a=db.collection('rdwEmulatorTests').doc(prefix+'-pass-audit');
 await e.create({code:'BXH-TEST',drawRevision:3,started:false});
 const result=await startInEmulator({db,eventRef:e,auditRef:a,eventCode:'BXH-TEST',drawRevision:3,actorUid:'host',authorized:true,rosterValid:true,drawRevisionValid:true,snapshotState:'failed',readbackStatus:'missing',passRequested:true,failureReason:'cloud-timeout',serverTime:123,idempotencyKey:'BXH-TEST:3:pass'});
 assert.equal(result.mode,'rdw-pass');assert.equal((await e.get()).data().rdwEligible,false);assert.equal((await a.get()).data().actorUid,'host');
});
