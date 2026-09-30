'use strict';
const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');
const {getFirestore,FieldValue}=require('firebase-admin/firestore');
const {seedSession}=require('./seed-session.cjs');
const {createSandboxService}=require('../server/sandbox-service.cjs');
const {assertIsolated,PROJECT}=require('./preflight.cjs');
assertIsolated(process.env);
let app,auth,db,service;
async function clear(){const r=await fetch('http://127.0.0.1:8180/emulator/v1/projects/'+PROJECT+'/databases/(default)/documents',{method:'DELETE'});assert.equal(r.ok,true);}
before(()=>{process.env.METADATA_SERVER_DETECTION='none';app=initializeApp({projectId:PROJECT},'hc-lab-tests');auth=getAuth(app);db=getFirestore(app);service=createSandboxService({db,auth,serverTimestamp:()=>FieldValue.serverTimestamp()});});
beforeEach(clear);
after(async()=>{if(db){await clear();await db.terminate();}if(app)await deleteApp(app);});
const deps=()=>({db,auth,serverTimestamp:()=>FieldValue.serverTimestamp()});
test('lab seeds four separate demo identities; login and assigned read work without stored passwords',async()=>{
  const session=await seedSession(deps());
  assert.equal(session.accounts.length,4);assert.equal(new Set(session.accounts.map(a=>a.uid)).size,4);
  const c=(await db.doc('hcChallenges/'+session.challengeId).get()).data();assert.equal(c.status,'in_progress');
  for(const a of session.accounts){
    const response=await fetch('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key',{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:a.email,password:a.password,returnSecureToken:true})});
    const data=await response.json();assert.equal(response.ok,true);
    const snapshot=await service.getChallenge(data.idToken,{challengeId:session.challengeId});assert.equal(snapshot.actor.uid,a.uid);
    assert.equal(JSON.stringify((await db.doc('hcActors/'+a.uid).get()).data()).includes(a.password),false);
  }
  assert.equal((await db.collection('hcResults').get()).size,0);
  assert.equal((await db.collection('hcSettlementLedger').get()).size,0);
});
test('repeat lab creation does not overwrite existing challenge, role or legacy data',async()=>{
  await db.doc('users/preserved').set({lifetime:444});
  const first=await seedSession(deps());await db.doc('hcActors/'+first.accounts[0].uid).update({active:false});
  const second=await seedSession(deps());assert.notEqual(first.challengeId,second.challengeId);
  assert.equal((await db.doc('hcActors/'+first.accounts[0].uid).get()).data().active,false);
  assert.equal((await db.collection('hcChallenges').get()).size,2);
  assert.deepEqual((await db.doc('users/preserved').get()).data(),{lifetime:444});
});
test('closed or cross-environment runtime is preserved rather than enabled by seeder',async()=>{
  for(const config of [{enabled:false,environment:'sandbox'},{enabled:true,environment:'production'}]){
    await db.doc('hcConfig/runtime').set(config);
    await assert.rejects(seedSession(deps()),/sandbox-session-closed/);
    assert.deepEqual((await db.doc('hcConfig/runtime').get()).data(),config);
  }
  assert.equal((await db.collection('hcInternalSessions').get()).size,0);
});
test('failed fixture batch removes only Auth users from that seed invocation',async()=>{
  const created=[];
  const failingDb={projectId:PROJECT,doc:path=>db.doc(path),batch:()=>({create:()=>{},commit:async()=>{throw Error('injected-seed-failure');}})};
  const trackedAuth={app:auth.app,createUser:async input=>{const user=await auth.createUser(input);created.push(user.uid);return user;},deleteUser:uid=>auth.deleteUser(uid)};
  await assert.rejects(seedSession({db:failingDb,auth:trackedAuth,serverTimestamp:()=>FieldValue.serverTimestamp()}),/injected-seed-failure/);
  assert.equal(created.length,4);for(const uid of created)await assert.rejects(auth.getUser(uid),e=>e.code==='auth/user-not-found');
  assert.equal((await db.collection('hcChallenges').get()).size,0);
});
