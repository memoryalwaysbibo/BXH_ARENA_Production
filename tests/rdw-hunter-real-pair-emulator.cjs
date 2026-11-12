'use strict';
// Manual-only real source / same-transaction RDW smoke acceptance.
// NEVER invoke against real Firebase project; does not authorize release.
const assert=require('node:assert/strict');
const path=require('node:path');
const {validateSourceDir}=require('./rdw-hunter-real-reader-emulator.cjs');
const {createSealer}=require('../scripts/lib/rdw-hunter-snapshot-seal.cjs');
const {createTransactionTierResolver}=require('../scripts/lib/rdw-hunter-transaction-tier-pair.cjs');
async function run({sourceDir,db}={}){
 if(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.FIREBASE_AUTH_EMULATOR_HOST)
  throw Error('auth-and-firestore-emulators-required');
 if(!db||db.projectId!=='demo-rdw-real-reader'||typeof db.runTransaction!=='function')
  throw Error('isolated-emulator-project-required');
 const source=validateSourceDir(sourceDir);
 const {createReader}=require(path.join(source.root,'reader.cjs'));
 if(typeof createReader!=='function')throw Error('real-reader-export-missing');
 const code='BXH-RDW789',uidA='rdw-realreader-test-a',uidB='rdw-realreader-test-b';
 const matchId='pair-a',actorUid='rdw-realreader-test-host',revision=9;
 const roomRef=db.doc('tournaments/'+code);
 const sealedRef=db.doc('rdwHunterShadowBaselines/'+code+'_'+matchId);
 const userRefs=[uidA,uidB].map(uid=>db.doc('users/'+uid));
 const awardRef=db.doc('hunterLicenseAwards/rdw-manual-original');
 const ladderRef=db.doc('rdwFixtureLadder/'+uidA),xpRef=db.doc('rdwFixtureXp/'+uidA);
 // This dedicated demo project must begin without any existing records.
 // Do not reuse fixtures across test runs.
 for(const ref of [roomRef,sealedRef,awardRef,ladderRef,xpRef,...userRefs]){
  assert.equal((await ref.get()).exists,false,'fixture-project-not-empty:'+ref.path);
 }
 await roomRef.create({
  registrationRosterRevision:revision,startedAt:null,rosterLocked:false,
  matches:[{id:matchId,a:uidA,b:uidB}]
 });
 for(const ref of userRefs)await ref.create({active:true,role:'player'});
 await awardRef.create({uid:uidA,tier:'national',permanent:true});
 await ladderRef.create({points:37});await xpRef.create({xp:25});
 const untouched=[awardRef,ladderRef,xpRef,
  ...userRefs.map(ref=>db.doc(ref.path+'/hunterLicense/highest'))];
 const snapshot=async()=>({
  fixed:(await db.getAll(...untouched)).map(x=>({path:x.ref.path,exists:x.exists,data:x.data()||null})),
  awards:(await db.collection('hunterLicenseAwards').get()).docs.map(x=>({path:x.ref.path,data:x.data()}))
 });
 const before=await snapshot();
 const resolveTiers=createTransactionTierResolver({db,createReader});
 const seal=createSealer({
  db,enabled:true,clock:()=>Date.now(),
  authorize:async({actorUid:requested})=>requested===actorUid,
  verifyCanonicalMatch:async({room,matchId:requested,expectedRosterRevision})=>{
   const match=room.matches?.find(m=>m.id===requested);
   return {valid:!!match&&room.registrationRosterRevision===expectedRosterRevision,
    rosterRevision:room.registrationRosterRevision,playerA:match?.a,playerB:match?.b};
  },
  resolveTiers
 });
 let result,thrown;
 try{
  result=await seal({code,matchId,actorUid,expectedRosterRevision:revision});
  if(!result.ok)throw Error('real-pair-snapshot-incomplete:'+result.code);
  const saved=await sealedRef.get();
  assert.equal(saved.exists,true);
  assert.deepEqual(saved.data().tiers,{a:'ungraded',b:'ungraded'});
  assert.equal(saved.data().affectsAwards,false);
  assert.equal(saved.data().affectsXp,false);
  assert.equal(saved.data().affectsLadder,false);
 }catch(error){thrown=error;}
 assert.deepEqual(await snapshot(),before,'real-reader-mutated-protected-ledgers');
 if(thrown)throw thrown;
 return {ok:true,checkedFiles:source.checked.length,mode:'real-reader-pair-emulator-only',
  releaseApproved:false,liveDeploymentVerified:false,iamVerified:false};
}
module.exports={run};
if(require.main===module){
 (async()=>{
  const sourceDir=process.env.HUNTER_READER_SOURCE_DIR;
  if(!sourceDir)throw Error('HUNTER_READER_SOURCE_DIR-required');
  const deps=path.resolve(__dirname,'../hunter-clash/arena');
  const sdk=name=>require(require.resolve(name,{paths:[deps]}));
  const {initializeApp,deleteApp}=sdk('firebase-admin/app');
  const {getFirestore}=sdk('firebase-admin/firestore');
  const app=initializeApp({projectId:'demo-rdw-real-reader'},'rdw-manual-pair');
  try{console.log(JSON.stringify(await run({sourceDir,db:getFirestore(app)})));}
  finally{await deleteApp(app);}
 })().catch(error=>{console.error(error);process.exitCode=1;});
}
