'use strict';
const {test,before,beforeEach,after}=require('node:test');
const assert=require('node:assert/strict');
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');
const {getFirestore}=require('firebase-admin/firestore');
const {assertIsolated,PROJECT}=require('../../emulator/preflight.cjs');
const {createLifecycleService}=require('../service.cjs');
assertIsolated(process.env);
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8180'||process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9098')throw Error('emulators-required');
let app,db,auth,service,sequence=0;const tokens={};
const endpoint='http://127.0.0.1:5003/'+PROJECT+'/us-central1/hc01Command';
async function clear(){const r=await fetch('http://127.0.0.1:8180/emulator/v1/projects/'+PROJECT+'/databases/(default)/documents',{method:'DELETE'});assert.equal(r.ok,true);}
async function call(uid,operation,input,token=tokens[uid]){
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({data:{operation,input}})});
  const body=await response.json();if(!response.ok||body.error){const error=Error(body.error?.details?.reason||body.error?.status||'callable-failed');error.status=response.status;throw error;}return body.result;
}
const create=(uid='A',requestId='create')=>call(uid,'createChallenge',{requestId});
async function command(uid,op,c,extra={}){return (await call(uid,op,{challengeId:c.challengeId,requestId:'cmd_'+(++sequence),expectedRevision:c.revision,...extra})).challenge;}
before(async()=>{
  process.env.METADATA_SERVER_DETECTION='none';app=initializeApp({projectId:PROJECT},'hc01-integration');auth=getAuth(app);db=getFirestore(app);service=createLifecycleService({db,auth});
  for(const uid of ['A','B','C','outsider']){
    const email=uid+'@hc01.invalid';await auth.createUser({uid,email,password:'emulator-only-password'});
    const r=await fetch('http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:'emulator-only-password',returnSecureToken:true})});
    assert.equal(r.ok,true);tokens[uid]=(await r.json()).idToken;
  }
});
beforeEach(async()=>{
  await clear();await auth.updateUser('A',{disabled:false});
  await db.doc('hcConfig/runtime').set({enabled:true,environment:'sandbox',hc01Enabled:true,hc01Rules:{version:'emulator-4-v1',targetScore:4},hc01PairingTtlMs:120000});
  for(const uid of ['A','B','C'])await db.doc('hcActors/'+uid).set({active:true,hc01Allowed:true,role:'player'});
  for(const [path,data]of [['users/A',{lifetime:444}],['ladder/A',{points:123}],['mailboxes/A',{count:7}]])await db.doc(path).set(data);
});
after(async()=>{if(db){await clear();await db.terminate();}if(app)await deleteApp(app);});
test('actual Auth and Callable complete pairing, two starts, rounds and two final confirmations',async()=>{
  const made=await create();let c=await command('B','accept',made.challenge,{pairingToken:made.pairingToken});
  c=await command('A','start',c);c=await command('B','start',c);
  for(const finish of ['extreme','spin']){c=await command('A','proposeRound',c,{winnerUid:'A',finish});c=await command('B','confirmRound',c,{roundRevision:c.pendingRound.roundRevision});}
  c=await command('A','confirmFinish',c,{resultRevision:c.resultRevision});assert.equal(c.status,'final_pending');
  c=await command('B','confirmFinish',c,{resultRevision:c.resultRevision});assert.equal(c.status,'completed');assert.deepEqual(c.score,{a:4,b:0});
  const a=await call('A','getMyHistory',{}),b=await call('B','getMyHistory',{});
  assert.deepEqual([a.history.total,a.history.wins,b.history.total,b.history.losses],[1,1,1,1]);
  assert.deepEqual([a.history.matches[0].score,a.history.matches[0].opponentScore,b.history.matches[0].score,b.history.matches[0].opponentScore],[4,0,0,4]);
  assert.equal(c.certificationSource,'SELF');assert.equal(c.ratingStatus,'not_awarded');
  assert.equal((await db.doc('hc01Challenges/'+c.challengeId).get()).data().status,'completed');
  assert.deepEqual((await db.doc('users/A').get()).data(),{lifetime:444});assert.deepEqual((await db.doc('ladder/A').get()).data(),{points:123});assert.deepEqual((await db.doc('mailboxes/A').get()).data(),{count:7});
});
test('Firestore transaction gives one winner to competing QR redemption and records one acceptance',async()=>{
  const made=await create();const results=await Promise.allSettled(['B','C'].map(uid=>command(uid,'accept',made.challenge,{pairingToken:made.pairingToken})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
  const stored=(await db.doc('hc01Challenges/'+made.challenge.challengeId).get()).data();assert.equal(stored.participants.length,2);assert.equal(stored.revision,1);assert.equal('pairingTokenHash'in stored,false);
  assert.equal((await db.collection('hc01Receipts').get()).size,2);assert.equal((await db.collection('hc01Audit').get()).size,2);
});
test('parallel identical create requests recover exactly one challenge, secret and receipt',async()=>{
  const outcomes=await Promise.all(Array.from({length:5},()=>create('A','same-request')));outcomes.forEach(o=>assert.deepEqual(o,outcomes[0]));
  assert.equal((await db.collection('hc01Challenges').get()).size,1);assert.equal((await db.collection('hc01Receipts').get()).size,1);
  const read=await call('A','getChallenge',{challengeId:outcomes[0].challenge.challengeId});assert.equal('pairingToken'in read,false);assert.equal('pairingTokenHash'in read.challenge,false);
});
test('missing or invalid bearer, no allowlist, disabled Auth and revoked actor access are denied',async()=>{
  await assert.rejects(call('A','createChallenge',{requestId:'missing'},null));await assert.rejects(call('A','createChallenge',{requestId:'invalid'},'invalid-token'));
  await assert.rejects(create('outsider'),/account-unavailable/);
  const made=await create();await db.doc('hcActors/A').update({hc01Allowed:false});await assert.rejects(create(),/account-unavailable/);
  await db.doc('hcActors/A').update({hc01Allowed:true});await auth.updateUser('A',{disabled:true});await assert.rejects(create('A','disabled'));
  assert.equal((await db.collection('hc01Challenges').get()).size,1);assert.equal(made.challenge.status,'proposed');
});
test('participant and global close gates block calls; rejection leaves stored state unchanged',async()=>{
  const made=await create();await assert.rejects(call('C','getChallenge',{challengeId:made.challenge.challengeId}),/participant-required/);
  const c=await command('B','accept',made.challenge,{pairingToken:made.pairingToken});await db.doc('hcActors/B').update({active:false});
  await assert.rejects(command('A','start',c),/opponent-unavailable/);assert.equal((await db.doc('hc01Challenges/'+c.challengeId).get()).data().revision,1);
  await db.doc('hcConfig/runtime').update({hc01Enabled:false});await assert.rejects(create(),/closed/);
});
test('authenticated client cannot read private receipt or directly mutate any service collection',async()=>{
  const made=await create();const receipt=(await db.collection('hc01Receipts').get()).docs[0];
  for(const path of ['hc01Challenges/'+made.challenge.challengeId,receipt.ref.path,'hc01PlayerRecords/A','hcActors/A','hcConfig/runtime']){
    const url='http://127.0.0.1:8180/v1/projects/'+PROJECT+'/databases/(default)/documents/'+path;
    const headers={Authorization:'Bearer '+tokens.A,'Content-Type':'application/json'};
    assert.equal((await fetch(url,{headers})).status,403);
    assert.equal((await fetch(url,{method:'PATCH',headers,body:JSON.stringify({fields:{active:{booleanValue:true}}})})).status,403);
  }
  assert.equal((await service.run(tokens.A,'getChallenge',{challengeId:made.challenge.challengeId})).challenge.revision,0);
});

test('closed setup uses actual Auth and Firestore, preserves shared fields and refuses stale plans',async()=>{
  const {createSetupService}=require('../cloud/setup-service.cjs');const setup=createSetupService({db,auth});
  await db.doc('hcConfig/runtime').update({hc00Policy:{keep:1}});await db.doc('hcActors/A').update({role:'staff',hc00Allowed:true});
  const input={uids:['A','B'],rules:{version:'hc01-internal-test-v1',targetScore:4},pairingTtlMs:120000};
  const plan=await setup.inspect(input);assert.equal(plan.applied,false);assert.equal((await db.doc('hcConfig/runtime').get()).data().hc01Enabled,true);
  await setup.provisionClosed(input,plan.planHash);const config=(await db.doc('hcConfig/runtime').get()).data();assert.equal(config.enabled,true);assert.equal(config.hc01Enabled,false);assert.deepEqual(config.hc00Policy,{keep:1});
  const actor=(await db.doc('hcActors/A').get()).data();assert.equal(actor.role,'staff');assert.equal(actor.hc00Allowed,true);
  await assert.rejects(setup.provisionClosed(input,plan.planHash),/setup-plan-changed/);await assert.rejects(create(),/closed/);
});
test('manual code and QR use the same atomic Firestore pairing and private code index',async()=>{
  const made=await create();assert.match(made.pairingCode,/^[2-9A-HJ-NP-Z]{4}$/);
  const input={requestId:'manual-code',expectedRevision:0,pairingCode:made.pairingCode.toLowerCase()};
  const accepted=await call('B','acceptCode',input);assert.equal(accepted.challenge.status,'accepted');
  assert.deepEqual(await call('B','acceptCode',input),accepted);
  await assert.rejects(command('C','accept',made.challenge,{pairingToken:made.pairingToken}),/pairing-unavailable/);
  const index=(await db.collection('hc01PairingCodes').get()).docs[0];assert.equal(index.data().used,true);
  const url='http://127.0.0.1:8180/v1/projects/'+PROJECT+'/databases/(default)/documents/'+index.ref.path;
  assert.equal((await fetch(url,{headers:{Authorization:'Bearer '+tokens.A}})).status,403);
});

test('actual Callable dispute preserves room, undo corrects score and fresh final confirmations complete',async()=>{
  const made=await create();let c=await command('B','accept',made.challenge,{pairingToken:made.pairingToken});
  c=await command('A','start',c);c=await command('B','start',c);
  for(const finish of ['extreme','spin'])c=await command('A','recordRound',c,{winnerUid:'A',finish});
  c=await command('A','confirmFinish',c,{resultRevision:c.resultRevision});
  c=await command('B','dispute',c);assert.equal(c.status,'score_review');assert.deepEqual(c.finishConfirmedBy,[]);
  c=await command('A','undoRound',c);assert.deepEqual(c.score,{a:3,b:0});assert.equal(c.corrections.length,1);
  c=await command('A','recordRound',c,{winnerUid:'A',finish:'spin'});
  c=await command('A','resumeReview',c);assert.equal(c.status,'final_pending');
  c=await command('B','confirmFinish',c,{resultRevision:c.resultRevision});
  c=await command('A','confirmFinish',c,{resultRevision:c.resultRevision});assert.equal(c.status,'completed');
  const stored=(await db.doc('hc01Challenges/'+c.challengeId).get()).data();
  assert.equal(stored.corrections[0].round.finish,'spin');assert.deepEqual(stored.score,{a:4,b:0});
});


test('actual Callable completes two-game series with one pairing and records both games atomically',async()=>{
  const made=await call('A','createChallenge',{requestId:'two-games',matchCount:2,playerName:'黑爸'});let c=await command('B','accept',made.challenge,{pairingToken:made.pairingToken,playerName:'小宇'});c=await command('A','start',c);c=await command('B','start',c);
  for(const finish of ['extreme','spin'])c=await command('A','recordRound',c,{winnerUid:'A',finish});assert.equal(c.status,'game_pending');
  assert.equal((await call('A','getMyHistory',{})).history.total,0);c=await command('A','nextGame',c);assert.equal(c.gameNumber,2);assert.equal(c.games.length,1);assert.deepEqual(c.score,{a:0,b:0});
  for(const finish of ['extreme','spin'])c=await command('A','recordRound',c,{winnerUid:'B',finish});assert.equal(c.status,'final_pending');c=await command('A','confirmFinish',c,{resultRevision:c.resultRevision});c=await command('B','confirmFinish',c,{resultRevision:c.resultRevision});assert.equal(c.status,'completed');
  for(const uid of ['A','B']){const h=(await call(uid,'getMyHistory',{})).history;assert.deepEqual([h.total,h.wins,h.losses],[2,1,1]);assert.deepEqual(h.matches.map(m=>m.gameNumber),[2,1]);}
});
