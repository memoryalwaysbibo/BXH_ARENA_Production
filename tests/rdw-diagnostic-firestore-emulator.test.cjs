'use strict';
// P3-40: real Firestore Emulator integration for the read-only admin diagnostic.
// Uses a contract-compatible synthetic Hunter bundle, NOT deployed production reader.
// No production credentials or writes by the diagnostic request.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('Firestore emulator required');
const project=process.env.GCLOUD_PROJECT||'demo-bxh-arena-e2e';
if(!project.startsWith('demo-'))throw Error('demo project required');
const admin=require('firebase-admin');
if(!admin.apps.length)admin.initializeApp({projectId:project});
const db=admin.firestore();
const {EXPECTED_FILES}=require('../scripts/lib/rdw-hunter-bundle-loader.cjs');
const {createVerifiedHunterDiagnostic}=require('../scripts/lib/rdw-verified-hunter-diagnostic.cjs');
const stamp=Date.now();
const code='BXH-RDWP40',actor='rdw_p40_admin_'+stamp,unauthorized='rdw_p40_staff_'+stamp;
const first='rdw_p40_real_a_'+stamp,second='rdw_p40_real_b_'+stamp;
const roomRef=db.doc('tournaments/'+code);
function makeBundle(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rdw-emulator-private-reader-'));
 fs.mkdirSync(path.join(root,'vendor'));
 const files={};
 for(const file of EXPECTED_FILES)files[file]='{}';
 files['reader.cjs']="module.exports={createReader:()=>async({uid})=>({uid,version:'hunter-license-v2.1',complete:true,unresolvedIdentities:0,sourceScope:'public-official-canonical-self-history-v1',sourceDigest:'a'.repeat(64),overview:{grade:{tier:uid.includes('real_a')?'ungraded':'d'}}})};";
 const manifest={};
 for(const [file,content] of Object.entries(files)){fs.writeFileSync(path.join(root,file),content);manifest[file]=crypto.createHash('sha256').update(content).digest('hex');}
 fs.writeFileSync(path.join(root,'bundle-manifest.json'),JSON.stringify(manifest));
 return root;
}
const bundleRoot=makeBundle();
const diagnose=createVerifiedHunterDiagnostic({db,bundleRoot,clock:()=>Date.now(),enabled:true});
test.before(async()=>{
 const players=[{id:'one',uid:first},{id:'two',uid:second},...Array.from({length:6},(_,i)=>({id:'virtual_'+i}))];
 await Promise.all([
  roomRef.set({code,data:JSON.stringify({cloudCode:code,registrationRosterRevision:4,startedAt:null,rosterLocked:false,players})}),
  db.doc('users/'+actor).set({role:'admin',active:true}),
  db.doc('users/'+unauthorized).set({role:'staff',active:true}),
  db.doc('users/'+first).set({role:'player',active:true}),
  db.doc('users/'+second).set({role:'player',active:true})
 ]);
});
test.after(()=>fs.rmSync(bundleRoot,{recursive:true,force:true}));
test('Emulator allows active admin and validates 2 verified + 6 virtual without modifying room',async()=>{
 const before=(await roomRef.get()).data();
 const result=await diagnose({actorUid:actor,eventCode:code});
 assert.equal(result.ok,true);
 assert.equal(result.verifiedAccounts,2);assert.equal(result.virtualPlayers,6);
 assert.equal(result.unverifiedAccounts,0);assert.equal(result.fullSnapshotEligible,false);
 assert.deepEqual(result.formulaBands,[{rawForwardPercent:102,rawReversePercent:98,protectedForwardPercent:100,protectedReversePercent:100}]);
 assert.deepEqual((await roomRef.get()).data(),before);
 assert.ok(!JSON.stringify(result).includes(first));
 assert.ok(!JSON.stringify(result).includes(second));
});
test('Emulator refuses staff before reading any private grades',async()=>{
 const result=await diagnose({actorUid:unauthorized,eventCode:code});
 assert.deepEqual(result,{ok:false,reason:'not-authorized'});
});
test('Emulator denies revoked admin and keeps document unchanged',async()=>{
 await db.doc('users/'+actor).update({active:false});
 const result=await diagnose({actorUid:actor,eventCode:code});
 assert.deepEqual(result,{ok:false,reason:'not-authorized'});
 assert.equal((await roomRef.get()).data().data.includes('startedAt'),true);
});
