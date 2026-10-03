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
    status:'in_progress',revision:0,settlementActorUid:'admin',verificationActorUid:'witness',riskReviewerUid:'admin'});
  await db.doc('users/p1').set({lifetime:444});
  await db.doc('ladder/p1').set({points:123});
  await db.doc('mailboxes/p1').set({count:7});
});
after(async()=>{if(db){await clear();await db.terminate();}if(app)await deleteApp(app);});
const submission=(patch={})=>({challengeId:'c1',requestId:'submit-1',expectedRevision:0,
  winnerUid:'p1',score:{a:4,b:2},...patch});
const settlement=(patch={})=>({challengeId:'c1',requestId:'settle-1',expectedRevision:3,resultRevision:1,...patch});
async function verified(patch={}){
  // Fixture for settlement fault injection; full workflow tests below use actual service methods.
  await db.doc('hcChallenges/c1').update({status:'verified',revision:3,resultRevision:1});
  await db.doc('hcResults/c1').set({challengeId:'c1',environment:'sandbox',participants:['p1','p2'],winnerUid:'p1',
    score:{a:4,b:2},status:'verified',resultRevision:1,verificationRevision:1,
    verificationStatus:'verified',riskStatus:'clear',riskRevision:1,verifiedBy:'witness',riskReviewedBy:'admin',riskReason:'Fixture review',...patch});
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

const review=(revision,requestId,patch={})=>({challengeId:'c1',requestId,expectedRevision:revision,resultRevision:1,...patch});
async function certify(){
  await service.submit(tokens.p1,submission());
  await service.beginVerification(tokens.witness,review(1,'begin'));
  await service.verifyResult(tokens.witness,review(2,'verify',{decision:'approve'}));
}
test('actual submit, witness certification, risk clearance and settlement are version-bound',async()=>{
  await certify();
  await assert.rejects(service.settle(tokens.admin,settlement()),/result-not-cleared/);
  const request=review(3,'risk',{decision:'clear',reason:'Witness and score checked'});
  const approved=await service.reviewRisk(tokens.admin,request);
  assert.deepEqual(await service.reviewRisk(tokens.admin,request),approved);
  const outcome=await service.settle(tokens.admin,settlement({expectedRevision:4}));
  assert.equal(outcome.revision,5);
  assert.equal((await db.collection('hcSettlementLedger').get()).size,1);
  assert.equal((await db.collection('hcAuditEvents').get()).size,4);
  assert.deepEqual((await db.doc('users/p1').get()).data(),{lifetime:444});
});
test('certification rejects unassigned, participant, spoofed and stale result identities',async()=>{
  await service.submit(tokens.p1,submission());
  for(const uid of ['p1','outsider','admin'])
    await assert.rejects(service.beginVerification(tokens[uid],review(1,'bad-'+uid)),/review-forbidden/);
  await assert.rejects(service.beginVerification(tokens.witness,review(1,'stale-result',{resultRevision:2})),/review-forbidden/);
  await assert.rejects(service.beginVerification(tokens.witness,review(1,'spoof',{uid:'admin'})),/invalid-request/);
  await assert.rejects(service.beginVerification(tokens.witness,review(0,'stale-version')),/revision-conflict/);
  await db.doc('hcChallenges/c1').update({verificationActorUid:'p1'});
  await assert.rejects(service.beginVerification(tokens.p1,review(1,'self')),/review-forbidden/);
  assert.equal((await db.collection('hcAuditEvents').get()).size,0);
});
test('concurrent witness decisions accept exactly one certification',async()=>{
  await service.submit(tokens.p1,submission());
  const begin=review(1,'begin');
  await service.beginVerification(tokens.witness,begin);
  await service.beginVerification(tokens.witness,begin);
  const outcomes=await Promise.allSettled(['approve','dispute'].map(decision=>
    service.verifyResult(tokens.witness,review(2,decision,{decision}))));
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await db.doc('hcChallenges/c1').get()).data().revision,3);
  assert.equal((await db.collection('hcAuditEvents').get()).size,2);
});
test('disputed result cannot clear risk or settle',async()=>{
  await service.submit(tokens.p1,submission());
  await service.beginVerification(tokens.witness,review(1,'begin'));
  await service.verifyResult(tokens.witness,review(2,'dispute',{decision:'dispute'}));
  await assert.rejects(service.reviewRisk(tokens.admin,review(3,'risk',{decision:'clear',reason:'Checked'})),/verification-not-ready/);
  await assert.rejects(service.settle(tokens.admin,settlement()));
  assert.equal((await db.collection('hcSettlementLedger').get()).size,0);
});
test('risk review requires assigned administrator, reason, current version and active witness',async()=>{
  await certify();
  const request=review(3,'risk',{decision:'clear',reason:'Checked'});
  await assert.rejects(service.reviewRisk(tokens.witness,request),/risk-review-forbidden/);
  await db.doc('hcActors/outsider').update({role:'admin'});
  await assert.rejects(service.reviewRisk(tokens.outsider,request),/review-forbidden/);
  await assert.rejects(service.reviewRisk(tokens.admin,{...request,reason:' '}),/invalid-risk-review/);
  await assert.rejects(service.reviewRisk(tokens.admin,{...request,expectedRevision:2}),/revision-conflict/);
  await db.doc('hcActors/witness').update({active:false});
  await assert.rejects(service.reviewRisk(tokens.admin,request),/witness-unavailable/);
  assert.equal((await db.doc('hcResults/c1').get()).data().riskStatus,'hold');
});
test('risk hold records reason and blocks settlement; concurrent reviews accept one version',async()=>{
  await certify();
  const outcomes=await Promise.allSettled(['clear','hold'].map(decision=>
    service.reviewRisk(tokens.admin,review(3,decision,{decision,reason:'Manual review '+decision}))));
  assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
  await service.reviewRisk(tokens.admin,review(4,'force-hold',{decision:'hold',reason:'Need evidence'}));
  await assert.rejects(service.settle(tokens.admin,settlement({expectedRevision:5})),/result-not-cleared/);
  const result=(await db.doc('hcResults/c1').get()).data();
  assert.equal(result.riskReason,'Need evidence');assert.equal(result.riskRevision,1);
  assert.equal((await db.collection('hcSettlementLedger').get()).size,0);
});

test('settlement rechecks risk reviewer and settled records reject further reviews',async()=>{
  await certify();
  await service.reviewRisk(tokens.admin,review(3,'clear',{decision:'clear',reason:'Checked'}));
  await db.doc('hcActors/admin').update({role:'staff'});
  await db.doc('hcActors/outsider').update({role:'admin'});
  await db.doc('hcChallenges/c1').update({settlementActorUid:'outsider'});
  await assert.rejects(service.settle(tokens.outsider,settlement({expectedRevision:4})),/risk-reviewer-unavailable/);
  await db.doc('hcActors/admin').update({role:'admin'});
  await db.doc('hcChallenges/c1').update({settlementActorUid:'admin'});
  await service.settle(tokens.admin,settlement({expectedRevision:4}));
  await assert.rejects(service.reviewRisk(tokens.admin,review(5,'late',{decision:'hold',reason:'Late change'})),/verification-not-ready/);
  assert.equal((await db.doc('hcResults/c1').get()).data().status,'settled');
});
