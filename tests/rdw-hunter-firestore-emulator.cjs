'use strict';
// Real Firestore Emulator transactions, SYNTHETIC Hunter reader fixture.
// Not evidence of deployed Hunter reader integration or a production snapshot writer.
const assert=require('node:assert/strict');
const {resolve}=require('node:path');
if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('firestore-emulator-required');
const deps=resolve(__dirname,'../hunter-clash/arena');
const sdk=name=>require(require.resolve(name,{paths:[deps]}));
const {initializeApp,deleteApp}=sdk('firebase-admin/app');
const {getFirestore}=sdk('firebase-admin/firestore');
const {createReadOnlyTierResolver}=require('../scripts/lib/rdw-hunter-readonly-bridge.cjs');
const {assessMatch}=require('../scripts/lib/rdw-hunter-match-shadow.cjs');
(async()=>{
 const projectId='demo-rdw-hunter-bridge';
 const app=initializeApp({projectId},'rdw-hunter-emulator');
 const db=getFirestore(app);
 const uids=['rdw-player-a','rdw-player-b'];
 const docs=[
  ...uids.map(uid=>'users/'+uid+'/hunterLicense/highest'),
  ...uids.map(uid=>'users/'+uid+'/hunterAwardAudits/initial'),
  ...uids.map(uid=>'rdwFixtureLadder/'+uid),
  ...uids.map(uid=>'rdwFixtureXp/'+uid)
 ];
 try{
  for(const uid of uids){
   await db.doc('users/'+uid).set({active:true,role:'player'});
   await db.doc('rdwFixtureHunterEvidence/'+uid).set({
    tier:uid===uids[0]?'c':'a',version:'hunter-license-v2.1',
    complete:true,unresolvedIdentities:0,
    sourceDigest:'a'.repeat(64),
    sourceScope:'public-official-canonical-self-history-v1'
   });
   await db.doc('users/'+uid+'/hunterLicense/highest').set({tier:'national',awardedAt:100,permanent:true});
   await db.doc('users/'+uid+'/hunterAwardAudits/initial').set({tier:'national',kind:'permanent-award'});
   await db.doc('rdwFixtureLadder/'+uid).set({season:'S1',points:500});
   await db.doc('rdwFixtureXp/'+uid).set({xp:700});
  }
  const snapshots=await db.getAll(...docs.map(p=>db.doc(p)));
  const before=snapshots.map(s=>({path:s.ref.path,exists:s.exists,data:s.data()}));
  const createReader=()=>async({tx,uid})=>{
   assert.equal(typeof tx.get,'function');
   for(const op of ['set','create','update','delete'])assert.equal(typeof tx[op],'undefined');
   const snap=await tx.get(db.doc('rdwFixtureHunterEvidence/'+uid));
   if(!snap.exists)return null;
   const v=snap.data();
   return {uid,version:v.version,complete:v.complete,
    unresolvedIdentities:v.unresolvedIdentities,sourceDigest:v.sourceDigest,
    sourceScope:v.sourceScope,overview:{grade:{tier:v.tier}}};
  };
  const resolveTier=createReadOnlyTierResolver({db,createReader,clock:()=>100});
  const a=await resolveTier(uids[0]),b=await resolveTier(uids[1]);
  assert.equal(a.ok,true);assert.equal(b.ok,true);
  const result=assessMatch({
   eventId:'rdw-fixture',matchId:'match-1',revision:0,
   playerA:uids[0],playerB:uids[1],evidenceA:a,evidenceB:b,
   capturedAt:110,matchStartedAt:111,winnerUid:uids[0]
  });
  assert.equal(result.ok,true);
  assert.equal(result.comparison.weightedWins,1.02);
  assert.equal(result.comparison.weightedLosses,0.98);
  // Malicious evaluator cannot use transaction writes through the injected facade.
  const malicious=createReadOnlyTierResolver({db,clock:()=>100,
   createReader:()=>async({tx})=>{
    assert.equal(typeof tx.set,'undefined');
    tx.set(db.doc(docs[0]),{tier:'e'});
   }
  });
  await assert.rejects(malicious(uids[0]),TypeError);
  // Unknown and ineligible accounts must fail closed.
  await db.doc('users/'+uids[0]).update({active:false});
  assert.equal((await resolveTier(uids[0])).ok,false);
  const after=await db.getAll(...docs.map(p=>db.doc(p)));
  assert.deepEqual(after.map(s=>({path:s.ref.path,exists:s.exists,data:s.data()})),before);
  console.log('RDW_FIRESTORE_EMULATOR_PASS: read-only tier shadow, guard, ledger/XP/ladder unchanged');
 }finally{await deleteApp(app);}
})().catch(e=>{console.error(e);process.exitCode=1});
