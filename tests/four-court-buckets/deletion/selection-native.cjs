'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const project='demo-bxh-bucket-delete-native';
assert.equal(process.env.GCLOUD_PROJECT,project);
assert(/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''));
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
// The SDK's explicit project and host stay fixed to the loopback demo project.
// Only the callable's production guard sees the synthetic request environment.
const app=initializeApp({projectId:project}),db=getFirestore(app);
db.settings({host:process.env.FIRESTORE_EMULATOR_HOST,ssl:false});
process.env.GCLOUD_PROJECT='bxh-arena';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'bucket-delete-native-'));
fs.cpSync(path.join(__dirname,'fixtures/selection'),temporary,{recursive:true});
const release=path.resolve(__dirname,'../../../release/buckets/deletion');
for(const name of ['registration-selection.js','tournament-delete.js','tournament-delete-core.js','hosting-core.js'])fs.copyFileSync(path.join(release,name),path.join(temporary,name));
const selector=require(path.join(temporary,'registration-selection.js')).manageRegistrationSelection.run;
const ordinary=require(path.join(temporary,'tournament-delete.js')).deleteTournamentSafely.run;
const code='BXH-NATIVE01',uid='operator',operationId='native-delete-operation';
const request=(op=operationId)=>({auth:{uid},data:{code,operationId:op,action:'delete'}});
const collections=['tournaments','publicTournaments','users','tournamentDeletionAudit','tournamentActivity','eventStaffAssignments','hostCompletionLedger','hostStats'];
async function clear(){for(const name of collections)await db.recursiveDelete(db.collection(name));}
async function seed(){await clear();const batch=db.batch(),data={meta:{formatType:'single'},players:[],matches:[]};
 batch.set(db.doc('users/'+uid),{active:true,role:'super_admin'});
 batch.set(db.doc('tournaments/'+code),{createdBy:'host',eventAuthority:'official',data:JSON.stringify(data),registrationSelection:{status:'open',capacity:4}});
 batch.set(db.doc('publicTournaments/'+code),{bracketView:JSON.stringify(data)});
 batch.set(db.doc('tournaments/'+code+'/registrations/a'),{status:'pending_draw'});
 await batch.commit();
}
(async()=>{let checks=0;const nativeRecursive=db.recursiveDelete.bind(db);
 try{
  for(const marker of ['scoreStorage','scoreBucketProjection','bucketMigration','deletionStatus'])for(const value of [null,false,{},'unknown',{status:'active'}])for(const side of ['tournaments','publicTournaments']){
   await seed();await db.doc(side+'/'+code).update({[marker]:value});
   const refs=[db.doc('tournaments/'+code),db.doc('publicTournaments/'+code)];const before=await db.getAll(...refs);
   await assert.rejects(selector(request()),/bucket-scoring-required|bucket-migration-in-progress|deletion-in-progress/);
   const after=await db.getAll(...refs);assert(before.every((s,i)=>s.updateTime.isEqual(after[i].updateTime)));
   assert.equal((await db.collection('tournamentDeletionAudit').get()).size,0);checks++;
  }
  await seed();let releaseGate,enter;const entered=new Promise(r=>enter=r),gate=new Promise(r=>releaseGate=r);
  db.recursiveDelete=async ref=>{assert(ref.path!=='tournaments/'+code);enter();await gate;return nativeRecursive(ref);};
  const first=selector(request());await entered;
  const pending=await ordinary(request('other-ordinary-operation'));assert(pending.pending);assert.equal(pending.operationId,operationId);
  const root=await db.doc('tournaments/'+code).get();assert.equal(root.data().bucketMigration.status,'deleting');assert.equal(root.data().systemClosed,true);
  releaseGate();assert((await first).deleted);db.recursiveDelete=nativeRecursive;checks++;
  assert(!(await db.doc('tournaments/'+code).get()).exists);assert(!(await db.doc('publicTournaments/'+code).get()).exists);
  assert.equal((await db.doc('tournamentDeletionAudit/'+operationId).get()).data().workerStatus,'completed');assert((await selector(request())).replayed);checks++;
  await db.doc('tournaments/'+code).set({data:'reused room'});await assert.rejects(selector(request()),/deletion-operation-outdated/);assert.equal((await db.doc('tournaments/'+code).get()).data().data,'reused room');checks++;
  await seed();db.recursiveDelete=async()=>{throw Error('synthetic settled RPC failure');};
  await assert.rejects(selector(request()),/synthetic settled RPC failure/);db.recursiveDelete=nativeRecursive;
  assert.equal((await db.doc('tournamentDeletionAudit/'+operationId).get()).data().workerStatus,'paused');assert((await ordinary(request('recover-via-ordinary'))).deleted);checks++;
  console.log(JSON.stringify({nativeDeletionChecks:checks,project,productionRequests:0,productionWrites:0,scope:'native SDK/transactions; synthetic request auth, real captured QR proxy'}));
 }finally{db.recursiveDelete=nativeRecursive;await clear();await db.terminate();await deleteApp(app);fs.rmSync(temporary,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
