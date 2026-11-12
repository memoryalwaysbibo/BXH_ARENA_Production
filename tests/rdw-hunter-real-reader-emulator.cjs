'use strict';
// Manually invoked REAL Hunter Reader Emulator acceptance harness.
// REQUIRED: audited backend source tree, independently acquired by operator.
// This does NOT run in automatic CI and does NOT attest deployed revision.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {SOURCE,gitBlobHash}=require('../scripts/lib/rdw-hunter-source-attestation.cjs');
const {createReadOnlyTierResolver}=require('../scripts/lib/rdw-hunter-readonly-bridge.cjs');
function validateSourceDir(dir){
 if(typeof dir!=='string'||!path.isAbsolute(dir))throw Error('absolute-hunter-source-dir-required');
 const root=fs.realpathSync(dir);
 const checked=[];
 for(const [filename,expected] of Object.entries(SOURCE.candidateGitBlobs)){
  const filenameOnDisk=path.resolve(root,filename);
  const real=fs.realpathSync(filenameOnDisk);
  if(!real.startsWith(root+path.sep))throw Error('source-path-escape:'+filename);
  const bytes=fs.readFileSync(real);
  if(gitBlobHash(bytes)!==expected)throw Error('source-blob-mismatch:'+filename);
  checked.push(filename);
 }
 return {root,checked};
}
async function run({sourceDir,db,uid,clock=()=>Date.now()}){
 if(!process.env.FIRESTORE_EMULATOR_HOST||!process.env.FIREBASE_AUTH_EMULATOR_HOST)
  throw Error('auth-and-firestore-emulators-required');
 if(!db||typeof db.runTransaction!=='function')throw Error('emulator-db-required');
 if(typeof uid!=='string'||!uid.startsWith('rdw-realreader-test-'))throw Error('isolated-fixture-uid-required');
 const verified=validateSourceDir(sourceDir);
 const {createReader}=require(path.join(verified.root,'reader.cjs'));
 if(typeof createReader!=='function')throw Error('real-reader-export-missing');
 const protectedPaths=[
  'users/'+uid+'/hunterLicense/highest',
  'hunterLicenseAwards/rdw-realreader-fixture',
  'rdwFixtureLadder/'+uid,
  'rdwFixtureXp/'+uid
 ];
 const before=await db.getAll(...protectedPaths.map(p=>db.doc(p)));
 const snapshot=before.map(d=>({exists:d.exists,value:d.data()||null}));
 const resolver=createReadOnlyTierResolver({db,createReader,clock});
 const result=await resolver(uid);
 if(!result.ok)throw Error('real-reader-evaluation-incomplete:'+result.reason);
 const after=await db.getAll(...protectedPaths.map(p=>db.doc(p)));
 assert.deepEqual(after.map(d=>({exists:d.exists,value:d.data()||null})),snapshot);
 return {ok:true,mode:'real-source-emulator-only',tier:result.tier,
  checkedFiles:verified.checked.length,releaseApproved:false,liveDeploymentVerified:false};
}
module.exports={validateSourceDir,run};
if(require.main===module){
 (async()=>{
  const sourceDir=process.env.HUNTER_READER_SOURCE_DIR;
  if(!sourceDir)throw Error('HUNTER_READER_SOURCE_DIR-required');
  const deps=path.resolve(__dirname,'../hunter-clash/arena');
  const sdk=name=>require(require.resolve(name,{paths:[deps]}));
  const {initializeApp,deleteApp}=sdk('firebase-admin/app');
  const {getFirestore}=sdk('firebase-admin/firestore');
  const app=initializeApp({projectId:'demo-rdw-real-reader'},'rdw-real-reader');
  try{
   const db=getFirestore(app),uid='rdw-realreader-test-a';
   await db.doc('users/'+uid).set({active:true,role:'player'});
   // No public events: genuine Reader must evaluate an ungraded account.
   const evidence=await run({sourceDir,db,uid});
   assert.equal(evidence.tier,'ungraded');
   process.stdout.write(JSON.stringify(evidence)+'\n');
  }finally{await deleteApp(app);}
 })().catch(e=>{console.error(e);process.exitCode=1;});
}
