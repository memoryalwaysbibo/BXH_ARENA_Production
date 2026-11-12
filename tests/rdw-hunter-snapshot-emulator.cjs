'use strict';
// Synthetic Hunter source + real Firestore Emulator transaction semantics.
// Research-only. No production service, grade grants, ladder, XP or start hook.
const assert=require('node:assert/strict');
const path=require('node:path');
const {createSealer}=require('../scripts/lib/rdw-hunter-snapshot-seal.cjs');
if(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.FIREBASE_AUTH_EMULATOR_HOST)
 throw Error('emulators-required');
const projectId='demo-rdw-hunter-snapshot';
const deps=path.resolve(__dirname,'../hunter-clash/arena');
const sdk=name=>require(require.resolve(name,{paths:[deps]}));
const {initializeApp,deleteApp}=sdk('firebase-admin/app');
const {getFirestore}=sdk('firebase-admin/firestore');
const code='BXH-RDW123',matchId='match-a',uids=['rdw-snapshot-a','rdw-snapshot-b'];
const input={code,matchId,actorUid:'rdw-organizer',expectedRosterRevision:4};
const evidence=(uid,tier)=>({uid,tier,ok:true,source:'server',verified:true,
 complete:true,unresolvedIdentities:0,sourceScope:'public-official-canonical-self-history-v1',
 sourceDigest:'a'.repeat(64),version:'hunter-license-v2.1',status:'unchanged',
 computedAt:99,current:{tier}});
(async()=>{
 const app=initializeApp({projectId},'rdw-snapshot-emulator');
 const db=getFirestore(app);
 try{
  assert.equal(db.projectId,projectId,'must use demo project');
  const eventRef=db.doc('tournaments/'+code);
  const baselineRef=db.doc('rdwHunterShadowBaselines/'+code+'_'+matchId);
  const awardRef=db.doc('hunterLicenseAwards/rdw-snapshot-initial');
  await eventRef.set({startedAt:null,rosterLocked:false,registrationRosterRevision:4,
   matches:[{id:matchId,a:uids[0],b:uids[1]}]});
  await awardRef.set({uid:uids[0],tier:'national',action:'grant'});
  const tierRefs=uids.map(uid=>db.doc('users/'+uid+'/hunterLicense/highest'));
  for(const ref of tierRefs)await ref.set({highestTier:'national',permanent:true});
  const permanentRefs=[awardRef,...tierRefs,
   db.doc('rdwFixtureLadder/'+uids[0]),db.doc('rdwFixtureXp/'+uids[0])];
  await permanentRefs[3].set({points:77});
  await permanentRefs[4].set({xp:44});
  const before=await db.getAll(...permanentRefs);
  const fingerprint=before.map(s=>({path:s.ref.path,data:s.data()}));
  let invalidSource=false,throwInResolver=false;
  const service=createSealer({
   db,enabled:true,clock:()=>100,
   authorize:async({tx,actorUid})=>{
    const permission=await tx.get(db.doc('rdwFixtureOrganizer/'+actorUid));
    return permission.exists&&permission.data().allowed===true;
   },
   verifyCanonicalMatch:async({room,expectedRosterRevision})=>{
    const m=room.matches?.find(m=>m.id===matchId);
    return {valid:room.registrationRosterRevision===expectedRosterRevision&&!!m,
     rosterRevision:room.registrationRosterRevision,playerA:m?.a,playerB:m?.b};
   },
   resolveTiers:async()=>{
    if(throwInResolver)throw Error('injected-reader-failure');
    return {a:evidence(uids[0],'c'),
     b:invalidSource?{...evidence(uids[1],'a'),source:'client'}:evidence(uids[1],'a')};
   }
  });
  await db.doc('rdwFixtureOrganizer/'+input.actorUid).set({allowed:true});
  // Firestore will retry contending transactions; one baseline only.
  const both=await Promise.all([service(input),service(input)]);
  assert.equal(both.filter(x=>x.ok).length,2);
  assert.equal(both.filter(x=>x.created).length,1);
  assert.equal(both.filter(x=>x.created===false).length,1);
  const saved=await baselineRef.get();
  assert.equal(saved.exists,true);assert.equal(saved.data().tiers.a,'c');
  assert.equal(saved.data().affectsLadder,false);
  assert.equal(saved.data().affectsAwards,false);
  assert.equal(saved.data().affectsXp,false);
  assert.equal((await service({...input,expectedRosterRevision:5})).ok,false);
  assert.equal((await service({...input,actorUid:'fake-organizer'})).ok,false);
  const second={...input,matchId:'match-b'};
  invalidSource=true;
  assert.equal((await service(second)).ok,false);
  assert.equal((await db.doc('rdwHunterShadowBaselines/'+code+'_match-b').get()).exists,false);
  invalidSource=false;throwInResolver=true;
  await assert.rejects(service(second),/injected-reader-failure/);
  assert.equal((await db.doc('rdwHunterShadowBaselines/'+code+'_match-b').get()).exists,false);
  assert.deepEqual((await db.getAll(...permanentRefs)).map(s=>({path:s.ref.path,data:s.data()})),fingerprint);
  console.log('RDW_SNAPSHOT_EMULATOR_PASS: concurrent, retry, invalid source, rollback, permanent awards');
 }finally{await deleteApp(app);}
})().catch(e=>{console.error(e);process.exitCode=1});
