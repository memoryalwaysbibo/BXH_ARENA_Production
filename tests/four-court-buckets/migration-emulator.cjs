'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8188');assert.equal(process.env.GCLOUD_PROJECT,'demo-bxh-four-court-buckets');
const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore,Timestamp}=require('firebase-admin/firestore'),{fixture,request}=require('./trusted-fixture.cjs');
const B=require('../../referee-seats/functions/bucket-state.cjs'),{createBucketMigrationService}=require('../../referee-seats/functions/bucket-migration-service.cjs'),{createBucketScoringHandler}=require('../../referee-seats/functions/bucket-scoring-service.cjs');
const app=initializeApp({projectId:process.env.GCLOUD_PROJECT},'bucket-migration'),db=getFirestore(app),migration=createBucketMigrationService(db),score=createBucketScoringHandler(db);
const report={kind:'reviewed-bucket-migration',productionWrites:0,cases:[]};let serial=0;
const operation=()=> 'migration-operation-'+String(++serial).padStart(8,'0');
async function seed(code,count=6){
 const f=fixture(code,count,false);delete f.room.scoreStorage;const root=db.doc('tournaments/'+code),pub=db.doc('publicTournaments/'+code);
 await root.set({...f.room,createdAt:Timestamp.fromMillis(1)});await pub.set({bracketView:JSON.stringify(f.state),updatedAt:1});
 await db.doc('systemConfig/fourCourtScoreBuckets').set({enabled:true,migrationEnabled:true});
 await db.doc('users/operator').set({active:true,role:'super_admin'});for(let n=1;n<=count;n++)await db.doc('users/ref'+n).set(f.user);
 return {root,pub,f};
}
const req=(code,action,epoch)=>({code,action,epoch,actorUid:'operator'});
async function commitPlanned(input){const plan=await migration.preflight(input);const command={...input,operationId:operation(),sourceDigest:plan.sourceDigest};return {command,result:await migration.commit(command)};}
async function current(root){const room=(await root.get()).data(),base=JSON.parse(room.data),m=B.context(room,base),snap=await root.collection('matchBuckets').get();return {room,state:B.materialize(base,m,snap.docs.map(s=>s.data()))};}
async function scored(root,id,extra){const {room,state}=await current(root),data=request(state,room,id,'score',operation(),extra);return score({auth:{uid:'ref'+data.station},data});}
(async()=>{
 const deadline=setTimeout(()=>{console.error('migration-lab-timeout');process.exit(2);},120000);
 try{
  for(const count of [6,12]){
   const code='BXH-REVIEW'+count,epoch='reviewed-epoch-'+count,{root,pub}=await seed(code,count),input=req(code,'activate',epoch),before=await root.get(),publicBefore=await pub.get();
   const plan=await migration.preflight(input);assert.equal(plan.buckets,Math.ceil(count/4));assert((await root.get()).updateTime.isEqual(before.updateTime));assert((await pub.get()).updateTime.isEqual(publicBefore.updateTime));assert.equal((await root.collection('bucketMigrationBackups').get()).size,0);
   await root.update({updatedAt:2});await assert.rejects(migration.commit({...input,operationId:operation(),sourceDigest:plan.sourceDigest}),/migration-plan-stale/);assert.equal((await root.collection('bucketMigrationBackups').get()).size,0);assert.equal((await root.collection('matchBuckets').get()).size,0);
   const activated=await commitPlanned(input),after=await root.get(),published=await pub.get();assert.equal((await migration.commit(activated.command)).replayed,true);assert((await root.get()).updateTime.isEqual(after.updateTime));assert((await pub.get()).updateTime.isEqual(published.updateTime));assert.equal((await root.collection('bucketMigrationBackups').get()).size,3);
   await assert.rejects(migration.commit({...activated.command,sourceDigest:'0'.repeat(64)}),/operation-conflict/);
   const {room,state}=await current(root);await Promise.all(state.matches.map(m=>score({auth:{uid:'ref'+m.station},data:request(state,room,m.id,'score',operation(),{side:'A',finish:'spin'})})));
   const rollback=req(code,'rollback',epoch),old=await migration.preflight(rollback);await scored(root,'m1',{side:'B',finish:'burst'});
   await assert.rejects(migration.commit({...rollback,operationId:operation(),sourceDigest:old.sourceDigest}),/migration-plan-stale/);assert.equal((await root.collection('bucketMigrationBackups').get()).size,3);
   assert(JSON.parse((await root.get()).data().data).matches.every(m=>m.scoreA===0),'root must still be stale');
   await db.doc('systemConfig/fourCourtScoreBuckets').set({enabled:false,migrationEnabled:false,productionEnabled:false});
   const restored=await commitPlanned(rollback),final=await root.get(),publicFinal=await pub.get(),privateState=JSON.parse(final.data().data),publicState=JSON.parse(publicFinal.data().bracketView);
   assert.equal(final.data().scoreStorage,undefined);assert.equal(final.data().bucketMigration,undefined);assert(final.data().createdAt.isEqual(Timestamp.fromMillis(1)));assert.equal(publicFinal.data().scoreBucketProjection,undefined);assert(privateState.matches.every(m=>m.scoreA===1));assert.equal(privateState.matches[0].scoreB,2);assert.equal(privateState.matches[0].log.length,2);assert.equal(publicState.matches[0].scoreB,2);assert.equal((await root.collection('matchBuckets').get()).size,0);
   assert.equal((await root.collection('bucketMigrationBackups').get()).size,6);assert.equal((await root.collection('bucketMigrationOperations').get()).size,2);assert.equal((await migration.commit(restored.command)).replayed,true);assert((await root.get()).updateTime.isEqual(final.updateTime));assert((await pub.get()).updateTime.isEqual(publicFinal.updateTime));
   const backup=(await root.collection('bucketMigrationBackups').doc(restored.result.operation+'-state').get()).data();assert.equal(JSON.parse(backup.data).matches[0].scoreB,2);
   await db.doc('systemConfig/fourCourtScoreBuckets').set({enabled:true,migrationEnabled:true});await assert.rejects(migration.preflight(input),/migration-epoch-used/);
   await db.doc('users/operator').update({active:false});await assert.rejects(migration.commit(restored.command),/migration-operator-required/);
   report.cases.push({courts:count,buckets:Math.ceil(count/4),preflightReadOnly:true,stalePlansRejected:true,completeBackups:6,activationReplayNoWrites:true,rollbackReplayNoWrites:true,closedScoringRollback:true,latestScoresAndLogsRestored:true,noOrphanBuckets:true,revokedOperatorRejected:true});
  }
  {
   const code='BXH-MIGRACE',epoch='race-epoch',{root}=await seed(code);await commitPlanned(req(code,'activate',epoch));const {room,state}=await current(root),rollback=req(code,'rollback',epoch),plan=await migration.preflight(rollback);
   const outcomes=await Promise.allSettled([score({auth:{uid:'ref1'},data:request(state,room,'m1','score',operation(),{side:'A',finish:'spin'})}),migration.commit({...rollback,operationId:operation(),sourceDigest:plan.sourceDigest})]);
   if(outcomes[1].status==='rejected'){assert.match(outcomes[1].reason.message,/migration-plan-stale/);await commitPlanned(rollback);}
   const restored=JSON.parse((await root.get()).data().data).matches[0];assert.equal(restored.scoreA,outcomes[0].status==='fulfilled'?1:0);assert.equal(restored.log.length,restored.scoreA);report.cases.push({name:'score-rollback-race',acceptedScorePreserved:true});
  }
  {
   const code='BXH-MIGBACK',epoch='backup-epoch',{root,pub}=await seed(code);const activated=await commitPlanned(req(code,'activate',epoch));const before=await root.get(),publicBefore=await pub.get();await root.collection('bucketMigrationBackups').doc(activated.result.operation+'-state').update({data:'tampered'});
   await assert.rejects(migration.preflight(req(code,'rollback',epoch)),/migration-backup-invalid/);assert((await root.get()).updateTime.isEqual(before.updateTime));assert((await pub.get()).updateTime.isEqual(publicBefore.updateTime));report.cases.push({name:'corrupt-backup',rejectedWithoutRoomWrites:true});
  }
  {
   const code='BXH-MIGORPH',{root,pub}=await seed(code);await root.collection('matchBuckets').doc('court-99').set({orphan:true});const before=await root.get(),publicBefore=await pub.get();await assert.rejects(migration.preflight(req(code,'activate','orphan-epoch')),/orphan-bucket-set/);assert((await root.get()).updateTime.isEqual(before.updateTime));assert((await pub.get()).updateTime.isEqual(publicBefore.updateTime));report.cases.push({name:'outside-range-orphan',rejected:true});
  }
  console.log('PASS reviewed migration: '+JSON.stringify(report));
 }finally{clearTimeout(deadline);const dir=path.resolve('test-results/four-court-buckets');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'reviewed-migration.json'),JSON.stringify(report,null,2)+'\n');await deleteApp(app);}
})().catch(error=>{console.error(error);process.exitCode=1;});
