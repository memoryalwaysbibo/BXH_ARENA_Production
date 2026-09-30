'use strict';
const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');
const {getFirestore,FieldValue}=require('firebase-admin/firestore');
const {createSandboxService}=require('../server/sandbox-service.cjs');
const {assertIsolated,PROJECT}=require('./preflight.cjs');
assertIsolated(process.env);
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8180'||
   process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9098')throw Error('emulators-required');
let app,auth,db,service;
const tokens={};
const actors={p1:'staff',p2:'staff',admin:'admin',witness:'staff',outsider:'staff',player:'player'};
async function clear(){
  const response=await fetch('http://127.0.0.1:8180/emulator/v1/projects/'+PROJECT+'/databases/(default)/documents',
    {method:'DELETE'});
  assert.equal(response.ok,true);
}
before(async()=>{
  process.env.METADATA_SERVER_DETECTION='none';
  app=initializeApp({projectId:PROJECT},'hc-sandbox-service-test');
  auth=getAuth(app);db=getFirestore(app);
  service=createSandboxService({db,auth,serverTimestamp:()=>FieldValue.serverTimestamp()});
  for(const uid of Object.keys(actors)){
    const email=uid+'@hc-test.invalid';
    await auth.createUser({uid,email,password:'sandbox-only-123'});
    const response=await fetch('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo',
      {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'sandbox-only-123',returnSecureToken:true})});
    const data=await response.json();assert.equal(response.ok,true);tokens[uid]=data.idToken;
  }
});
beforeEach(async()=>{
  await clear();
  await db.doc('hcConfig/runtime').set({enabled:true,environment:'sandbox'});
  for(const [uid,role]of Object.entries(actors))await db.doc('hcActors/'+uid).set({active:true,role});
  await db.doc('hcChallenges/c1').set({challengeId:'c1',environment:'sandbox',participants:['p1','p2'],
    status:'in_progress',revision:0,settlementActorUid:'admin',verificationActorUid:'witness'});
  await db.doc('users/p1').set({lifetime:444});
  await db.doc('ladder/p1').set({points:123});
  await db.doc('mailboxes/p1').set({count:7});
});
after(async()=>{if(db){await clear();await db.terminate();}if(app)await deleteApp(app);});
const submission=(patch={})=>({challengeId:'c1',requestId:'submit-1',expectedRevision:0,
  winnerUid:'p1',score:{a:4,b:2},...patch});
