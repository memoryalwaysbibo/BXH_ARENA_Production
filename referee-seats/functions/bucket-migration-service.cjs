'use strict';
// Internal operator API only. Caller supplies a previously verified operator UID;
// the profile check is not an external identity verifier. No public entry exports it.
const P=require('./bucket-migration-plan.cjs'),S=require('./scoring-core.cjs');
function checkRuntime(db,{runtime,env}){
 if(runtime==='emulator'){
  if(db.projectId!=='demo-bxh-four-court-buckets'||env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8188')throw Error('emulator-only');
 }else if(runtime==='production'){
  if(env.BXH_BUCKET_MIGRATION_ENABLED!=='true')throw Error('migration-runtime-disabled');
  if(!env.BXH_BUCKET_PROJECT_ID||env.BXH_BUCKET_PROJECT_ID!==db.projectId||env.GCLOUD_PROJECT!==db.projectId||db.projectId.startsWith('demo-'))throw Error('bucket-project-mismatch');
  if(['FUNCTIONS_EMULATOR','FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','FIREBASE_DEBUG_MODE','FIREBASE_DEBUG_FEATURES'].some(k=>env[k]))throw Error('bucket-runtime-mismatch');
 }else throw Error('invalid-bucket-runtime');
}
function stamp(time){if(!Number.isSafeInteger(time?.seconds)||!Number.isSafeInteger(time?.nanoseconds))throw Error('migration-version-missing');return time.seconds+':'+time.nanoseconds;}
function operator(user){if(user?.active!==true||user.isTestAccount===true||user.role!=='super_admin')throw Error('migration-operator-required');}
function createBucketMigrationService(db,{runtime='emulator',env=process.env,clock=Date.now,deleteField=()=>require('firebase-admin/firestore').FieldValue.delete()}={}){
 checkRuntime(db,{runtime,env});
 function refs(code,actorUid){if(!/^BXH-[A-Z0-9]{4,16}$/.test(code)||typeof actorUid!=='string'||!actorUid||actorUid.length>128||actorUid.includes('/'))throw Error('invalid-migration-request');const root=db.doc('tournaments/'+code);return {root,pub:db.doc('publicTournaments/'+code),release:db.doc('systemConfig/fourCourtScoreBuckets'),user:db.doc('users/'+actorUid)};}
 function authorizeActivation(config,manifest){
  if(config?.enabled!==true||config.migrationEnabled!==true)throw Error('migration-release-not-ready');
  if(runtime==='production'){
   require('./bucket-runtime.cjs').createBucketRuntime(db,{runtime,env}).assertRoom(config,manifest);
   if(config.privateReadsEnabled!==true||config.automaticPublicProjectionEnabled!==true||!Object.hasOwn(config.migrationRooms||{},manifest.code)||config.migrationRooms[manifest.code]!==manifest.epoch)throw Error('migration-room-not-enabled');
  }
 }
 async function load(tx,r,snaps,request){
  const {rootSnap,releaseSnap}=snaps;if(!rootSnap.exists)throw Error('not-found');
  // Same lock order as scorers/projector: root, all buckets, public mirror.
  const room=rootSnap.data(),query=await tx.get(r.root.collection('matchBuckets').limit(P.MAX_BUCKETS+1));
  const pubSnap=await tx.get(r.pub);if(!pubSnap.exists)throw Error('not-found');const publicDocument=pubSnap.data();
  const buckets=query.docs.map(s=>({id:s.id,data:s.data(),updateTime:stamp(s.updateTime)}));
  const versions={root:stamp(rootSnap.updateTime),public:stamp(pubSnap.updateTime),release:releaseSnap.exists?stamp(releaseSnap.updateTime):null};
  if(request.action==='activate'){
   const epochRecord=await tx.get(r.root.collection('bucketMigrationEpochs').doc(P.digest(request.epoch)));
   if(epochRecord.exists)throw Error('migration-epoch-used');
  }
  if(request.action==='rollback'){
   const migration=room.bucketMigration;
   if(migration?.version!==1||migration.epoch!==request.epoch||! /^[a-f0-9]{64}$/.test(migration.operation||''))throw Error('migration-backup-missing');
   const operationRef=r.root.collection('bucketMigrationOperations').doc(migration.operation),backups=['root','public','state'].map(kind=>r.root.collection('bucketMigrationBackups').doc(migration.operation+'-'+kind));
   const [receipt,...saved]=await tx.getAll(operationRef,...backups),record=receipt.data();
   if(!receipt.exists||record.action!=='activate'||record.code!==request.code||record.epoch!==request.epoch||record.roomId!==room.scoreStorage?.roomId||saved.some((s,i)=>!s.exists||P.digest(s.data())!==record.backupHashes?.[i]))throw Error('migration-backup-invalid');
   versions.backups=[receipt,...saved].map(s=>stamp(s.updateTime));
  }
  const prepared=P.prepare({...request,room,publicDocument,buckets,versions});
  if(request.action==='activate')authorizeActivation(releaseSnap.data(),prepared.manifest);
  return {...prepared,room,publicDocument};
 }
 async function preflight(request={}){
  checkRuntime(db,{runtime,env});
  if(!['activate','rollback'].includes(request.action)||!/^[-a-zA-Z0-9]{1,100}$/.test(request.epoch||''))throw Error('invalid-migration-request');
  const r=refs(request.code,request.actorUid);return db.runTransaction(async tx=>{
   const [rootSnap,releaseSnap,userSnap]=await tx.getAll(r.root,r.release,r.user);operator(userSnap.data());
   return (await load(tx,r,{rootSnap,releaseSnap},request)).plan;
  });
 }
 async function commit(request={}){
  checkRuntime(db,{runtime,env});
  if(!['activate','rollback'].includes(request.action)||!/^[-a-zA-Z0-9]{1,100}$/.test(request.epoch||''))throw Error('invalid-migration-request');
  if(!/^[-a-zA-Z0-9]{16,80}$/.test(request.operationId||'')||! /^[a-f0-9]{64}$/.test(request.sourceDigest||''))throw Error('invalid-migration-request');
  const r=refs(request.code,request.actorUid),id=P.digest([request.actorUid,request.operationId]),operationRef=r.root.collection('bucketMigrationOperations').doc(id),requestHash=P.digest({action:request.action,code:request.code,epoch:request.epoch,sourceDigest:request.sourceDigest});
  return db.runTransaction(async tx=>{
   const [rootSnap,releaseSnap,userSnap,receipt]=await tx.getAll(r.root,r.release,r.user,operationRef);operator(userSnap.data());
   if(receipt.exists){const old=receipt.data();if(old.requestHash!==requestHash)throw Error('operation-conflict');return {...old.result,replayed:true};}
   const prepared=await load(tx,r,{rootSnap,releaseSnap},request),{plan,state,manifest,encoded,previous,room,publicDocument}=prepared;
   if(plan.sourceDigest!==request.sourceDigest)throw Error('migration-plan-stale');
   const at=Math.max(clock(),Number(room.updatedAt||0)+1,Number(publicDocument.updatedAt||0)+1);state.updatedAt=at;
   const common={version:1,code:request.code,roomId:plan.roomId,epoch:request.epoch,action:request.action,actorUid:request.actorUid,at,sourceDigest:plan.sourceDigest};
   const backups=[{...common,kind:'root',snapshot:room},{...common,kind:'public',snapshot:publicDocument},{...common,kind:'state',data:JSON.stringify(state),manifest}];
   const publicPatch={bracketView:JSON.stringify(S.publicProjection(state,previous)),updatedAt:at};
   P.budget([...backups,publicPatch,...encoded]);
   backups.forEach((backup,i)=>tx.create(r.root.collection('bucketMigrationBackups').doc(id+'-'+['root','public','state'][i]),backup));
   if(request.action==='activate'){
    tx.create(r.root.collection('bucketMigrationEpochs').doc(P.digest(request.epoch)),{version:1,epoch:request.epoch,roomId:plan.roomId,operation:id,actorUid:request.actorUid,at});
    encoded.forEach(bucket=>tx.create(r.root.collection('matchBuckets').doc(bucket.bucketId),bucket));
    tx.update(r.root,{scoreStorage:manifest,bucketMigration:{version:1,epoch:request.epoch,operation:id},data:JSON.stringify(state),updatedAt:at});
    tx.update(r.pub,{...publicPatch,scoreBucketProjection:{epoch:request.epoch,versions:Object.fromEntries(encoded.map(b=>[b.bucketId,b.revision]))}});
   }else{
    tx.update(r.root,{scoreStorage:deleteField(),bucketMigration:deleteField(),data:JSON.stringify(state),updatedAt:at});
    tx.update(r.pub,{...publicPatch,scoreBucketProjection:deleteField()});
    encoded.forEach(bucket=>tx.delete(r.root.collection('matchBuckets').doc(bucket.bucketId)));
   }
   const result={ok:true,action:request.action,code:request.code,epoch:request.epoch,courts:plan.courts,buckets:plan.buckets,operation:id};
   tx.create(operationRef,{...common,requestHash,backupHashes:backups.map(P.digest),result});return result;
  });
 }
 return {preflight,commit};
}
module.exports={createBucketMigrationService,checkRuntime};
