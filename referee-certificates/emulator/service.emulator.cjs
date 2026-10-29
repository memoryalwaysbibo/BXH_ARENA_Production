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

test('real transaction get stays pure; explicit zero-experience approval retries only once',async()=>{
 await seed({...fixture(),...fixture({uid:'bob',code:'BXH-BBBB'}),'refereeCertificateSystem/numbering':{lastIssuedNumber:18}});
 const reads=await Promise.all([handle(request('alice','get')),handle(request('bob','get'))]);
 assert.equal(reads[0].snapshot.certificate,null);assert.equal((await db.collection('refereeCertificates').get()).size,0);
 const grant=uid=>request('admin','grant',{targetUid:uid,level:1,personId:'person-'+uid,basis:'explicitly verified person',operationId:'approve_'+uid,expectedRevision:0});
 const r=await Promise.all([handle(grant('alice')),handle(grant('alice')),handle(grant('bob'))]);
 assert.equal(r[0].snapshot.certificate.number,r[1].snapshot.certificate.number);assert.notEqual(r[0].snapshot.certificate.number,r[2].snapshot.certificate.number);
 assert.equal((await db.doc('refereeCertificateSystem/numbering').get()).data().lastIssuedNumber,20);
 assert.equal((await db.collection('refereeCertificates/alice/audit').get()).size,1);
});
test('real recognition receipt survives dropped reply; cancellation withdraws counted experience without deleting evidence',async()=>{
 await seed(fixture());
 const data={targetUid:'alice',operationId:'recognition_once',expectedRevision:0,entry:{kind:'decision',decisions:1,events:0,size:null,precision:'unknown',period:'2026',note:'private',sourceKey:'match:BXH-AAAA:m0',basis:'responsibility verified'}};
 let r=await handle(request('admin','saveBackfill',data));assert.equal(r.snapshot.stats.decisions,1);assert.equal(r.snapshot.certificate,null);
 assert.equal((await handle(request('admin','saveBackfill',data))).replayed,true);
 const id=r.snapshot.backfills[0].id;
 r=await handle(request('admin','revokeBackfill',{targetUid:'alice',operationId:'revoke_once',expectedRevision:1,entryId:id}));assert.equal(r.snapshot.stats.decisions,0);
 r=await handle(request('admin','restoreBackfill',{targetUid:'alice',operationId:'restore_once',expectedRevision:2,entryId:id}));assert.equal(r.snapshot.stats.decisions,1);
 await db.doc('tournaments/BXH-AAAA').update({eventCancelled:true});
 assert.equal((await handle(request('alice','get'))).snapshot.stats.decisions,0);
 assert.equal((await db.collection('refereeCertificates/alice/audit').get()).size,3);
});
test('real person registry rejects concurrent duplicate natural-person binding',async()=>{
 await seed({...fixture(),...fixture({uid:'bob',code:'BXH-BBBB'}),'refereeCertificateSystem/numbering':{lastIssuedNumber:18}});
 const r=await Promise.allSettled(['alice','bob'].map(uid=>handle(request('admin','grant',{targetUid:uid,level:1,personId:'same-verified-person',basis:'explicit verification',operationId:'same_person_'+uid,expectedRevision:0}))));
 assert.equal(r.filter(x=>x.status==='fulfilled').length,1);
 assert.equal((await db.doc('refereeCertificateSystem/numbering').get()).data().lastIssuedNumber,19);
});
test('disabled qualification and global chief do not change user role or court authority',async()=>{
 await seed({...fixture(),'refereeCertificateSystem/numbering':{lastIssuedNumber:18}});
 await handle(request('admin','grant',{targetUid:'alice',level:1,personId:'person-alice',basis:'verified',operationId:'approve_alice',expectedRevision:0}));
 await handle(request('admin','setChief',{targetUid:'alice',appointed:true,expectedChiefRevision:0,operationId:'chief_alice',expectedRevision:1}));
 const r=await handle(request('admin','disable',{targetUid:'alice',operationId:'disable_alice',expectedRevision:2,basis:'explicit suspension'}));
 assert.equal(r.snapshot.certificate.number,'R000019');assert.equal(r.snapshot.certificate.status,'disabled');assert.equal((await db.doc('users/alice').get()).data().role,'player');
});
test('rules reject direct self and administrator SDK access to every server-managed path',async()=>{
 await seed(fixture());
 for(const uid of ['alice','admin']){
  const client=environment.authenticatedContext(uid).firestore();
  for(const p of ['refereeCertificates/alice','refereeCertificates/alice/records/rogue','refereeCertificateSystem/chief','refereeCertificateSystem/chief/audit/rogue','refereeCertificateOperations/rogue','refereeCertificatePersons/rogue','refereeCertificateUidBindings/rogue','refereeCertificateDecisionClaims/rogue']){
   await assertFails(getDoc(doc(client,p)));await assertFails(setDoc(doc(client,p),{awardedLevel:9}));
  }
 }
});

