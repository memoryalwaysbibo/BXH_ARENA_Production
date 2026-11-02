'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const project='demo-bxh-four-court-buckets';assert.equal(process.env.GCLOUD_PROJECT,project);assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8188');assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9198');
const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{getAuth}=require('firebase-admin/auth'),web=require('firebase/app'),A=require('firebase/auth');
const {fixture,request}=require('./trusted-fixture.cjs'),B=require('../../referee-seats/functions/bucket-state.cjs'),{createBucketScoringHandler}=require('../../referee-seats/functions/bucket-scoring-service.cjs');
const app=initializeApp({projectId:project},'operator-cli-test'),db=getFirestore(app),auth=getAuth(app),score=createBucketScoringHandler(db),webApp=web.initializeApp({projectId:project,apiKey:'fake-emulator-key'},'operator-cli-auth'),webAuth=A.getAuth(webApp);
A.connectAuthEmulator(webAuth,'http://127.0.0.1:9198',{disableWarnings:true});
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bxh-migration-cli-')),cli=path.resolve(__dirname,'../../scripts/bucket-migration-operator.cjs'),env={...process.env,GCLOUD_PROJECT:project,GOOGLE_CLOUD_PROJECT:project};
const report={kind:'verified-migration-operator-cli',productionWrites:0,authEmulatorOnly:true,cases:[]};const tokenFiles=new Map();
function secret(name,value){const file=path.join(dir,name);fs.writeFileSync(file,value,{mode:0o600});return file;}
function run(args,ok=true){
 const result=spawnSync(process.execPath,[cli,...args],{env,encoding:'utf8',timeout:45000,maxBuffer:65536});
 const output=(result.stdout||'')+'\n'+(result.stderr||'');for(const token of tokenFiles.values())assert(!output.includes(token),'CLI exposed a credential');assert(!output.includes('"actorUid"'),'CLI exposed private review identity');
 assert.equal(result.status,ok?0:1,output);const json=(ok?result.stdout:result.stderr).trim().split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line)).at(-1);assert(json);assert.equal(json.ok,ok);return json;
}
const common=tokenFile=>['--runtime','emulator','--project',project,'--token-file',tokenFile];
function preflight(code,action,epoch,out,tokenFile){return run(['preflight',...common(tokenFile),'--action',action,'--code',code,'--epoch',epoch,'--out',out]);}
function commit(file,review,tokenFile,ok=true,digest=review.reviewDigest){return run(['commit',...common(tokenFile),'--plan',file,'--expect-digest',digest],ok);}
(async()=>{
 try{
  await A.setPersistence(webAuth,A.inMemoryPersistence);
  for(const uid of ['cli-op','cli-other','cli-player','cli-disabled']){await auth.createUser({uid,email:uid+'@operator.invalid',password:'Emulator-only-operator-2026'});await db.doc('users/'+uid).set({active:true,role:uid==='cli-player'?'player':'super_admin'});const signed=await A.signInWithEmailAndPassword(webAuth,uid+'@operator.invalid','Emulator-only-operator-2026');tokenFiles.set(uid,await signed.user.getIdToken());}
  const operatorToken=secret('operator-token',tokenFiles.get('cli-op')),otherToken=secret('other-token',tokenFiles.get('cli-other')),playerToken=secret('player-token',tokenFiles.get('cli-player')),disabledToken=secret('disabled-token',tokenFiles.get('cli-disabled'));
  await auth.updateUser('cli-disabled',{disabled:true});
  for(const count of [6,12]){
   const code='BXH-OPCLI'+count,epoch='operator-cli-epoch-'+count,f=fixture(code,count,false);delete f.room.scoreStorage;
   const root=db.doc('tournaments/'+code),pub=db.doc('publicTournaments/'+code);await root.set(f.room);await pub.set({bracketView:JSON.stringify(f.state),updatedAt:1});await db.doc('systemConfig/fourCourtScoreBuckets').set({enabled:true,migrationEnabled:true});for(let n=1;n<=count;n++)await db.doc('users/ref'+n).set(f.user);
   const before=await root.get(),publicBefore=await pub.get(),file=path.join(dir,'activation-'+count+'.json');
   const planned=preflight(code,'activate',epoch,file,operatorToken),review=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(review.actorUid,'cli-op');assert.equal(review.plan.buckets,Math.ceil(count/4));assert.equal(fs.statSync(file).mode&0o077,0);assert(!fs.readFileSync(file,'utf8').includes(tokenFiles.get('cli-op')));
   assert.equal(run(['inspect','--plan',file]).reviewDigest,planned.reviewDigest);assert((await root.get()).updateTime.isEqual(before.updateTime));assert((await pub.get()).updateTime.isEqual(publicBefore.updateTime));assert.equal((await root.collection('bucketMigrationBackups').get()).size,0);
   assert.equal(commit(file,review,operatorToken,false,'0'.repeat(64)).reason,'migration-review-mismatch');assert.equal(commit(file,review,otherToken,false).reason,'migration-review-identity-mismatch');
   const disabled=run(['preflight',...common(disabledToken),'--action','activate','--code',code,'--epoch',epoch,'--out',path.join(dir,'disabled-'+count)],false);assert.match(disabled.reason,/^auth\/(user-disabled|id-token-revoked)$/);
   assert.equal(run(['preflight',...common(playerToken),'--action','activate','--code',code,'--epoch',epoch,'--out',path.join(dir,'player-'+count)],false).reason,'migration-operator-required');
   assert.equal(run(['preflight',...common(playerToken),'--action','activate','--code',code,'--epoch',epoch,'--out',path.join(dir,'forged-'+count),'--actor-uid','cli-op'],false).reason,'invalid-operator-arguments');
   const modified=secret('modified-'+count+'.json',JSON.stringify({...review,plan:{...review.plan,code:'BXH-FORGED6'}}));assert.equal(commit(modified,review,operatorToken,false).reason,'migration-review-tampered');
   assert.equal(run(['preflight',...common(operatorToken),'--action','activate','--code',code,'--epoch',epoch,'--out',file],false).reason,'review-file-not-created');assert.equal(fs.readFileSync(file,'utf8'),JSON.stringify(review,null,2)+'\n');
   assert((await root.get()).updateTime.isEqual(before.updateTime));assert((await pub.get()).updateTime.isEqual(publicBefore.updateTime));
   const activated=commit(file,review,operatorToken),active=await root.get(),publicActive=await pub.get();assert.equal(activated.replayed,false);assert.equal(commit(file,review,operatorToken).replayed,true);assert((await root.get()).updateTime.isEqual(active.updateTime));assert((await pub.get()).updateTime.isEqual(publicActive.updateTime));assert.equal((await root.collection('bucketMigrationBackups').get()).size,3);
   const room=active.data(),state=B.materialize(JSON.parse(room.data),room.scoreStorage,(await root.collection('matchBuckets').get()).docs.map(s=>s.data()));await score({auth:{uid:'ref1'},data:request(state,room,'m1','score','operator-score-operation-'+count,{side:'A',finish:'spin'})});
   await db.doc('systemConfig/fourCourtScoreBuckets').set({enabled:false,migrationEnabled:false});const rollbackFile=path.join(dir,'rollback-'+count+'.json');preflight(code,'rollback',epoch,rollbackFile,operatorToken);const rollback=JSON.parse(fs.readFileSync(rollbackFile,'utf8'));commit(rollbackFile,rollback,operatorToken);const restored=await root.get(),publicRestored=await pub.get();assert.equal(restored.data().scoreStorage,undefined);assert.equal(JSON.parse(restored.data().data).matches[0].scoreA,1);assert.equal(JSON.parse(restored.data().data).matches[0].log.length,1);assert.equal((await root.collection('matchBuckets').get()).size,0);
   assert.equal(commit(rollbackFile,rollback,operatorToken).replayed,true);assert((await root.get()).updateTime.isEqual(restored.updateTime));assert((await pub.get()).updateTime.isEqual(publicRestored.updateTime));
   report.cases.push({courts:count,buckets:Math.ceil(count/4),realAuthTokenVerified:true,disabledAuthUserDenied:true,playerDenied:true,manualUidDenied:true,otherOperatorDenied:true,changedReviewDenied:true,preflightReadOnly:true,existingReviewNotOverwritten:true,cliActivationAndReplay:true,closedScoringCliRollback:true,latestScorePreserved:true,cliRollbackReplayNoWrites:true,credentialsNotLogged:true});
  }
  console.log('PASS verified migration CLI: '+JSON.stringify(report));
 }finally{fs.rmSync(dir,{recursive:true,force:true});const out=path.resolve('test-results/four-court-buckets');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'verified-operator-cli.json'),JSON.stringify(report,null,2)+'\n');await web.deleteApp(webApp);await deleteApp(app);}
})().catch(error=>{console.error(error);process.exitCode=1;});
