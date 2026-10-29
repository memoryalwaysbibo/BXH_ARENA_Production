'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const host=process.env.FIRESTORE_EMULATOR_HOST,PROJECT='demo-referee-certificates';
if(!host||! /^(?:127\.0\.0\.1|localhost):\d+$/.test(host))throw Error('A loopback Firestore emulator is required; real Firebase is forbidden.');
if(process.env.GCLOUD_PROJECT&&process.env.GCLOUD_PROJECT!==PROJECT)throw Error('Wrong project: emulator test must use '+PROJECT);
const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing');
const {doc,getDoc,setDoc}=require('firebase/firestore');
const {createService}=require('../functions/service.cjs'),{fixture}=require('../test/mock-db.cjs');
const app=initializeApp({projectId:PROJECT},'referee-certificate-emulator'),db=getFirestore(app);
const handle=createService(db),request=(uid,action,extra={})=>({auth:{uid},data:{action,...extra}});
let environment;
test.before(async()=>{
  const [hostname,port]=host.split(':');
  environment=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:hostname,port:Number(port),rules:fs.readFileSync(path.join(__dirname,'firestore.rules'),'utf8')}});
});
test.beforeEach(async()=>{await environment.clearFirestore();});
test.after(async()=>{await environment?.cleanup();await db.terminate();await deleteApp(app);});
async function seed(rows){const batch=db.batch();for(const [p,value] of Object.entries(rows))batch.set(db.doc(p),value);await batch.commit();}

test('real Firestore transactions issue once for duplicate gets and allocate distinct numbers',async()=>{
  await seed({...fixture(),...fixture({uid:'bob',code:'BXH-BBBB'})});
  const results=await Promise.all([handle(request('alice','get')),handle(request('alice','get')),handle(request('bob','get'))]);
  assert.equal(results[0].snapshot.certificate.number,results[1].snapshot.certificate.number);
  assert.notEqual(results[0].snapshot.certificate.number,results[2].snapshot.certificate.number);
  assert.equal((await db.doc('refereeCertificateSystem/numbering').get()).data().lastIssuedNumber,2);
  assert.equal((await db.collection('refereeCertificates/alice/audit').get()).size,1);
});
test('real receipt and backfill mutations are atomic, idempotent, and keep grants separate',async()=>{
  await seed(fixture());const initial=(await handle(request('alice','get'))).snapshot;
  const payload={targetUid:'alice',expectedRevision:initial.revision,operationId:'emulator_backfill_01',entry:{decisions:199,events:3,size:128,precision:'exact',period:'系統開始記錄前',note:'測試'}};
  const first=await handle(request('admin','saveBackfill',payload));
  const second=await handle(request('admin','saveBackfill',payload));
  assert.equal(first.snapshot.stats.decisions,200);assert.equal(second.snapshot.stats.decisions,200);assert.equal(second.replayed,true);
  assert.equal(first.snapshot.eligibleLevel,5);assert.equal(first.snapshot.certificate.awardedLevel,1);
  assert.equal((await db.collection('refereeCertificates/alice/records').get()).size,1);
  const id=first.snapshot.backfills[0].id;
  const revoked=await handle(request('admin','revokeBackfill',{targetUid:'alice',expectedRevision:first.snapshot.revision,operationId:'emulator_revoke_01',entryId:id}));
  assert.equal(revoked.snapshot.stats.decisions,1);assert.equal(revoked.snapshot.backfills[0].history.length,2);
  await assert.rejects(handle(request('admin','grant',{targetUid:'alice',expectedRevision:revoked.snapshot.revision,operationId:'emulator_bad_grant',level:5})),e=>e.message==='rank-not-eligible');
  assert.equal((await db.doc('refereeCertificates/alice').get()).data().awardedLevel,1);
});
test('chief contention has only one winner and one global audit record',async()=>{
  await seed({...fixture(),...fixture({uid:'bob',code:'BXH-BBBB'})});
  const a=(await handle(request('alice','get'))).snapshot,b=(await handle(request('bob','get'))).snapshot;
  const results=await Promise.allSettled([['alice',a],['bob',b]].map(([uid,snapshot])=>handle(request('admin','setChief',{
    targetUid:uid,appointed:true,expectedRevision:snapshot.revision,expectedChiefRevision:0,operationId:'chief_emulator_'+uid
  }))));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.message,'chief-revision-conflict');
  assert.equal((await db.doc('refereeCertificateSystem/chief').get()).data().revision,1);
  assert.equal((await db.collection('refereeCertificateSystem/chief/audit').get()).size,1);
});
test('current private results override self-writable legacy logs, and pending events stay separate',async()=>{
  const rows=fixture({size:128,archived:false});
  rows['staffActivityLogs/alice/matches/missing-room']={uid:'alice',tournamentCode:'BXH-ZZZZ',matchId:'missing'};
  await seed(rows);
  const result=await handle(request('alice','get'));assert.equal(result.snapshot.stats.decisions,1);assert.equal(result.snapshot.stats.pendingEvents,1);assert.equal(result.snapshot.stats.pendingLogCount,1);assert.equal(result.snapshot.stats.eventCount,0);
  const ref=db.doc('tournaments/BXH-AAAA'),room=(await ref.get()).data(),state=JSON.parse(room.data);state.matches[0].completed=false;
  await ref.set({...room,data:JSON.stringify(state)});
  assert.equal((await handle(request('alice','get'))).snapshot.stats.decisions,0);
});
test('rules reject direct self and administrator SDK access to all server-managed paths',async()=>{
  await seed(fixture());await handle(request('alice','get'));
  for(const uid of ['alice','admin']){
    const client=environment.authenticatedContext(uid).firestore();
    for(const p of ['refereeCertificates/alice','refereeCertificates/alice/records/rogue','refereeCertificateSystem/chief','refereeCertificateSystem/chief/audit/rogue','refereeCertificateOperations/rogue']){
      await assertFails(getDoc(doc(client,p)));await assertFails(setDoc(doc(client,p),{awardedLevel:9}));
    }
  }
});
