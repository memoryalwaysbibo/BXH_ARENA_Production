'use strict';
// Disposable demo fixtures. Does not import/copy production users, results or roles.
const {randomUUID}=require('node:crypto');
const {assertIsolated,PROJECT}=require('./preflight.cjs');
function assertSessionTarget(db,auth,env){
  assertIsolated(env);
  if(db.projectId!==PROJECT || auth.app.options.projectId!==PROJECT ||
      env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8180' ||
      env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9098')throw Error('sandbox-session-only');
}
async function seedSession({db,auth,serverTimestamp},env=process.env){
  assertSessionTarget(db,auth,env);
  const configRef=db.doc('hcConfig/runtime'),config=(await configRef.get()).data();
  if(config && (config.enabled!==true||config.environment!=='sandbox'))throw Error('sandbox-session-closed');
  const sessionId='lab-'+randomUUID(),challengeId=sessionId;
  const password='HC-demo-'+randomUUID();
  const accounts=['participant-a','participant-b','witness','admin'].map((purpose,i)=>({
    uid:sessionId+'-'+i,email:sessionId+'-'+i+'@hc-test.invalid',password,purpose,
    role:purpose==='admin'?'admin':'staff'}));
  const created=[];
  try{
    for(const a of accounts){await auth.createUser({uid:a.uid,email:a.email,password:a.password});created.push(a.uid);}
    const batch=db.batch();
    if(!config)batch.create(configRef,{enabled:true,environment:'sandbox'});
    for(const a of accounts)batch.create(db.doc('hcActors/'+a.uid),{
      active:true,role:a.role,environment:'sandbox',isTestAccount:true,sessionId});
    batch.create(db.doc('hcChallenges/'+challengeId),{challengeId,environment:'sandbox',sessionId,
      participants:accounts.slice(0,2).map(a=>a.uid),verificationActorUid:accounts[2].uid,
      riskReviewerUid:accounts[3].uid,settlementActorUid:accounts[3].uid,status:'in_progress',revision:0});
    batch.create(db.doc('hcInternalSessions/'+sessionId),{schemaVersion:1,environment:'sandbox',
      kind:'disposable-local-fixture',challengeId,actorUids:accounts.map(a=>a.uid),createdAt:serverTimestamp()});
    await batch.commit();
    return {sessionId,challengeId,accounts};
  }catch(error){
    // Roll back only users created by this invocation; never delete another session's data.
    const cleanup=await Promise.allSettled(created.map(uid=>auth.deleteUser(uid)));
    if(cleanup.some(r=>r.status==='rejected'))throw Error('sandbox-seed-cleanup-failed');
    throw error;
  }
}
module.exports={seedSession,assertSessionTarget};
