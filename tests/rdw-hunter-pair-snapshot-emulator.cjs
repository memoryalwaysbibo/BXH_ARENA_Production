'use strict';
// Real Firestore Emulator transaction for synthetic Hunter evidence.
// No live Reader source, production credentials, ladder settlement, XP or awards.
const assert=require('node:assert/strict');
const path=require('node:path');
const {createSealer}=require('../scripts/lib/rdw-hunter-snapshot-seal.cjs');
const {createTransactionTierResolver}=require('../scripts/lib/rdw-hunter-transaction-tier-pair.cjs');
if(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.FIREBASE_AUTH_EMULATOR_HOST)
 throw Error('emulators-required');
const projectId='demo-rdw-pair-tx';
const deps=path.resolve(__dirname,'../hunter-clash/arena');
const sdk=name=>require(require.resolve(name,{paths:[deps]}));
const {initializeApp,deleteApp}=sdk('firebase-admin/app');
const {getFirestore}=sdk('firebase-admin/firestore');
const code='BXH-PAIR12',uids=['rdw-tx-a','rdw-tx-b'],actorUid='rdw-tx-host';
const matches=['match-one','match-two','match-three'].map(id=>({id,a:uids[0],b:uids[1]}));
const scope='public-official-canonical-self-history-v1';
(async()=>{
 const app=initializeApp({projectId},'rdw-pair-tx');
 try{
  const db=getFirestore(app);
  assert.equal(db.projectId,projectId);
  await db.doc('tournaments/'+code).set({
   registrationRosterRevision:8,startedAt:null,rosterLocked:false,
   matches
  });
  await db.doc('rdwFixtureOrganizer/'+actorUid).set({allowed:true});
  for(const uid of uids){
   await db.doc('users/'+uid).set({active:true,role:'player'});
   await db.doc('rdwFixtureHunterEvidence/'+uid).set({
    version:'hunter-license-v2.1',complete:true,unresolvedIdentities:0,
    sourceScope:scope,sourceDigest:'a'.repeat(64),
    tier:uid===uids[0]?'ungraded':'a'
   });
   await db.doc('users/'+uid+'/hunterLicense/highest').set({highestTier:'national',permanent:true});
  }
  await db.doc('hunterLicenseAwards/rdw-tx-original').set({uid:uids[0],action:'grant',tier:'national'});
  await db.doc('rdwFixtureXp/'+uids[0]).set({xp:19});
  await db.doc('rdwFixtureLadder/'+uids[0]).set({points:45});
  const protectedRefs=[
   ...uids.map(uid=>db.doc('users/'+uid+'/hunterLicense/highest')),
   db.doc('hunterLicenseAwards/rdw-tx-original'),
   db.doc('rdwFixtureXp/'+uids[0]),db.doc('rdwFixtureLadder/'+uids[0])
  ];
  const protectedState=async()=>({
   docs:(await db.getAll(...protectedRefs)).map(x=>({path:x.ref.path,exists:x.exists,value:x.data()||null})),
   awards:(await db.collection('hunterLicenseAwards').get()).docs.map(x=>({path:x.ref.path,value:x.data()}))
  });
  const before=await protectedState();
  const createReader=({db:readerDb})=>{
   for(const prop of ['runTransaction','batch','bulkWriter'])assert.equal(prop in readerDb,false);
   return async({tx,uid})=>{
    assert.equal(typeof tx.get,'function');
    for(const method of ['create','set','update','delete'])assert.equal(method in tx,false);
    const snap=await tx.get(readerDb.doc('rdwFixtureHunterEvidence/'+uid));
    if(!snap.exists)return null;
    const record=snap.data();
    return {uid,version:record.version,complete:record.complete,
     unresolvedIdentities:record.unresolvedIdentities,sourceScope:record.sourceScope,
     sourceDigest:record.sourceDigest,overview:{grade:{tier:record.tier}}};
   };
  };
  const resolveTiers=createTransactionTierResolver({db,createReader});
  const seal=createSealer({
   db,enabled:true,clock:()=>100,
   authorize:async({tx,actorUid})=>{
    const snap=await tx.get(db.doc('rdwFixtureOrganizer/'+actorUid));
    return snap.exists&&snap.data()?.allowed===true;
   },
   verifyCanonicalMatch:async({room,matchId,expectedRosterRevision})=>{
    const match=room.matches?.find(x=>x.id===matchId);
    return {valid:!!match&&room.registrationRosterRevision===expectedRosterRevision,
     rosterRevision:room.registrationRosterRevision,playerA:match?.a,playerB:match?.b};
   },
   resolveTiers
  });
  const input=matchId=>({code,matchId,actorUid,expectedRosterRevision:8});
  const results=await Promise.all([seal(input('match-one')),seal(input('match-one'))]);
  assert.equal(results.filter(x=>x.ok).length,2);
  assert.equal(results.filter(x=>x.created).length,1);
  const baseline=await db.doc('rdwHunterShadowBaselines/'+code+'_match-one').get();
  assert.equal(baseline.exists,true);
  assert.deepEqual(baseline.data().tiers,{a:'ungraded',b:'a'});
  assert.equal(baseline.data().affectsAwards,false);
  assert.equal(baseline.data().affectsLadder,false);
  assert.equal(baseline.data().affectsXp,false);
  // History unavailable on the second player: do not persist a partial baseline.
  await db.doc('rdwFixtureHunterEvidence/'+uids[1]).update({complete:false});
  assert.equal((await seal(input('match-two'))).code,'hunter-history-unverified');
  assert.equal((await db.doc('rdwHunterShadowBaselines/'+code+'_match-two').get()).exists,false);
  // A missing or disabled player also fails closed.
  await db.doc('users/'+uids[1]).update({active:false});
  assert.equal((await seal(input('match-three'))).code,'hunter-history-unverified');
  assert.equal((await db.doc('rdwHunterShadowBaselines/'+code+'_match-three').get()).exists,false);
  assert.deepEqual(await protectedState(),before);
  console.log('RDW_PAIR_TX_EMULATOR_PASS: same transaction, duplicate, ungraded, fail-closed, ledgers unchanged');
 }finally{await deleteApp(app);}
})().catch(e=>{console.error(e);process.exitCode=1});
