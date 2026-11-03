'use strict';
const {onCall,HttpsError}=require('firebase-functions/v2/https');
// Explicit, authorized deletion owns its audit/lease checks; use native transactions
// so the generic QR attendance transaction proxy cannot reject the final audited delete.
const {getFirestore,FieldValue}=require('firebase-admin/firestore');
const {createHash,randomUUID}=require('node:crypto');
const {completion}=require('./hosting-core');
const {canDeleteTournament}=require('./tournament-delete-core');
const REGION='asia-east1';
function createDeletionService({authorize=canDeleteTournament,allowOrphanCleanup=true,normalize,validOperation}={}){
const db=getFirestore();
const CODE_PATTERN=/^BXH-[A-Z0-9_-]{4,24}$/,OPERATION_PATTERN=/^[A-Za-z0-9_-]{8,100}$/;
function fail(status,message){throw new HttpsError(status,message);}
const has=(o,k)=>!!o&&Object.prototype.hasOwnProperty.call(o,k);
const marked=o=>has(o,'scoreStorage')||has(o,'scoreBucketProjection');
function normalizeCode(value){const code=String(value||'').trim().toUpperCase();if(!CODE_PATTERN.test(code))fail('invalid-argument','invalid-code');return code;}
function identity(snapshot){
 if(!snapshot.exists)return 'absent';
 const time=snapshot.createTime;
 if(!Number.isSafeInteger(time?.seconds)||!Number.isSafeInteger(time?.nanoseconds))fail('failed-precondition','deletion-document-identity-missing');
 return time.seconds+':'+time.nanoseconds;
}
const token=(uid,operationId,created)=>createHash('sha256').update(JSON.stringify([uid,operationId,created])).digest('hex');
const own=(marker,expected)=>marker?.version===1&&marker.status==='deleting'&&marker.token===expected;
function actorValid(snapshot){return snapshot.exists&&snapshot.data()?.active===true;}
normalize=normalize||normalizeCode;validOperation=validOperation||OPERATION_PATTERN;
async function claim({uid,code,operationId}){
 const root=db.doc('tournaments/'+code),pub=db.doc('publicTournaments/'+code),activity=db.doc('tournamentActivity/'+code),requestAudit=db.doc('tournamentDeletionAudit/'+operationId);
 let observed;const workerToken=randomUUID();
 return db.runTransaction(async tx=>{
  const [r,p,u,a,buckets]=await Promise.all([tx.get(root),tx.get(pub),tx.get(db.doc('users/'+uid)),tx.get(requestAudit),tx.get(root.collection('matchBuckets').limit(1))]);
  if(!actorValid(u))fail('permission-denied','inactive-account');
  const profile=u.data(),t=r.exists?r.data():{},publicData=p.exists?p.data():{};let existing=a.exists?a.data():null,audit=requestAudit,effectiveOperationId=operationId;
  const created=identity(r);if(observed===undefined)observed=created;else if(observed!==created)fail('failed-precondition','deletion-room-changed');
  if(existing&&(existing.code!==code||existing.actorUid!==uid))fail('failed-precondition','operation-conflict');
  if(marked(t)||marked(publicData)||buckets.docs.length)fail('failed-precondition','bucket-scoring-required');
  if(existing?.status==='completed'){
   if(r.exists||p.exists)fail('failed-precondition','deletion-operation-outdated');
   return {orphan:true,result:{ok:true,deleted:true,code,replayed:true}};
  }
  if(!r.exists){
   if(!allowOrphanCleanup||!['super_admin','admin'].includes(profile.role)||profile.isTestAccount===true)fail('not-found','tournament-not-found');
   if(has(publicData,'bucketMigration')||has(publicData,'deletionStatus')||publicData.registrationSelection?.status==='deleting')fail('failed-precondition','deletion-orphan-lease-requires-review');
   if(p.exists)tx.delete(pub);tx.delete(activity);
   tx.set(audit,{code,actorUid:uid,actorRole:profile.role,status:'completed',deletedAt:FieldValue.serverTimestamp(),orphanCleanup:true});
   return {orphan:true,result:{ok:true,deleted:true,code,replayed:true}};
  }
  // The same authorized operator may recover a paused operation after losing
  // the response or local storage. An active worker is never started twice.
  const prior=t.bucketMigration;
  if(prior?.version===1&&prior.status==='deleting'&&prior.actorUid===uid&&prior.sourceCreatedAt===created&&/^[A-Za-z0-9_-]{1,100}$/.test(prior.operationId||'')&&prior.operationId!==operationId){
   if(existing)fail('failed-precondition','operation-conflict');
   effectiveOperationId=prior.operationId;audit=db.doc('tournamentDeletionAudit/'+effectiveOperationId);
   const canonical=await tx.get(audit);existing=canonical.exists?canonical.data():null;
   if(!existing||existing.actorUid!==uid||existing.code!==code)fail('failed-precondition','operation-conflict');
  }
  const leaseToken=token(uid,effectiveOperationId,created);
  // An old selector worker may still be traversing children outside a lease.
  // Never adopt that job or delete/reuse its parent without operator review.
  if([t,publicData].some(doc=>doc.registrationSelection?.status==='deleting')&&!own(t.bucketMigration,leaseToken))fail('failed-precondition','deletion-legacy-worker-requires-review');
  if(existing&&(existing.sourceCreatedAt!==created||existing.leaseToken!==leaseToken||existing.status!=='deleting'))fail('failed-precondition','operation-conflict');
  for(const doc of [t,publicData])if(has(doc,'bucketMigration')&&!own(doc.bucketMigration,leaseToken))fail('failed-precondition','bucket-migration-in-progress');
  if([t,publicData].some(doc=>has(doc,'deletionStatus')&&!(doc.deletionStatus?.kind==='legacy-delete'&&doc.deletionStatus.token===leaseToken)))fail('failed-precondition','deletion-in-progress');
  if(!authorize(profile,uid,t,Date.now(),publicData))fail('permission-denied','tournament-delete-denied');
  if(existing?.workerStatus==='active')return {pending:true,result:{ok:false,deleted:false,pending:true,code,operationId:effectiveOperationId}};
  if(existing&&existing.workerStatus!=='paused')fail('failed-precondition','deletion-worker-requires-review');
  const previousClosed=own(t.bucketMigration,leaseToken)?t.bucketMigration.previousSystemClosed:t.systemClosed===true;
  const privateLease={version:1,status:'deleting',token:leaseToken,sourceCreatedAt:created,actorUid:uid,operationId:effectiveOperationId,previousSystemClosed:previousClosed};
  // Public marker deliberately contains no operator UID, operation ID or backup.
  const publicLease={version:1,status:'deleting',token:leaseToken};
  tx.update(root,{bucketMigration:privateLease,deletionStatus:{kind:'legacy-delete',token:leaseToken},systemClosed:true,registrationEnabled:false});
  if(p.exists)tx.update(pub,{bucketMigration:publicLease,systemClosed:true,registrationEnabled:false});
  tx.set(audit,{code,actorUid:uid,actorRole:profile.role,status:'deleting',leaseToken,sourceCreatedAt:created,workerStatus:'active',workerToken,startedAt:existing?.startedAt||FieldValue.serverTimestamp()});
  return {root,pub,activity,audit,leaseToken,workerToken,operationId:effectiveOperationId,created,profile,tournament:{...t,systemClosed:previousClosed},publicExisted:p.exists};
 });
}
async function preserveCompletedHostRecord(code,tournament){
 const ownerUid=tournament.createdBy;if(typeof ownerUid!=='string'||!ownerUid||ownerUid.includes('/'))return false;
 const owner=await db.doc('users/'+ownerUid).get(),summary=completion(tournament,owner.exists?owner.data():null);if(!summary)return false;
 return db.runTransaction(async tx=>{
  const ledger=db.doc('hostCompletionLedger/'+code),existing=await tx.get(ledger);if(existing.exists)return false;
  tx.create(ledger,{...summary,ownerUid,eventCode:code,verifiedAt:FieldValue.serverTimestamp()});
  tx.set(db.doc('hostStats/'+ownerUid),{completedHostedCount:FieldValue.increment(1),updatedAt:FieldValue.serverTimestamp()},{merge:true});return true;
 });
}
async function assertLease(job){
 const [r,p,a]=await Promise.all([job.root.get(),job.pub.get(),job.audit.get()]);
 if(!a.exists||a.data().status!=='deleting'||a.data().workerStatus!=='active'||a.data().workerToken!==job.workerToken)fail('failed-precondition','deletion-worker-lost');
 if(!r.exists||identity(r)!==job.created||marked(r.data())||!own(r.data().bucketMigration,job.leaseToken)||r.data().systemClosed!==true||r.data().registrationEnabled!==false)fail('failed-precondition','deletion-lease-lost');
 if(p.exists&&(marked(p.data())||!own(p.data().bucketMigration,job.leaseToken)))fail('failed-precondition','deletion-public-lease-lost');
}
async function deleteChildren(job){
 // Hold the parent throughout traversal. Never recursively delete the parent.
 for(let pass=0;pass<3;pass++){
  await assertLease(job);
  const collections=await job.root.listCollections();if(!collections.length)return;
  for(const collection of collections){await assertLease(job);if(collection.id==='matchBuckets')fail('failed-precondition','bucket-scoring-required');await db.recursiveDelete(collection);}
 }
 if((await job.root.listCollections()).length)fail('failed-precondition','deletion-children-still-present');
}
async function deleteEventStaffAssignments(code,job){
 const snapshot=await db.collection('eventStaffAssignments').where('eventCode','==',code).get();
 for(let offset=0;offset<snapshot.docs.length;offset+=400){
  await assertLease(job);const batch=db.batch();snapshot.docs.slice(offset,offset+400).forEach(doc=>batch.delete(doc.ref));await batch.commit();
 }
 return snapshot.size;
}
async function finish(job,{uid,code,operationId,hostRecordPreserved,assignmentCount}){
 return db.runTransaction(async tx=>{
  const [r,p,u,a]=await Promise.all([tx.get(job.root),tx.get(job.pub),tx.get(db.doc('users/'+uid)),tx.get(job.audit)]);
  if(!actorValid(u)||!r.exists||!authorize(u.data(),uid,r.data(),Date.now(),p.exists?p.data():{}))fail('permission-denied','tournament-delete-denied');
  if(identity(r)!==job.created||marked(r.data())||!own(r.data().bucketMigration,job.leaseToken)||r.data().systemClosed!==true||r.data().registrationEnabled!==false||!a.exists||a.data().leaseToken!==job.leaseToken||a.data().status!=='deleting'||a.data().workerStatus!=='active'||a.data().workerToken!==job.workerToken)fail('failed-precondition','deletion-lease-lost');
  if(p.exists&&(marked(p.data())||!own(p.data().bucketMigration,job.leaseToken)))fail('failed-precondition','deletion-public-lease-lost');
  tx.delete(job.root);if(p.exists)tx.delete(job.pub);tx.delete(job.activity);
  tx.set(job.audit,{status:'completed',workerStatus:'completed',hostRecordPreserved,deletedAt:FieldValue.serverTimestamp(),eventStaffAssignmentsDeleted:assignmentCount},{merge:true});
  return {ok:true,deleted:true,code,hostRecordPreserved};
 });
}
async function pause(job){
 // Only release this worker after every awaited deletion RPC has settled.
 // A killed/timed-out process leaves an active lease for operator review;
 // it is never automatically stolen based only on elapsed wall-clock time.
 return db.runTransaction(async tx=>{
  const [r,a]=await Promise.all([tx.get(job.root),tx.get(job.audit)]);
  if(r.exists&&identity(r)===job.created&&own(r.data().bucketMigration,job.leaseToken)&&a.exists&&a.data().status==='deleting'&&a.data().workerStatus==='active'&&a.data().workerToken===job.workerToken)tx.update(job.audit,{workerStatus:'paused',pausedAt:FieldValue.serverTimestamp()});
 });
}
async function execute(request){
 if(process.env.GCLOUD_PROJECT!=='bxh-arena'&&process.env.GOOGLE_CLOUD_PROJECT!=='bxh-arena')fail('failed-precondition','production-only');
 const uid=request.auth?.uid;if(!uid)fail('unauthenticated','auth-required');const code=normalize(request.data?.code),operationId=String(request.data?.operationId||'');
 if(!validOperation.test(operationId))fail('invalid-argument','invalid-operation-id');
 const job=await claim({uid,code,operationId});if(job.orphan||job.pending)return job.result;
 try{
  const hostRecordPreserved=await preserveCompletedHostRecord(code,job.tournament);
  await deleteChildren(job);
  // Secondary cleanup finishes while the old parent still prevents code reuse.
  const assignmentCount=await deleteEventStaffAssignments(code,job);
  return await finish(job,{uid,code,operationId:job.operationId,hostRecordPreserved,assignmentCount});
 }catch(error){
  try{await pause(job);}catch(_){} // Failure to release remains safely active.
  throw error;
 }
}
return {execute,_private:{normalizeCode,claim,finish,pause,assertLease,deleteChildren,preserveCompletedHostRecord,deleteEventStaffAssignments}};
}
const service=createDeletionService();
exports.deleteTournamentSafely=onCall({region:REGION,cors:true,invoker:'public',timeoutSeconds:540,memory:'512MiB',maxInstances:3},service.execute);
exports._private=service._private;
exports.createDeletionService=createDeletionService;
