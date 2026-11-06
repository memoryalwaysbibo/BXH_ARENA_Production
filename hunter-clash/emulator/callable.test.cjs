'use strict';
const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');
const {initializeApp:adminApp,deleteApp:deleteAdminApp}=require('firebase-admin/app');
const {getAuth:adminAuth}=require('firebase-admin/auth');
const {getFirestore}=require('firebase-admin/firestore');
const {initializeApp,deleteApp}=require('firebase/app');
const {getAuth,connectAuthEmulator,signInWithEmailAndPassword,signOut}=require('firebase/auth');
const {getFunctions,connectFunctionsEmulator,httpsCallable}=require('firebase/functions');
const {assertIsolated,PROJECT}=require('./preflight.cjs');
assertIsolated(process.env);
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8180'||
  process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9098')throw Error('emulators-required');
const URL='http://127.0.0.1:5003/'+PROJECT+'/us-central1/hcSandboxCommand';
const roles={'wire-a':'staff','wire-b':'staff','wire-witness':'staff','wire-admin':'admin','wire-outsider':'staff'};
const clients={},tokens={};let app,auth,db;
async function clear(){const r=await fetch('http://127.0.0.1:8180/emulator/v1/projects/'+PROJECT+'/databases/(default)/documents',{method:'DELETE'});assert.equal(r.ok,true);}
function call(uid,operation,input){return clients[uid].command({operation,input}).then(r=>r.data);}
const input=(expectedRevision,requestId,patch={})=>({challengeId:'wire-c1',expectedRevision,requestId,resultRevision:1,...patch});
const submission=(patch={})=>({challengeId:'wire-c1',expectedRevision:0,requestId:'submit',winnerUid:'wire-a',score:{a:4,b:2},...patch});
before(async()=>{
  process.env.METADATA_SERVER_DETECTION='none';
  app=adminApp({projectId:PROJECT},'hc-wire-admin');auth=adminAuth(app);db=getFirestore(app);
  for(const uid of Object.keys(roles)){
    const email=uid+'@hc-test.invalid',password='sandbox-wire-123';
    await auth.createUser({uid,email,password});
    const client=initializeApp({projectId:PROJECT,apiKey:'demo-key',authDomain:PROJECT+'.firebaseapp.com'},uid);
    const clientAuth=getAuth(client);connectAuthEmulator(clientAuth,'http://127.0.0.1:9098',{disableWarnings:true});
    const result=await signInWithEmailAndPassword(clientAuth,email,password);tokens[uid]=await result.user.getIdToken();
    const functions=getFunctions(client,'us-central1');connectFunctionsEmulator(functions,'127.0.0.1',5003);
    clients[uid]={app:client,auth:clientAuth,command:httpsCallable(functions,'hcSandboxCommand')};
  }
});
beforeEach(async()=>{
  await clear();await db.doc('hcConfig/runtime').set({enabled:true,environment:'sandbox'});
  for(const [uid,role]of Object.entries(roles))await db.doc('hcActors/'+uid).set({active:true,role});
  await db.doc('hcChallenges/wire-c1').set({challengeId:'wire-c1',environment:'sandbox',participants:['wire-a','wire-b'],
    status:'in_progress',revision:0,verificationActorUid:'wire-witness',riskReviewerUid:'wire-admin',settlementActorUid:'wire-admin'});
  await db.doc('users/wire-a').set({lifetime:444});
});
after(async()=>{
  for(const c of Object.values(clients)){await signOut(c.auth);await deleteApp(c.app);}
  if(db){await clear();await db.terminate();}if(app)await deleteAdminApp(app);
});
test('real client SDK completes full callable workflow and concurrent settlement once',async()=>{
  const first=await call('wire-a','submit',submission());
  assert.deepEqual(await call('wire-a','submit',submission()),first);
  await call('wire-witness','beginVerification',input(1,'begin'));
  await call('wire-witness','verifyResult',input(2,'approve',{decision:'approve'}));
  await assert.rejects(call('wire-admin','settle',input(3,'blocked')),e=>e.code==='functions/failed-precondition'&&e.details.reason==='result-not-cleared');
  await call('wire-admin','reviewRisk',input(3,'risk',{decision:'clear',reason:'Manual sandbox review'}));
  const outcomes=await Promise.all(Array.from({length:4},(_,i)=>call('wire-admin','settle',input(4,'settle-'+i))));
  outcomes.forEach(o=>assert.deepEqual(o,{challengeId:'wire-c1',revision:5,status:'settled'}));
  assert.equal((await db.collection('hcSettlementLedger').get()).size,1);
  assert.equal((await db.collection('hcAuditEvents').get()).size,4);
  const stats=(await db.collection('hcSandboxStats').get()).docs.map(d=>d.data());
  assert.equal(stats.length,2);stats.forEach(s=>assert.equal(s.matches,1));
  assert.deepEqual((await db.doc('users/wire-a').get()).data(),{lifetime:444});
});
test('callable rejects client role spoofing, unassigned identity and closed entry',async()=>{
  await assert.rejects(call('wire-a','submit',submission({role:'super_admin',uid:'wire-admin'})),{code:'functions/invalid-argument'});
  await assert.rejects(call('wire-outsider','submit',submission()),{code:'functions/permission-denied'});
  await assert.rejects(clients['wire-a'].command({operation:'toString',input:submission()}),{code:'functions/invalid-argument'});
  await db.doc('hcConfig/runtime').update({enabled:false});
  await assert.rejects(call('wire-a','submit',submission()),{code:'functions/failed-precondition'});
  assert.equal((await db.collection('hcResults').get()).size,0);
});
test('callable maps stale versions and reused request IDs to typed client errors',async()=>{
  await call('wire-a','submit',submission());
  await assert.rejects(call('wire-a','submit',submission({score:{a:5,b:2}})),{code:'functions/already-exists'});
  await assert.rejects(call('wire-b','submit',submission({requestId:'other'})),{code:'functions/aborted'});
  assert.equal((await db.collection('hcResults').get()).size,1);
});
test('missing, invalid and disabled bearer tokens cannot write through HTTP boundary',async()=>{
  for(const token of ['', 'invalid-token']){
    const r=await fetch(URL,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},
      body:JSON.stringify({data:{operation:'submit',input:submission()}})});
    const data=await r.json();assert.equal(r.status,401);assert.equal(data.error.status,'UNAUTHENTICATED');
  }
  await auth.updateUser('wire-a',{disabled:true});
  try{await assert.rejects(call('wire-a','submit',submission()),{code:'functions/unauthenticated'});}
  finally{await auth.updateUser('wire-a',{disabled:false});}
  assert.equal((await db.collection('hcRequests').get()).size,0);
});
test('malformed callable protocol is rejected before executing a transaction',async()=>{
  for(const body of [{operation:'submit',input:submission()}, {data:{operation:'submit',input:submission()},extra:true}]){
    const r=await fetch(URL,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+tokens['wire-a']},body:JSON.stringify(body)});
    assert.equal(r.status,400);assert.equal((await r.json()).error.status,'INVALID_ARGUMENT');
  }
  assert.equal((await db.collection('hcRequests').get()).size,0);
});
