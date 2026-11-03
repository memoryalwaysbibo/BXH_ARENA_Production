'use strict';
const {onDocumentWritten}=require('firebase-functions/v2/firestore');
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {onSchedule}=require('firebase-functions/v2/scheduler');
const {getFirestore,FieldValue,FieldPath}=require("./_qr_checkin/admin-firestore.cjs");
const {stateOf,completion}=require('./hosting-core');
const db=getFirestore();
const Bucket=require('../../hosting-guard.cjs');
async function keepAndCount(code,expectedBirth=null){
 return db.runTransaction(async tx=>{
  const ref=db.doc(`tournaments/${code}`),snap=await tx.get(ref);if(!snap.exists)return null;
  const t=snap.data(),s=stateOf(t),uid=t.createdBy;
  if(expectedBirth&&Bucket.identity(snap)!==expectedBirth)return null;
  if(!uid||typeof uid!=='string'||uid.includes('/'))return null;
  const ledger=db.doc(`hostCompletionLedger/${code}`),stats=db.doc(`hostStats/${uid}`);
  const [profile,prior,publicRoom]=await Promise.all([tx.get(db.doc(`users/${uid}`)),tx.get(ledger),tx.get(db.doc(`publicTournaments/${code}`))]);
  if(Bucket.marked(t,publicRoom.data())){
   if(!Object.hasOwn(t,'bucketCompletion')&&!Object.hasOwn(t,'bucketSettlement')&&t.archiveStatus!=='completed'&&s.archiveStatus!=='completed')return null;
   return Bucket.countCertified({db,tx,root:snap,pub:publicRoom,profile,prior,ledger,stats,FieldValue,completion});
  }
  const summary=completion(t,profile.data());
  if(t.eventAuthority==='community'&&s.archiveStatus==='completed'&&t.expiresAt!=null){
   s.expiresAtMs=null;tx.update(ref,{expiresAt:null,data:JSON.stringify(s)});
   if(publicRoom.exists)tx.update(publicRoom.ref,{expiresAt:null});
  }
  if(summary&&!prior.exists){tx.create(ledger,{...summary,ownerUid:uid,eventCode:code,verifiedAt:FieldValue.serverTimestamp()});tx.set(stats,{completedHostedCount:FieldValue.increment(1),updatedAt:FieldValue.serverTimestamp()},{merge:true});}
  return summary?uid:null;
 });
}
// A persisted outbox decouples count commits from title evaluation retries.
async function run(code,{queue=true,expectedBirth=null}={}){const uid=await keepAndCount(code,expectedBirth);if(uid&&queue)await db.doc(`hostAwardQueue/${uid}`).set({updatedAt:FieldValue.serverTimestamp()},{merge:true});return uid;}
exports.preserveCompletedRoomAndCountHost=onDocumentWritten({document:'tournaments/{code}',region:'asia-east1',retry:true},async e=>{if(e.data?.after.exists)await run(e.params.code,{expectedBirth:Bucket.identity(e.data.after)});});
exports.syncMyHostingProgress=onCall({region:'asia-east1',cors:true,timeoutSeconds:540},async req=>{
 const uid=req.auth?.uid;if(!uid)throw new HttpsError('unauthenticated','auth-required');
 const p=await db.doc(`users/${uid}`).get();if(!p.exists||p.data().active!==true)throw new HttpsError('permission-denied','inactive-account');
 const count=await Bucket.rebuildHost({db,uid,FieldValue,completion,stateOf});
 return {ok:true,completedHostedCount:count};
});
// Rebuilds host progress exactly from all valid completed rooms on/after the title-history baseline.
exports.preserveExistingCompletedRooms=onSchedule({schedule:'every 24 hours',timeZone:'Asia/Taipei',region:'asia-east1',timeoutSeconds:540,maxInstances:1},async()=>{
 if(process.env.GCLOUD_PROJECT!=='bxh-arena'&&process.env.GOOGLE_CLOUD_PROJECT!=='bxh-arena')return;
 return Bucket.rebuildAll({db,FieldValue,FieldPath,completion,stateOf});
});
