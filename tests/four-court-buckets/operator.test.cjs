'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const O=require('../../referee-seats/functions/bucket-migration-operator.cjs'),CLI=require('../../scripts/bucket-migration-operator.cjs');
function setup(){
 const projectId='demo-bxh-four-court-buckets',env={GCLOUD_PROJECT:projectId,FIRESTORE_EMULATOR_HOST:'127.0.0.1:8188',FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9198'},calls=[],verified=[];let uid='verified-user',built=0;
 const auth={verifyIdToken:async(token,revoked)=>{verified.push({token,revoked});return {uid,sub:uid,aud:projectId,iss:'https://securetoken.google.com/'+projectId};}};
 const plan={version:1,action:'activate',code:'BXH-OPT6',epoch:'operator-epoch',roomId:'operator-room',courts:6,buckets:2,versions:{root:'1:0',public:'1:0',release:'1:0'},sourceDigest:'1'.repeat(64),bytes:1000};
 const serviceFactory=()=>{built++;return {preflight:async request=>{calls.push(request);return plan;},commit:async request=>{calls.push(request);return {ok:true,...request};}};};
 const operator=O.createBucketMigrationOperator({db:{projectId},auth,projectId,runtime:'emulator',env,operationId:()=> 'operator-operation-0001',serviceFactory});
 return {operator,plan,projectId,env,calls,verified,built:()=>built,setUid:next=>uid=next};
}
test('operator derives identity only from verified project ID token and always checks revocation',async()=>{
 const h=setup();const review=await h.operator.preflight({token:'secret-token',action:'activate',code:h.plan.code,epoch:h.plan.epoch});assert.equal(review.actorUid,'verified-user');assert.deepEqual(h.verified,[{token:'secret-token',revoked:true}]);assert.equal(h.calls[0].actorUid,'verified-user');
 await assert.rejects(h.operator.preflight({token:'secret-token',actorUid:'forged',action:'activate',code:h.plan.code,epoch:h.plan.epoch}),/invalid-operator-request/);
 const first=await h.operator.commit({token:'secret-token',review,expectedDigest:review.reviewDigest});const second=await h.operator.commit({token:'new-token',review,expectedDigest:review.reviewDigest});assert(first.ok&&second.ok);assert.deepEqual(h.calls[1],h.calls[2]);assert.equal(h.calls[1].operationId,review.operationId);
});
test('changed review or wrong expected digest cannot reach identity verification or the migration service',async()=>{
 const h=setup(),review=await h.operator.preflight({token:'token',action:'activate',code:h.plan.code,epoch:h.plan.epoch}),before=h.verified.length;
 await assert.rejects(h.operator.commit({token:'token',review:{...review,plan:{...review.plan,code:'BXH-OTHER6'}},expectedDigest:review.reviewDigest}),/migration-review-tampered/);
 await assert.rejects(h.operator.commit({token:'token',review,expectedDigest:'0'.repeat(64)}),/migration-review-mismatch/);assert.equal(h.verified.length,before);assert.equal(h.calls.length,1);
});
test('another valid identity cannot commit a review produced by the original operator',async()=>{
 const h=setup(),review=await h.operator.preflight({token:'token',action:'activate',code:h.plan.code,epoch:h.plan.epoch});h.setUid('another-user');await assert.rejects(h.operator.commit({token:'other-token',review,expectedDigest:review.reviewDigest}),/migration-review-identity-mismatch/);assert.equal(h.calls.length,1);
});
test('project issuer, environment and Auth Emulator boundaries fail closed',async()=>{
 const h=setup();assert.throws(()=>O.checkEnvironment(h.projectId,'emulator',{...h.env,FIREBASE_AUTH_EMULATOR_HOST:'localhost:9198'}),/operator-auth-emulator-mismatch/);
 assert.throws(()=>O.checkEnvironment(h.projectId,'emulator',{...h.env,GCLOUD_PROJECT:'other'}),/bucket-project-mismatch/);
 let built=0;const bad=O.createBucketMigrationOperator({db:{projectId:h.projectId},auth:{verifyIdToken:async()=>({uid:'u',sub:'u',aud:'other',iss:'other'})},projectId:h.projectId,runtime:'emulator',env:h.env,serviceFactory:()=>{built++;}});await assert.rejects(bad.preflight({token:'token',action:'activate',code:h.plan.code,epoch:h.plan.epoch}),/operator-token-project-mismatch/);assert.equal(built,0);
});
test('credential/review files require private ownership/permissions and reject symlinks; summaries redact identity and token',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bxh-operator-unit-'));try{
  const file=path.join(dir,'credential');fs.writeFileSync(file,'test-token',{mode:0o600});assert.equal(CLI.readSecure(file,100),'test-token');fs.chmodSync(file,0o644);assert.throws(()=>CLI.readSecure(file,100),/unsafe-operator-file/);fs.chmodSync(file,0o600);fs.symlinkSync(file,path.join(dir,'link'));assert.throws(()=>CLI.readSecure(path.join(dir,'link'),100),/operator-file-unreadable|unsafe-operator-file/);
  const h=setup(),review=await h.operator.preflight({token:'secret-token',action:'activate',code:h.plan.code,epoch:h.plan.epoch}),summary=JSON.stringify(CLI.summary(review,'inspect'));assert(!summary.includes('secret-token'));assert(!summary.includes('verified-user'));assert(!summary.includes('actorUid'));assert.equal(CLI.reason(Error('backend secret-token details')),'migration-operator-failed');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('real CLI refuses a closed production environment before reading a token or initializing Firebase',()=>{
 const env={...process.env,GCLOUD_PROJECT:'bxh-operator-guard',GOOGLE_CLOUD_PROJECT:'bxh-operator-guard'};delete env.BXH_BUCKET_MIGRATION_ENABLED;
 const result=spawnSync(process.execPath,[path.resolve(__dirname,'../../scripts/bucket-migration-operator.cjs'),'preflight','--runtime','production','--project','bxh-operator-guard','--token-file','must-not-read','--action','activate','--code','BXH-OPT6','--epoch','epoch','--out','must-not-create'],{env,encoding:'utf8'});
 assert.equal(result.status,1);assert.equal(JSON.parse(result.stderr).reason,'migration-runtime-disabled');assert.equal(result.stdout,'');
 assert.throws(()=>CLI.parse(['preflight','--actor-uid','forged']),/invalid-operator-arguments/);
});
