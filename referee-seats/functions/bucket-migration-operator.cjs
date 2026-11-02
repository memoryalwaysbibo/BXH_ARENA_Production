'use strict';
const {randomUUID}=require('node:crypto'),P=require('./bucket-migration-plan.cjs'),{createBucketMigrationService,checkRuntime}=require('./bucket-migration-service.cjs');
const SCHEMA='bxh-bucket-migration-review-v1',hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function keys(value,allowed){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>allowed.includes(k));}
function checkEnvironment(projectId,runtime,env){
 if(typeof projectId!=='string'||!/^[a-z][a-z0-9-]{4,62}$/.test(projectId)||env.GCLOUD_PROJECT!==projectId||env.GOOGLE_CLOUD_PROJECT&&env.GOOGLE_CLOUD_PROJECT!==projectId)throw Error('bucket-project-mismatch');
 checkRuntime({projectId},{runtime,env});
 if(runtime==='emulator'&&env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9198')throw Error('operator-auth-emulator-mismatch');
}
function validateReview(value){
 const fields=['schema','projectId','actorUid','operationId','plan','reviewDigest'];
 if(!keys(value,fields)||Object.keys(value).length!==fields.length||value.schema!==SCHEMA||typeof value.projectId!=='string'||!/^[a-z][a-z0-9-]{4,62}$/.test(value.projectId)||typeof value.actorUid!=='string'||!value.actorUid||value.actorUid.length>128||/[\/\x00-\x1f]/.test(value.actorUid)||!/^[-a-zA-Z0-9]{16,80}$/.test(value.operationId||'')||!hex(value.reviewDigest))throw Error('invalid-migration-review');
 const p=value.plan;
 if(!keys(p,['version','action','code','epoch','roomId','courts','buckets','versions','sourceDigest','bytes'])||p.version!==1||!['activate','rollback'].includes(p.action)||!/^BXH-[A-Z0-9]{4,16}$/.test(p.code||'')||!/^[-a-zA-Z0-9]{1,100}$/.test(p.epoch||'')||typeof p.roomId!=='string'||!p.roomId||p.roomId.length>256||!Number.isSafeInteger(p.courts)||p.courts<1||p.courts>400||p.buckets!==Math.ceil(p.courts/4)||!Number.isSafeInteger(p.bytes)||p.bytes<0||p.bytes>5000000||!hex(p.sourceDigest))throw Error('invalid-migration-review');
 const v=p.versions,stamp=t=>typeof t==='string'&&/^-?[0-9]+:[0-9]{1,9}$/.test(t);
 if(!keys(v,['root','public','release','backups'])||!stamp(v.root)||!stamp(v.public)||v.release!==null&&!stamp(v.release)||v.backups!==undefined&&(!Array.isArray(v.backups)||v.backups.length!==4||!v.backups.every(stamp)))throw Error('invalid-migration-review');
 const {reviewDigest,...content}=value;if(P.digest(content)!==reviewDigest)throw Error('migration-review-tampered');return value;
}
function createBucketMigrationOperator({db,auth,projectId,runtime='production',env=process.env,operationId=randomUUID,serviceFactory=createBucketMigrationService}){
 checkEnvironment(projectId,runtime,env);if(db.projectId!==projectId||typeof auth?.verifyIdToken!=='function')throw Error('bucket-project-mismatch');
 let service;
 async function identity(token){
  checkEnvironment(projectId,runtime,env);
  if(typeof token!=='string'||!token||token.length>16384)throw Error('operator-token-required');
  const claims=await auth.verifyIdToken(token,true);
  if(typeof claims?.uid!=='string'||!claims.uid||claims.sub!==claims.uid||claims.aud!==projectId||claims.iss!=='https://securetoken.google.com/'+projectId)throw Error('operator-token-project-mismatch');
  return claims.uid;
 }
 function getService(){return service||(service=serviceFactory(db,{runtime,env}));}
 return {
  async preflight(request){
   if(!keys(request,['token','action','code','epoch']))throw Error('invalid-operator-request');
   const actorUid=await identity(request.token),plan=await getService().preflight({action:request.action,code:request.code,epoch:request.epoch,actorUid});
   const review={schema:SCHEMA,projectId,actorUid,operationId:operationId(),plan};return validateReview({...review,reviewDigest:P.digest(review)});
  },
  async commit(request){
   if(!keys(request,['token','review','expectedDigest']))throw Error('invalid-operator-request');
   const review=validateReview(request.review);
   if(review.projectId!==projectId)throw Error('bucket-project-mismatch');
   if(!hex(request.expectedDigest)||review.reviewDigest!==request.expectedDigest)throw Error('migration-review-mismatch');
   const actorUid=await identity(request.token);if(actorUid!==review.actorUid)throw Error('migration-review-identity-mismatch');
   return getService().commit({action:review.plan.action,code:review.plan.code,epoch:review.plan.epoch,actorUid,operationId:review.operationId,sourceDigest:review.plan.sourceDigest});
  }
 };
}
module.exports={createBucketMigrationOperator,validateReview,checkEnvironment};