test('real concurrent cross-person claims reject duplicate and allow audited release then reassignment',async()=>{
 await seed({...fixture(),...fixture({uid:'bob',code:'BXH-BBBB'})});
 const entry={kind:'decision',decisions:1,events:0,size:null,precision:'unknown',period:'2026',note:'',sourceKey:'match:BXH-AAAA:m0',basis:'responsibility verified'};
 const claim=uid=>handle(request('admin','saveBackfill',{targetUid:uid,operationId:'real_claim_'+uid,expectedRevision:0,entry}));
 const r=await Promise.allSettled(['alice','bob'].map(claim));assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(r.find(x=>x.status==='rejected').reason.message,'decision-responsibility-already-claimed');
 const uid=r[0].status==='fulfilled'?'alice':'bob',other=uid==='alice'?'bob':'alice',id=r.find(x=>x.status==='fulfilled').value.snapshot.backfills[0].id;
 await handle(request('admin','revokeBackfill',{targetUid:uid,operationId:'real_release_claim',expectedRevision:1,entryId:id}));await claim(other);
 await assert.rejects(handle(request('admin','restoreBackfill',{targetUid:uid,operationId:'real_restore_conflict',expectedRevision:2,entryId:id})),/decision-responsibility-already-claimed/);
});
test('real global chief contention has one winner and one global audit',async()=>{
 await seed({...fixture(),...fixture({uid:'bob',code:'BXH-BBBB'}),'refereeCertificateSystem/numbering':{lastIssuedNumber:18}});
 for(const uid of ['alice','bob'])await handle(request('admin','grant',{targetUid:uid,level:1,personId:'person-'+uid,basis:'verified',operationId:'chief_approve_'+uid,expectedRevision:0}));
 const r=await Promise.allSettled(['alice','bob'].map(uid=>handle(request('admin','setChief',{targetUid:uid,operationId:'chief_race_'+uid,expectedRevision:1,expectedChiefRevision:0,appointed:true}))));
 assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal((await db.collection('refereeCertificateSystem/chief/audit').get()).size,1);
});
test('real recompleted result invalidates recognition until reverified',async()=>{
 await seed({...fixture(),'systemConfig/refereeCertificatesV1':{enabled:true,publicSummaryEnabled:true}});
 const entry={kind:'decision',decisions:1,events:0,size:null,precision:'unknown',period:'2026',note:'',sourceKey:'match:BXH-AAAA:m0',basis:'verified responsibility'};
 const r=await handle(request('admin','saveBackfill',{targetUid:'alice',operationId:'result_recognize',expectedRevision:0,entry}));
 const room=(await db.doc('tournaments/BXH-AAAA').get()).data(),state=JSON.parse(room.data);state.matches[0].confirmedAt=9999;state.matches[0].refereeSeatScoreRevision=42;
 await db.doc('tournaments/BXH-AAAA').update({data:JSON.stringify(state)});
 assert.equal((await handle(request('alice','get'))).snapshot.stats.decisions,0);
 const again=await handle(request('admin','saveBackfill',{targetUid:'alice',operationId:'result_reverify',expectedRevision:1,entry:{...entry,id:r.snapshot.backfills[0].id}}));assert.equal(again.snapshot.stats.decisions,1);
});