const settlement=(patch={})=>({challengeId:'c1',requestId:'settle-1',expectedRevision:3,resultRevision:1,...patch});
async function verified(patch={}){
  // Fixture-only certification: no claim that the real verification workflow is implemented.
  await db.doc('hcChallenges/c1').update({status:'verified',revision:3,resultRevision:1});
  await db.doc('hcResults/c1').set({challengeId:'c1',environment:'sandbox',participants:['p1','p2'],winnerUid:'p1',
    score:{a:4,b:2},status:'verified',resultRevision:1,verificationRevision:1,
    verificationStatus:'verified',riskStatus:'clear',riskRevision:1,verifiedBy:'witness',...patch});
}
test('Auth identity and trusted actor record reject spoofed, unrelated and disabled callers',async()=>{
  await assert.rejects(service.submit('',submission()),/unauthenticated/);
  await assert.rejects(service.submit('invalid-token',submission()));
  await assert.rejects(service.submit(tokens.p1,submission({role:'super_admin',uid:'admin'})),/invalid-request/);
  await assert.rejects(service.submit(tokens.outsider,submission()),/challenge-unavailable/);
  await assert.rejects(service.submit(tokens.player,submission()),/account-unavailable/);
  await db.doc('hcActors/p1').update({accountStatus:'frozen'});
  await assert.rejects(service.submit(tokens.p1,submission()),/account-unavailable/);
  assert.equal((await db.collection('hcResults').get()).size,0);
});
test('Auth-disabled account is rejected even with active local role',async()=>{
  await auth.updateUser('p1',{disabled:true});
  try{await assert.rejects(service.submit(tokens.p1,submission()));}
  finally{await auth.updateUser('p1',{disabled:false});}
});
test('same submission replays its receipt; reused request ID with altered content fails',async()=>{
  const first=await service.submit(tokens.p1,submission());
  assert.deepEqual(await service.submit(tokens.p1,submission()),first);
  await assert.rejects(service.submit(tokens.p1,submission({score:{a:5,b:2}})),/request-id-reused/);
  assert.equal((await db.doc('hcChallenges/c1').get()).data().revision,1);
  assert.equal((await db.collection('hcRequests').get()).size,1);
});
test('simultaneous competing submissions accept one revision only',async()=>{
  const results=await Promise.allSettled([
    service.submit(tokens.p1,submission({requestId:'side-a'})),
    service.submit(tokens.p2,submission({requestId:'side-b'}))]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.filter(r=>r.status==='rejected').length,1);
  assert.match(results.find(r=>r.status==='rejected').reason.message,/revision-conflict/);
  assert.equal((await db.doc('hcChallenges/c1').get()).data().revision,1);
  assert.equal((await db.collection('hcResults').get()).size,1);
});
test('concurrent settlement with distinct request IDs creates one ledger and one increment per player',async()=>{
  await verified();
  const outcomes=await Promise.all(Array.from({length:8},(_,i)=>
    service.settle(tokens.admin,settlement({requestId:'parallel-'+i}))));
  outcomes.forEach(outcome=>assert.deepEqual(outcome,outcomes[0]));
  assert.deepEqual(await service.settle(tokens.admin,settlement({requestId:'parallel-0'})),outcomes[0]);
  assert.equal((await db.collection('hcSettlementLedger').get()).size,1);
  assert.equal((await db.collection('hcAuditEvents').get()).size,1);
  const stats=(await db.collection('hcSandboxStats').get()).docs.map(d=>d.data());
  assert.equal(stats.length,2);stats.forEach(s=>assert.equal(s.matches,1));
  assert.equal(stats.find(s=>s.uid==='p1').wins,1);assert.equal(stats.find(s=>s.uid==='p2').wins,0);
  assert.equal((await db.doc('hcChallenges/c1').get()).data().revision,4);
  assert.deepEqual((await db.doc('users/p1').get()).data(),{lifetime:444});
  assert.deepEqual((await db.doc('ladder/p1').get()).data(),{points:123});
  assert.deepEqual((await db.doc('mailboxes/p1').get()).data(),{count:7});
});
test('risk hold, stale certification and participant self-verification prevent settlement',async()=>{
  for(const patch of [{riskStatus:'hold'},{verificationStatus:'pending'},{verificationRevision:0},
    {riskRevision:0},{verifiedBy:'p1'},{verifiedBy:'outsider'},{score:{a:-1,b:2}},
    {score:{a:2,b:4}}]){
    await verified(patch);
    await assert.rejects(service.settle(tokens.admin,settlement()));
  }
  assert.equal((await db.collection('hcSettlementLedger').get()).size,0);
  assert.equal((await db.collection('hcSandboxStats').get()).size,0);
});
test('unassigned administrator and participant cannot settle',async()=>{
  await verified();
  await assert.rejects(service.settle(tokens.p1,settlement()),/settlement-forbidden/);
  await db.doc('hcActors/outsider').update({role:'admin'});
  await assert.rejects(service.settle(tokens.outsider,settlement()),/result-unavailable/);
});
test('stale revision, closed config and cross-environment result leave no effects',async()=>{
  await verified();
  await assert.rejects(service.settle(tokens.admin,settlement({expectedRevision:2})),/revision-conflict/);
  await db.doc('hcConfig/runtime').update({enabled:false});
  await assert.rejects(service.settle(tokens.admin,settlement()),/closed/);
  await db.doc('hcConfig/runtime').update({enabled:true});
  await db.doc('hcResults/c1').update({environment:'production'});
  await assert.rejects(service.settle(tokens.admin,settlement()),/result-unavailable/);
  assert.equal((await db.collection('hcSettlementLedger').get()).size,0);
});
test('failure while assembling writes rolls back ledger, audit, stats and statuses',async()=>{
  await verified();let calls=0;
  const faulty=createSandboxService({db,auth,serverTimestamp:()=>{
    if(++calls===2)throw Error('injected-failure');return FieldValue.serverTimestamp();
  }});
  await assert.rejects(faulty.settle(tokens.admin,settlement()),/injected-failure/);
  for(const name of ['hcSettlementLedger','hcAuditEvents','hcSandboxStats','hcRequests'])
    assert.equal((await db.collection(name).get()).size,0);
  assert.equal((await db.doc('hcChallenges/c1').get()).data().status,'verified');
  assert.equal((await db.doc('hcResults/c1').get()).data().status,'verified');
});
test('mutating settled evidence under the same revision cannot add another effect',async()=>{
  await verified();await service.settle(tokens.admin,settlement());
  await db.doc('hcResults/c1').update({score:{a:5,b:2}});
  await assert.rejects(service.settle(tokens.admin,settlement({requestId:'tampered'})),/settled-result-conflict/);
  assert.equal((await db.collection('hcSettlementLedger').get()).size,1);
});
test('corrupt sandbox stats are rejected instead of overwritten or carried into another environment',async()=>{
  await verified();
  const key=require('node:crypto').createHash('sha256').update(JSON.stringify('p1')).digest('hex');
  await db.doc('hcSandboxStats/'+key).set({uid:'p1',environment:'production',matches:2,wins:1});
  await assert.rejects(service.settle(tokens.admin,settlement()),/invalid-sandbox-stats/);
  assert.equal((await db.collection('hcSettlementLedger').get()).size,0);
  assert.equal((await db.doc('hcResults/c1').get()).data().status,'verified');
});
